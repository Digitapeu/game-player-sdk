/**
 * WAM Game Player SDK
 * 
 * A JavaScript/TypeScript SDK that integrates HTML5 games with WAM platforms.
 * 
 * Public API (FROZEN - DO NOT CHANGE):
 *   digitapSDK('init', hasScore, hasHighScore)
 *   digitapSDK('setCallback', fn, callback)
 *   digitapSDK('setProgress', state, score, level)
 *   digitapSDK('setLevelUp', level)
 *   digitapSDK('setPlayerFailed', state)
 * 
 * @version 2.0.0
 */

import type { Progress, CanvasElement } from './types';
import { SecurityBridge, log } from './security';

// ============================================================
// Security Bridge Singleton
// ============================================================

const ALLOWED_ORIGINS = [
  'https://wam.app',
  'https://app.wam.app',
  'https://wam.eu',
  'https://win.wam.app',
  'https://play.wam.app',
];
const securityBridge = new SecurityBridge();

// ============================================================
// Main SDK Class
// ============================================================

class DigitapGamePlayerSDK {
  public static gameObject: any = null;
  private static _isLoaded: boolean = false;
  private static _isConnected: boolean = false;
  private static _origin: string | null = null;
  private static _initRetryCount: number = 0;
  private static _initRetryInterval: number | null = null;

  private static readonly _MAX_INIT_RETRIES = 10;
  private static readonly _INIT_RETRY_DELAY_MS = 500;

  private static _allowedOrigins: string[] = ALLOWED_ORIGINS;;

  private static _progress: Progress = {
    controller: '_digitapGame',
    type: 'SDK_PLAYER_SCORE_UPDATE',
    score: 0,
    level: 0,
    state: null,
    continueScore: 0,
  };

  /**
   * Call a method from the class through a queue.
   */
  public static processQueue(...args: any[]): void {
    if (typeof args[0] === 'string') {
      const methodName = args[0] as
        | 'init'
        | 'setProgress'
        | 'setLevelUp'
        | 'setPlayerFailed'
        | 'setCallback';

      const method = DigitapGamePlayerSDK[methodName] as (...args: any[]) => void;
      if (method) {
        method.apply(DigitapGamePlayerSDK, args.slice(1));
      }
    }
  }

  /**
   * Process a current queue.
   */
  public static processOldQueue(queue: any[]): void {
    if (!queue || !Array.isArray(queue)) return;
    queue.forEach((args: any) => {
      this.processQueue(...args);
    });
  }

  /**
   * Sets a callback method.
   */
  public static setCallback(
    fn:
      | 'afterStartGameFromZero'
      | 'afterContinueWithCurrentScore'
      | 'afterStartGame'
      | 'afterPauseGame',
    callback: any
  ): void {
    (this as any)[fn] = callback;
  }

  /**
   * Init a new game connection with the parent platform.
   */
  public static init(
    hasScore: boolean = true,
    hasHighScore: boolean = true
  ): void {
    log.info('🎮 DigitapSDK.init() called', { hasScore, hasHighScore });
    
    // If SDK is not loaded yet
    if (!this._isLoaded) {
      // Security bridge is already initialized on script load
      
      // Init the uiOptions
      const uiOptions = ['score', 'highScore', hasScore, hasHighScore];

      // Send the init message
      log.info('Sending SDK_SETTINGS to parent', { uiOptions });
      window.parent.postMessage(
        {
          controller: '_digitapGame',
          type: 'SDK_SETTINGS',
          ui: uiOptions,
          ready: true,
        },
        '*'
      );

      // Watch for messages from GameBox
      this._listenGameboxEvents();
      log.info('✓ Listening for GameBox events');

      // Watch for messages from Streamr
      this._listenStreamrEvents();
      log.info('✓ Listening for Streamr events');

      // Set the canvas fullwidth & blue screen fix
      const canvas: HTMLCollection = document.getElementsByTagName('canvas');
      const html: HTMLCollection = document.getElementsByTagName('html');

      setTimeout(() => {
        if (canvas[0]) {
          const canvasStyle = canvas[0].getAttribute('style') || '';
          canvas[0].setAttribute(
            'style',
            canvasStyle +
              'width: 100%; margin: 0; padding: 0; user-select: none; -webkit-user-select: none; -moz-user-select: none;'
          );
          log.info('✓ Applied canvas styles');
        }

        if (html[0]) {
          const htmlStyle = html[0].getAttribute('style') || '';
          html[0].setAttribute(
            'style',
            htmlStyle +
              'user-select: none; -webkit-user-select: none; -moz-user-select: none;'
          );
          log.info('✓ Applied html styles');
        }
      }, 2000);
    } else {
      log.warn('SDK already initialized, skipping');
    }

    // Set SDK as loaded to prevent re-initiation
    this._isLoaded = true;
    log.info('🎮 DigitapSDK ready!');
  }

  /**
   * Set progress of a game.
   * Computes stateHash from input events and canvas state for integrity verification.
   */
  public static setProgress(state: string, score: number, level: number): void {
    log.info(`setProgress: state=${state}, score=${score}, level=${level}`);
    
    // Compute stateHash for cryptographic evidence
    // This ties the score to input events and game visual state
    const stateHash = securityBridge.computeStateHash(score);
    
    // Set the current progress with stateHash
    this._progress = {
      type: 'SDK_PLAYER_SCORE_UPDATE',
      state,
      score,
      level,
      continueScore: score,
      controller: '_digitapGame',
      stateHash,  // ✅ Now included!
    };

    this._sendData();
  }

  /**
   * Set the new level of the game.
   * Computes stateHash to prove level advancement was legitimate.
   */
  public static setLevelUp(level: number): void {
    log.info(`setLevelUp: level=${level}`);
    
    // Compute stateHash at moment of level up
    const stateHash = securityBridge.computeStateHash(this._progress.score);
    
    this._progress.level = level;
    this._progress.type = 'SDK_PLAYER_LEVEL_UP';
    this._progress.stateHash = stateHash;

    this._sendData();
  }

  /**
   * Set the game as failed (player death).
   * Computes stateHash from input events and canvas state at death moment.
   */
  public static setPlayerFailed(state: string = 'FAIL'): void {
    log.info(`setPlayerFailed: state=${state}`);
    
    // Capture score BEFORE setting to 0 for stateHash computation
    const scoreAtDeath = this._progress.score;
    
    // Compute stateHash at moment of death
    // This proves the death was legitimate (not fabricated)
    const stateHash = securityBridge.computeStateHash(scoreAtDeath);
    
    this._progress.state = state;
    this._progress.score = 0;
    this._progress.type = 'SDK_PLAYER_FAILED';
    this._progress.stateHash = stateHash;
    this._progress.continueScore = scoreAtDeath; // Preserve for potential revive

    this._sendData();

    // Force the game to be set to zero when the player fails
    this.afterStartGameFromZero();
  }

  /**
   * Sends game data to parent platform.
   */
  private static _sendData(): void {
    log.info(`Sending to parent: ${this._progress.type}`, this._progress);
    window.parent.postMessage(this._progress, this._origin ?? '*');
  }

  /**
   * Start listening for game commands from GameBox (parent only).
   */
  private static _listenGameboxEvents(): void {
    const self = this;

    window.addEventListener(
      'message',
      function (event) {
        // STRICT FILTER 1: Only accept messages from parent window (GameBox)
        if (event.source !== window.parent) {
          return; // Silently ignore - not from GameBox
        }

        // STRICT FILTER 2: Must be a valid object with controller
        const data = event.data;
        if (!data || typeof data !== 'object' || data.controller !== '_digitapApp') {
          return; // Silently ignore - not our protocol
        }

        // STRICT FILTER 3: Must have a valid type (support both NEW and OLD protocols)
        const validTypes = [
          // NEW protocol (SDK v2+)
          'SDK_START_GAME',
          'SDK_PAUSE_GAME', 
          'SDK_START_GAME_FROM_ZERO',
          'SDK_CONTINUE_WITH_CURRENT_SCORE',
          // OLD protocol (SDK v1.0.0 backward compatibility)
          'startGame',
          'startGameFromZero',
          'continueWithCurrentScore'
        ];
        if (!data.type || !validTypes.includes(data.type)) {
          return; // Silently ignore - unknown command
        }

        // Validate origin
        const originIndex = self._allowedOrigins.indexOf(event.origin);
        if (originIndex === -1) {
          log.warn(`GameBox message from unauthorized origin: ${event.origin}`);
          return;
        }
        self._origin = self._allowedOrigins[originIndex];

        log.event(`GameBox → SDK: ${data.type}`, { origin: event.origin });
        
        switch (data.type) {
          // NEW protocol
          case 'SDK_START_GAME':
          // OLD protocol (backward compat)
          case 'startGame':
            log.info('📢 Calling afterStartGame()');
            self.afterStartGame();
            break;

          case 'SDK_PAUSE_GAME':
            log.info('📢 Calling afterPauseGame()');
            self.afterPauseGame();
            break;

          // NEW protocol
          case 'SDK_START_GAME_FROM_ZERO':
          // OLD protocol (backward compat)
          case 'startGameFromZero':
            log.info('📢 Resetting progress and calling afterStartGameFromZero()');
            self._progress.score = 0;
            self._progress.level = 0;
            self._progress.continueScore = 0;
            self.afterStartGameFromZero();
            break;

          // NEW protocol
          case 'SDK_CONTINUE_WITH_CURRENT_SCORE':
          // OLD protocol (backward compat)
          case 'continueWithCurrentScore':
            log.info(`📢 Continuing with score=${self._progress.continueScore}, level=${self._progress.level}`);
            self._progress.score = self._progress.continueScore;
            self.afterContinueWithCurrentScore(
              self._progress.score,
              self._progress.level
            );
            break;
        }
      },
      false
    );
  }

  /**
   * Start listening for WebRTC messages from the Streamr platform.
   */
  private static _listenStreamrEvents(): void {
    let canvas: CanvasElement | null = null;
    let stream: MediaStream | null = null;
    let connection: RTCPeerConnection | null = null;
    let channel: RTCDataChannel | null = null;
    let iceCandidate: RTCIceCandidate | null = null;
    let connected = false;
    let isNegotiationNeeded = false;

    const self = this;

    window.addEventListener('message', async (event) => {
      try {
        // STRICT FILTER: Only accept messages from parent window (GameBox)
        if (event.source !== window.parent) {
          return; // Silently ignore - not from GameBox
        }

        if (!event.data || typeof event.data !== 'object') {
          return;
        }

        const { controller, type, action, offer, tournament_id, username } =
          event.data;

        if (controller !== '_digitapApp' || type !== 'webrtc') {
          return;
        }

        if (!connected) {
          canvas = document.querySelector('canvas') as CanvasElement;
          if (!canvas) return;
          
          stream = canvas.captureStream(30);
          connection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          channel = connection.createDataChannel(
            `streamr-${tournament_id}-${username}`,
            {
              negotiated: true,
              id: 0,
            }
          );
        }

        if (action === 'close') {
          if (connection) {
            for (const sender of connection.getSenders()) {
              connection.removeTrack(sender);
            }
          }

          canvas = null;
          stream = null;

          if (channel) {
            channel.send(JSON.stringify({ type: 'streamr', action: 'close' }));
          }
          if (connection) {
            connection.close();
          }

          connection = null;
          channel = null;
          iceCandidate = null;
          connected = false;
          isNegotiationNeeded = false;
          return;
        }

        if (action === 'init' && stream && connection && channel) {
          for (const track of stream.getTracks()) {
            connection.addTrack(track, stream);
          }

          const onConnectionStateChange = () => {
            if (!connection) return;
            
            switch (connection.connectionState) {
              case 'connected':
                connected = true;
                (event.source as Window).postMessage(
                  { type: 'streamr', action: 'connected' },
                  event.origin
                );
                break;
              case 'disconnected':
                if (connection) {
                  for (const sender of connection.getSenders()) {
                    connection.removeTrack(sender);
                  }
                }
                canvas = null;
                stream = null;

                (event.source as Window).postMessage(
                  { type: 'streamr', action: 'disconnected' },
                  event.origin
                );

                if (channel) channel.close();
                if (connection) {
                  connection.close();
                  connection.removeEventListener(
                    'connectionstatechange',
                    onConnectionStateChange
                  );
                  connection.removeEventListener(
                    'iceconnectionstatechange',
                    onIceConnectionStateChange
                  );
                  connection.removeEventListener('icecandidate', onIceCandidate);
                  connection.removeEventListener(
                    'negotiationneeded',
                    onNegotiationNeeded
                  );
                  connection.removeEventListener(
                    'signalingstatechange',
                    onSignalingStateChange
                  );
                }
                if (channel) {
                  channel.removeEventListener('message', onMessage);
                }

                connection = null;
                channel = null;
                iceCandidate = null;
                connected = false;
                break;
            }
          };

          const onIceConnectionStateChange = () => {
            if (!connection) return;
            
            switch (connection.iceConnectionState) {
              case 'connected':
                break;
              case 'disconnected':
              case 'failed':
                connection.restartIce();
                break;
            }
          };

          const onIceCandidate = (e: RTCPeerConnectionIceEvent) => {
            try {
              if (e.candidate) {
                iceCandidate = e.candidate;
              } else if (connection) {
                (event.source as Window).postMessage(
                  {
                    type: 'streamr',
                    action: 'answer',
                    offer: window.btoa(
                      JSON.stringify(connection.localDescription)
                    ),
                  },
                  event.origin
                );
              }
            } catch {
              // Ignore errors
            }
          };

          const onMessage = async (messageEvent: MessageEvent) => {
            try {
              if (!messageEvent.data || !connection || !channel) {
                return;
              }

              const message = JSON.parse(messageEvent.data);

              if (message.iceCandidate) {
                await connection.addIceCandidate(message.iceCandidate);
                channel.send(JSON.stringify({ iceCandidate }));
              }
            } catch {
              // Ignore errors
            }
          };

          const onNegotiationNeeded = async () => {
            try {
              if (isNegotiationNeeded || !connection) {
                return;
              }

              await connection.setRemoteDescription(JSON.parse(offer));
              await connection.setLocalDescription(
                await connection.createAnswer()
              );
            } catch {
              // Ignore errors
            }
          };

          const onSignalingStateChange = () => {
            if (connection) {
              isNegotiationNeeded = connection.signalingState !== 'stable';
            }
          };

          connection.addEventListener(
            'connectionstatechange',
            onConnectionStateChange
          );
          connection.addEventListener(
            'iceconnectionstatechange',
            onIceConnectionStateChange
          );
          connection.addEventListener('icecandidate', onIceCandidate);
          connection.addEventListener(
            'negotiationneeded',
            onNegotiationNeeded
          );
          connection.addEventListener(
            'signalingstatechange',
            onSignalingStateChange
          );
          channel.addEventListener('message', onMessage);

          await connection.setRemoteDescription(JSON.parse(offer));
          await connection.setLocalDescription(await connection.createAnswer());
        }
      } catch {
        // Ignore errors
      }
    });
  }

  /**
   * Callback methods for game developer to use.
   */
  public static afterStartGameFromZero() {}

  public static afterContinueWithCurrentScore(_score: number, _level: number) {}

  public static afterStartGame() {}

  public static afterPauseGame() {}
}

// ============================================================
// GLOBAL MESSAGE LISTENER - Attached IMMEDIATELY on script load
// Only logs messages from GameBox (parent) with valid protocol structure
// ============================================================

(function attachGlobalListener() {
  if (typeof window === 'undefined') return;
  
  log.info('🔌 SDK script loaded - attaching global message listener');
  
  window.addEventListener('message', (event) => {
    // STRICT FILTER: Only accept messages from parent window (GameBox)
    if (event.source !== window.parent) {
      return; // Silently ignore - not from GameBox
    }
    
    // STRICT FILTER: Must be an object with our protocol structure
    const data = event.data;
    if (!data || typeof data !== 'object') {
      return; // Silently ignore - malformed
    }
    
    // STRICT FILTER: Must have a valid controller from our protocol
    const controller = data.controller;
    if (controller !== '_digitapApp' && controller !== '_digitapSecurity') {
      return; // Silently ignore - not our protocol (e.g. MetaMask, extensions)
    }
    
    // This is a valid GameBox message - log it
    log.info('📩 GameBox message received:', {
      origin: event.origin,
      controller: controller,
      type: data.type
    });
  });
  
  // Notify parent immediately that SDK script is loaded
  // This happens BEFORE the game calls init()
  try {
    window.parent.postMessage({
      controller: '_digitapSecurity',
      type: 'SDK_LOADED',
      ts: Date.now()
    }, '*');
    log.info('📤 Sent SDK_LOADED beacon to parent');
  } catch (e) {
    log.error('Failed to send SDK_LOADED beacon', e);
  }
})();

// ============================================================
// Initialize Security Bridge IMMEDIATELY (don't wait for game init)
// ============================================================

securityBridge.init();

// ============================================================
// BACKWARD COMPATIBILITY: _digitapUser (SDK v1.0.0 API)
// ============================================================
// Games written for the old SDK use _digitapUser directly.
// This shim exposes the old API while internally using the new SDK.

interface LegacyProgress {
  controller: string;
  type: string;
  score: number;
  state: string | null;
  continueScore: number;
  level?: number;
}

interface LegacyDigitapUser {
  gameObject: any;
  isLoaded: boolean;
  origin: string | null;
  allowedOrigins: string[];
  progress: LegacyProgress;
  extra: { multiplier: number };
  sendData: (gameObject?: any) => void;
  init: (uiOptions?: string[]) => void;
  _afterStartGameFromZero: () => void;
  _afterContinueWithCurrentScore: () => void;
  _afterStartGame: () => void;
}

const _digitapUser: LegacyDigitapUser = {
  gameObject: null,
  isLoaded: false,
  origin: null,
  allowedOrigins: ALLOWED_ORIGINS,
  progress: {
    controller: '_digitapGame',
    type: 'progress',
    score: 0,
    state: null,
    continueScore: 0,
    level: 0,
  },
  extra: {
    multiplier: 1,
  },

  /**
   * Send game data to parent platform (OLD API).
   * Forwards to new SDK's setProgress internally.
   */
  sendData: function (gameObject?: any) {
    if (typeof gameObject !== 'undefined') {
      this.gameObject = gameObject;
    }
    this.progress.continueScore = this.progress.score;

    // Forward to new SDK with security features
    DigitapGamePlayerSDK.setProgress(
      this.progress.state ?? 'PLAY',
      this.progress.score,
      this.progress.level ?? 0
    );
  },

  /**
   * Initialize the SDK (OLD API).
   * Games call: _digitapUser.init(['sound', 'background'])
   */
  init: function (uiOptions?: string[]) {
    log.info('🔄 _digitapUser.init() called (legacy API)', { uiOptions });

    if (!this.isLoaded) {
      // Send OLD-style settings message for backward compat
      window.parent.postMessage(
        {
          controller: '_digitapGame',
          type: 'settings', // OLD protocol uses 'settings'
          ui: uiOptions,
          ready: true,
        },
        '*'
      );

      // Also send NEW-style settings (in case GameBox expects it)
      window.parent.postMessage(
        {
          controller: '_digitapGame',
          type: 'SDK_SETTINGS',
          ui: uiOptions,
          ready: true,
        },
        '*'
      );
    }

    this.isLoaded = true;

    // Initialize new SDK internally (without sending duplicate messages)
    if (!(DigitapGamePlayerSDK as any)._isLoaded) {
      (DigitapGamePlayerSDK as any)._isLoaded = true;
      (DigitapGamePlayerSDK as any)._listenGameboxEvents();
      (DigitapGamePlayerSDK as any)._listenStreamrEvents();
    }
  },

  // Hookable methods - games OVERRIDE these
  _afterStartGameFromZero: function () {
    // Games override this: _digitapUser._afterStartGameFromZero = function() { ... }
  },
  _afterContinueWithCurrentScore: function () {
    // Games override this: _digitapUser._afterContinueWithCurrentScore = function() { ... }
  },
  _afterStartGame: function () {
    // Games override this: _digitapUser._afterStartGame = function() { ... }
  },
};

// Wire up new SDK callbacks to legacy hooks
DigitapGamePlayerSDK.afterStartGameFromZero = function () {
  log.info('🔄 Forwarding afterStartGameFromZero to legacy _digitapUser');
  _digitapUser.progress.score = 0;
  _digitapUser.progress.continueScore = 0;
  _digitapUser._afterStartGameFromZero();
};

DigitapGamePlayerSDK.afterContinueWithCurrentScore = function (score: number, level: number) {
  log.info('🔄 Forwarding afterContinueWithCurrentScore to legacy _digitapUser', { score, level });
  _digitapUser.progress.score = _digitapUser.progress.continueScore;
  _digitapUser._afterContinueWithCurrentScore();
};

DigitapGamePlayerSDK.afterStartGame = function () {
  log.info('🔄 Forwarding afterStartGame to legacy _digitapUser');
  _digitapUser._afterStartGame();
};

// Expose _digitapUser globally for legacy games
(window as any)._digitapUser = _digitapUser;
log.info('✓ Legacy _digitapUser API exposed globally');

// ============================================================
// Initialize SDK
// ============================================================

// Read the current queue
if (typeof (window as any).digitapSDK !== 'undefined') {
  const oldQueue = (window as any).digitapSDK.q;
  DigitapGamePlayerSDK.processOldQueue(oldQueue);
}

// Watch the queue with new method
(window as any).digitapSDK = DigitapGamePlayerSDK.processQueue;
