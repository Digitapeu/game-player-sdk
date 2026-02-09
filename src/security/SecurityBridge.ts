/**
 * SecurityBridge Module
 * 
 * The main coordinator that listens for postMessage requests from GameBox (parent)
 * and responds with security data. Uses controller: '_digitapSecurity' to namespace
 * the protocol separately from the existing game protocol.
 * 
 * Cryptography:
 * - keccak256 (Ethereum-compatible) for all hashes
 * - Rolling hash for checkpoint chain integrity
 */

import type { 
  SecurityRequest, 
  SecurityResponse,
  InputEventsResponse,
  InputSketchResponse,
  CanvasSampleResponse,
  CanvasEmbedResponse,
  MetaResponse,
  CheckpointResponse,
  SessionMeta
} from '../types';

import { InputCapture } from './InputCapture';
import { CanvasHandler } from './CanvasHandler';
import { SketchBuilder } from './SketchBuilder';
import { MetadataCollector } from './MetadataCollector';
import { computeRollingHash, computeInitialRollingHash, keccak256 } from './utils';
import { log } from './logger';

// ============================================================
// Rolling Hash State (checkpoint chain integrity)
// ============================================================

interface RollingHashState {
  sessionId: string;
  currentHash: string;
  windowIndex: number;
  lastNonceW: string;
}

export class SecurityBridge {
  private _inputCapture: InputCapture;
  private _canvasHandler: CanvasHandler;
  private _sketchBuilder: SketchBuilder;
  private _metadataCollector: MetadataCollector;
  private _isInitialized = false;

  // Rolling hash state for checkpoint integrity
  private _rollingState: RollingHashState | null = null;

  // Connection state callback
  private _onSessionInitCallback: (() => void) | null = null;

  private static readonly _CONTROLLER = '_digitapSecurity';
  private static readonly _ALLOWED_ORIGINS = [
    'https://wam.app',
    'https://app.wam.app',
    'https://wam.eu',
    'https://win.wam.app',
    'https://play.wam.app'
  ];

  constructor() {
    this._inputCapture = new InputCapture();
    this._canvasHandler = new CanvasHandler();
    this._sketchBuilder = new SketchBuilder();
    this._metadataCollector = new MetadataCollector();
  }

  /**
   * Register a callback to be called when session is initialized.
   * Used by main SDK to track connection state.
   */
  onSessionInit(callback: () => void): void {
    this._onSessionInitCallback = callback;
  }

  /**
   * Check if a session has been initialized.
   */
  get isSessionActive(): boolean {
    return this._rollingState !== null;
  }

  /**
   * Initialize the security bridge.
   * This should be called during SDK init.
   */
  init(): void {
    if (this._isInitialized) {
      log.warn('SecurityBridge already initialized, skipping');
      return;
    }
    this._isInitialized = true;

    log.info('🚀 Initializing SecurityBridge...');
    log.info('✓ Using keccak256 (Ethereum-compatible) for all hashes');

    // Start capturing input events
    this._inputCapture.start();
    log.info('✓ InputCapture started');
    
    // Start looking for canvas
    this._canvasHandler.start();
    log.info('✓ CanvasHandler started');
    
    // Listen for security requests from parent
    this._listenForRequests();
    log.info('✓ Listening for postMessage requests from parent');
    log.info('✓ Allowed origins:', SecurityBridge._ALLOWED_ORIGINS);
    log.info('🎮 SecurityBridge ready!');
  }

  /**
   * Stop the security bridge.
   */
  stop(): void {
    if (!this._isInitialized) return;
    this._isInitialized = false;

    this._inputCapture.stop();
    this._canvasHandler.stop();
    this._rollingState = null;
  }

  /**
   * Listen for postMessage requests from parent (GameBox only).
   */
  private _listenForRequests(): void {
    window.addEventListener('message', (event) => {
      // STRICT FILTER 1: Only accept messages from parent window (GameBox)
      if (event.source !== window.parent) {
        return; // Silently ignore - not from GameBox
      }

      // STRICT FILTER 2: Must be a valid object
      const data = event.data;
      if (!data || typeof data !== 'object') {
        return; // Silently ignore - malformed
      }

      // STRICT FILTER 3: Must be our security controller
      if (data.controller !== SecurityBridge._CONTROLLER) {
        return; // Silently ignore - different protocol channel
      }

      // STRICT FILTER 4: Must have a valid request type
      const validTypes = [
        'SDK_INPUT_EVENTS_REQUEST',
        'SDK_INPUT_SKETCH_REQUEST', 
        'SDK_CANVAS_SAMPLE_REQUEST',
        'SDK_CANVAS_EMBED_REQUEST',
        'SDK_META_REQUEST',
        'SDK_SESSION_INIT',
        'SDK_CHECKPOINT_REQUEST',
        'SDK_CHECKPOINT_ACK'
      ];
      if (!validTypes.includes(data.type)) {
        log.warn(`Unknown security request type: ${data.type}`);
        return;
      }

      // Validate origin
      if (!SecurityBridge._ALLOWED_ORIGINS.includes(event.origin)) {
        log.warn(`❌ Rejected request from unauthorized origin: ${event.origin}`);
        return;
      }

      log.request(data.type, { origin: event.origin });

      // Handle the request
      this._handleRequest(event);
    });

    // Send ready signal to parent
    this._sendReady();
  }

  /**
   * Notify parent that security bridge is ready.
   */
  private _sendReady(): void {
    try {
      window.parent.postMessage({
        controller: SecurityBridge._CONTROLLER,
        type: 'SDK_SECURITY_READY',
        ts: Date.now()
      }, '*');
      log.info('📤 Sent SDK_SECURITY_READY to parent');
    } catch (err) {
      log.error('Failed to send SDK_SECURITY_READY', err);
    }
  }

  /**
   * Handle a security request from parent.
   */
  private _handleRequest(event: MessageEvent<SecurityRequest>): void {
    const { type } = event.data;

    try {
      switch (type) {
        case 'SDK_INPUT_EVENTS_REQUEST':
          this._handleInputEventsRequest(event);
          break;

        case 'SDK_INPUT_SKETCH_REQUEST':
          this._handleInputSketchRequest(event);
          break;

        case 'SDK_CANVAS_SAMPLE_REQUEST':
          this._handleCanvasSampleRequest(event);
          break;

        case 'SDK_CANVAS_EMBED_REQUEST':
          this._handleCanvasEmbedRequest(event);
          break;

        case 'SDK_META_REQUEST':
          this._handleMetaRequest(event);
          break;

        case 'SDK_SESSION_INIT':
          this._handleSessionInit(event);
          break;

        case 'SDK_CHECKPOINT_REQUEST':
          this._handleCheckpointRequest(event);
          break;

        case 'SDK_CHECKPOINT_ACK':
          this._handleCheckpointAck(event);
          break;

        default:
          // Unknown request type - ignore
          break;
      }
    } catch (err) {
      // Silently ignore errors - security modules should never crash the game
      log.error('Error handling request', err);
    }
  }

  /**
   * Respond to a request.
   */
  private _respond(event: MessageEvent, response: SecurityResponse): void {
    try {
      log.response(response.type, response);
      (event.source as Window).postMessage(response, event.origin);
    } catch (err) {
      log.error('Failed to send response', err);
    }
  }

  // ============================================================
  // Session & Rolling Hash Handlers
  // ============================================================

  /**
   * Initialize session and rolling hash state.
   * Called by GameBox when session starts.
   */
  private _handleSessionInit(event: MessageEvent): void {
    const { sessionId } = event.data as { sessionId: string };
    
    if (!sessionId) {
      log.error('SDK_SESSION_INIT missing sessionId');
      return;
    }

    const meta = this._metadataCollector.collect();
    const initialHash = computeInitialRollingHash(
      sessionId,
      meta.screenW,
      meta.screenH,
      Date.now()
    );

    this._rollingState = {
      sessionId,
      currentHash: initialHash,
      windowIndex: 0,
      lastNonceW: ''
    };

    log.info(`📋 Session initialized: ${sessionId}`);
    log.info(`📋 Initial rolling hash: ${initialHash.slice(0, 18)}...`);

    // Respond with confirmation
    this._respond(event, {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_SESSION_INIT_ACK',
      sessionId,
      initialHash,
      meta
    } as SecurityResponse);

    // Notify main SDK that session is active (for connection tracking)
    if (this._onSessionInitCallback) {
      this._onSessionInitCallback();
    }
  }

  /**
   * Handle checkpoint request - collect all security data for this window.
   * Returns: inputDigest, canvasHash, rollingHash, sketch
   */
  private _handleCheckpointRequest(event: MessageEvent): void {
    const { seed, nonceW, score } = event.data as { 
      seed: string; 
      nonceW: string;
      score: number;
    };

    if (!this._rollingState) {
      log.warn('Checkpoint requested but no session initialized');
      // Still respond with data, just without rolling hash
    }

    // 1. Get input events and digest
    const rawEvents = this._inputCapture.getEvents();
    this._sketchBuilder.recordEvents(rawEvents);
    const { events, digest: inputDigest } = this._inputCapture.flush();

    // 2. Get canvas sample
    const { canvasHash, sample } = this._canvasHandler.sample(seed || '0x0');

    // 3. Get behavioral sketch for this window, then reset for next
    const sketch = this._sketchBuilder.build();
    this._sketchBuilder.reset();

    // 4. Compute rolling hash (if session is initialized)
    let rollingHash = '0x';
    let windowIndex = 0;

    if (this._rollingState) {
      // Use nonceW from PREVIOUS checkpoint ACK (or empty for first)
      rollingHash = computeRollingHash(
        this._rollingState.currentHash,
        this._rollingState.lastNonceW || nonceW || '0x',
        inputDigest,
        canvasHash,
        score || 0
      );

      windowIndex = this._rollingState.windowIndex;
      
      // Update state for next checkpoint
      this._rollingState.currentHash = rollingHash;
      this._rollingState.windowIndex++;
    }

    log.info(`🔐 Checkpoint ${windowIndex}:`);
    log.info(`   inputDigest: ${inputDigest.slice(0, 18)}...`);
    log.info(`   canvasHash: ${canvasHash.slice(0, 18)}...`);
    log.info(`   rollingHash: ${rollingHash.slice(0, 18)}...`);
    log.info(`   events: ${events.length}, sketch: ${sketch.length} chars`);

    const response: CheckpointResponse = {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_CHECKPOINT_RESPONSE',
      windowIndex,
      inputDigest,
      events,
      canvasHash,
      sample,
      rollingHash,
      sketch
    };

    this._respond(event, response);
  }

  /**
   * Handle checkpoint acknowledgment from server (via GameBox).
   * Updates the nonce for next rolling hash.
   */
  private _handleCheckpointAck(event: MessageEvent): void {
    const { nonceW, windowIndex } = event.data as { 
      nonceW: string;
      windowIndex: number;
    };

    if (this._rollingState) {
      this._rollingState.lastNonceW = nonceW;
      log.info(`✓ Checkpoint ${windowIndex} ACK, nonceW: ${nonceW.slice(0, 18)}...`);
    }
  }

  // ============================================================
  // Standard Security Data Handlers
  // ============================================================

  /**
   * Handle input events request - returns raw events and digest.
   */
  private _handleInputEventsRequest(event: MessageEvent): void {
    // Record events for sketch before flushing
    const rawEvents = this._inputCapture.getEvents();
    log.info(`Processing ${rawEvents.length} raw input events`);
    this._sketchBuilder.recordEvents(rawEvents);

    // Flush and get normalized events with digest (keccak256)
    const { events: normalizedEvents, digest } = this._inputCapture.flush();
    log.info(`Flushed ${normalizedEvents.length} normalized events, digest: ${digest.slice(0, 18)}...`);

    const response: InputEventsResponse = {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_INPUT_EVENTS_RESPONSE',
      events: normalizedEvents,
      digest
    };

    this._respond(event, response);
  }

  /**
   * Handle input sketch request - returns 64-byte behavioral fingerprint.
   */
  private _handleInputSketchRequest(event: MessageEvent): void {
    // Build and get sketch, then reset for next window
    const sketch = this._sketchBuilder.build();
    log.info(`Built input sketch: ${sketch.slice(0, 18)}... (${sketch.length} chars)`);
    
    const response: InputSketchResponse = {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_INPUT_SKETCH_RESPONSE',
      sketch
    };

    this._respond(event, response);
  }

  /**
   * Handle canvas sample request - samples canvas at seed-derived points.
   * Uses keccak256 for deterministic sampling.
   */
  private _handleCanvasSampleRequest(event: MessageEvent): void {
    const { seed } = event.data as { seed: string };
    log.info(`Canvas sample requested with seed: ${seed}`);
    
    const { canvasHash, sample } = this._canvasHandler.sample(seed || '0x0');
    log.info(`Canvas sampled - hash: ${canvasHash.slice(0, 18)}..., sample: ${sample.slice(0, 18)}...`);

    const response: CanvasSampleResponse = {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_CANVAS_SAMPLE_RESPONSE',
      canvasHash,
      sample
    };

    this._respond(event, response);
  }

  /**
   * Handle canvas embed request - embeds watermark in canvas.
   */
  private _handleCanvasEmbedRequest(event: MessageEvent): void {
    const { data } = event.data as { data: string };
    log.info(`Canvas embed requested with data: ${data?.slice(0, 18)}...`);
    
    const { success } = this._canvasHandler.embed(data || '0x0');
    log.info(`Canvas embed ${success ? 'succeeded ✓' : 'failed ✗'}`);

    const response: CanvasEmbedResponse = {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_CANVAS_EMBED_RESPONSE',
      success
    };

    this._respond(event, response);
  }

  /**
   * Handle meta request - returns session metadata.
   */
  private _handleMetaRequest(event: MessageEvent): void {
    const meta = this._metadataCollector.collect();
    log.info('Collected session metadata:', meta);

    const response: MetaResponse = {
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_META_RESPONSE',
      meta
    };

    this._respond(event, response);
  }

  // ============================================================
  // Public Methods (called by main SDK)
  // ============================================================

  /**
   * Compute stateHash for score updates.
   * 
   * stateHash = keccak256(inputDigest || canvasHash || metaFingerprint || score || timestamp)
   * 
   * This ties each score to:
   * - Input events that led to it (inputDigest)
   * - Visual game state at that moment (canvasHash)
   * - Device/environment fingerprint (metaFingerprint)
   * - The score value and time
   * 
   * Called by setProgress() to include cryptographic evidence with each score.
   */
  computeStateHash(score: number): string {
    try {
      const ts = Date.now();
      
      // Get current input digest (flush events)
      const { digest: inputDigest } = this._inputCapture.flush();
      
      // Get quick canvas hash (use score as seed for determinism)
      const { canvasHash } = this._canvasHandler.sample(`0x${score.toString(16).padStart(8, '0')}`);
      
      // Get device fingerprint from SessionMeta
      // Uses stable properties that don't change during gameplay
      const meta = this._metadataCollector.collect();
      const metaFingerprint = keccak256(
        `${meta.screenW}|${meta.screenH}|${meta.dpr}|${meta.platform}|${meta.touchCapable}`
      );
      
      // Compute combined stateHash
      const preimage = `${inputDigest}|${canvasHash}|${metaFingerprint}|${score}|${ts}`;
      const stateHash = keccak256(preimage);
      
      log.info(`🔐 StateHash computed: ${stateHash.slice(0, 18)}...`);
      log.info(`   inputDigest: ${inputDigest.slice(0, 18)}...`);
      log.info(`   canvasHash: ${canvasHash.slice(0, 18)}...`);
      log.info(`   metaFingerprint: ${metaFingerprint.slice(0, 18)}...`);
      log.info(`   score: ${score}, ts: ${ts}`);
      
      return stateHash;
    } catch (err) {
      log.error('Failed to compute stateHash', err);
      // Return empty hash on failure - don't crash the game
      return '0x';
    }
  }

  /**
   * Get current rolling hash state (for debugging).
   */
  getRollingState(): RollingHashState | null {
    return this._rollingState ? { ...this._rollingState } : null;
  }
}
