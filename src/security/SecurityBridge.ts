/**
 * SecurityBridge (SDK Shim)
 *
 * Ultra-thin bridge between game iframe and GameBox parent.
 * NO crypto, NO hashing, NO sketch building, NO rolling state.
 *
 * Responsibilities:
 *   1. Listen for postMessage requests from GameBox
 *   2. Collect raw data (input events, canvas pixels, metadata)
 *   3. Send raw data back to GameBox
 *
 * All computation happens in the Security Worker (GameBox side).
 */

import { InputCapture } from './InputCapture';
import { CanvasHandler } from './CanvasHandler';
import { MetadataCollector } from './MetadataCollector';
import { log } from './logger';

export class SecurityBridge {
  private _input = new InputCapture();
  private _canvas = new CanvasHandler();
  private _meta = new MetadataCollector();
  private _isInitialized = false;
  private _onSessionInitCallback: (() => void) | null = null;

  private static readonly _CONTROLLER = '_digitapSecurity';
  private static readonly _VALID_TYPES = [
    'SDK_SESSION_INIT',
    'SDK_CHECKPOINT_REQUEST',
    'SDK_CHECKPOINT_ACK',
    'SDK_CANVAS_EMBED_REQUEST',
    'SDK_META_REQUEST',
  ];

  onSessionInit(callback: () => void): void {
    this._onSessionInitCallback = callback;
  }

  init(): void {
    if (this._isInitialized) return;
    this._isInitialized = true;

    this._input.start();
    this._canvas.start();
    this._listen();

    log.info('SecurityBridge ready (shim mode - no crypto)');
  }

  stop(): void {
    if (!this._isInitialized) return;
    this._isInitialized = false;
    this._input.stop();
    this._canvas.stop();
  }

  private _listen(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.controller !== SecurityBridge._CONTROLLER) return;
      if (!SecurityBridge._VALID_TYPES.includes(data.type)) return;

      log.request(data.type);

      try {
        this._handle(event);
      } catch {
        // Security shim must never crash the game
      }
    });

    window.parent.postMessage({
      controller: SecurityBridge._CONTROLLER,
      type: 'SDK_SECURITY_READY',
      ts: Date.now()
    }, '*');
  }

  private _handle(event: MessageEvent): void {
    const { type } = event.data;

    switch (type) {
      case 'SDK_SESSION_INIT': {
        const meta = this._meta.collect();
        this._respond(event, {
          controller: SecurityBridge._CONTROLLER,
          type: 'SDK_SESSION_INIT_ACK',
          meta,
          ts: Date.now()
        });
        this._onSessionInitCallback?.();
        break;
      }

      case 'SDK_CHECKPOINT_REQUEST': {
        const { seed, skipCanvas } = event.data;
        const events = this._input.flush();
        const pixels = skipCanvas !== false ? null : this._canvas.sampleRaw(seed ?? 0);

        this._respond(event, {
          controller: SecurityBridge._CONTROLLER,
          type: 'SDK_CHECKPOINT_RESPONSE',
          events,
          pixels,
          eventCount: events.length,
          screenW: window.innerWidth,
          screenH: window.innerHeight
        });
        break;
      }

      case 'SDK_CANVAS_EMBED_REQUEST': {
        const { data } = event.data;
        const ok = data instanceof Uint8Array
          ? this._canvas.embedWatermark(data)
          : false;

        this._respond(event, {
          controller: SecurityBridge._CONTROLLER,
          type: 'SDK_CANVAS_EMBED_RESPONSE',
          success: ok
        });
        break;
      }

      case 'SDK_META_REQUEST': {
        this._respond(event, {
          controller: SecurityBridge._CONTROLLER,
          type: 'SDK_META_RESPONSE',
          meta: this._meta.collect()
        });
        break;
      }

      case 'SDK_CHECKPOINT_ACK':
        break;
    }
  }

  private _respond(event: MessageEvent, response: Record<string, unknown>): void {
    try {
      (event.source as Window).postMessage(response, event.origin);
    } catch {
      // Silently fail
    }
  }
}
