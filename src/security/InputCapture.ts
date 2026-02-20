/**
 * InputCapture (SDK Shim)
 *
 * Passively captures raw input events with minimal overhead.
 * Returns compact tuples - NO normalization, NO hashing, NO digest.
 * All processing happens in the Security Worker.
 *
 * Listens for ALL input event types to cover every game engine:
 *   - Pointer Events (Construct 3, Phaser 3, Unity WebGL, modern engines)
 *   - Touch Events (older engines, mobile-specific code)
 *   - Mouse Events (desktop fallback, legacy engines)
 *
 * A single physical tap can fire pointerdown → touchstart → mousedown
 * within ~1-5ms. We deduplicate by tracking the last down/up timestamp
 * and dropping events within a 30ms window.
 *
 * All listeners use { capture: true } to fire in the capture phase
 * (top-down), before game engines can call stopPropagation().
 */

import type { RawEventTuple } from '../worker/types';
import { log } from './logger';

const DOWN_EVENTS = ['pointerdown', 'touchstart', 'mousedown'] as const;
const UP_EVENTS = ['pointerup', 'touchend', 'mouseup'] as const;
const ALL_EVENTS = [...DOWN_EVENTS, ...UP_EVENTS] as const;

export class InputCapture {
  private _buffer: RawEventTuple[] = [];
  private _isStarted = false;
  private _boundCapture: (e: Event) => void;

  // Dedup: a physical tap fires pointerdown→touchstart→mousedown within ~1-5ms.
  // Track last down/up timestamp separately to keep only the first of each.
  private _lastDownTs = 0;
  private _lastUpTs = 0;

  private _canvas: HTMLCanvasElement | null = null;
  private _canvasPollTimer: number | null = null;

  private static readonly _MAX_BUFFER = 5000;
  private static readonly _DEDUP_MS = 30;

  constructor() {
    this._boundCapture = (e: Event) => this._capture(e);
  }

  start(): void {
    if (this._isStarted) return;
    this._isStarted = true;

    ALL_EVENTS.forEach(type => {
      window.addEventListener(type, this._boundCapture, { capture: true, passive: true });
    });

    this._pollForCanvas();
    log.info('InputCapture listening (capture phase) for:', ALL_EVENTS.join(', '));
  }

  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;

    ALL_EVENTS.forEach(type => {
      window.removeEventListener(type, this._boundCapture, { capture: true } as EventListenerOptions);
    });

    this._detachCanvas();

    if (this._canvasPollTimer !== null) {
      clearInterval(this._canvasPollTimer);
      this._canvasPollTimer = null;
    }

    this._buffer = [];
  }

  flush(): RawEventTuple[] {
    const out = this._buffer;
    this._buffer = [];
    return out;
  }

  private _capture(e: Event): void {
    if (this._buffer.length >= InputCapture._MAX_BUFFER) return;

    const now = performance.now();
    const type = e.type;

    // Classify as down (tap) or up (release)
    const isDown = type === 'pointerdown' || type === 'touchstart' || type === 'mousedown';

    // Dedup: drop if same action class fired within 30ms (pointer→touch→mouse chain)
    if (isDown) {
      if ((now - this._lastDownTs) < InputCapture._DEDUP_MS) return;
      this._lastDownTs = now;
    } else {
      if ((now - this._lastUpTs) < InputCapture._DEDUP_MS) return;
      this._lastUpTs = now;
    }

    let x = 0, y = 0;

    // Pointer Events (highest priority - most modern engines)
    if ('clientX' in e && 'pointerId' in e) {
      x = (e as PointerEvent).clientX;
      y = (e as PointerEvent).clientY;
    }
    // Touch Events
    else if ('touches' in e) {
      const touches = (e as TouchEvent).touches;
      const changed = (e as TouchEvent).changedTouches;
      const list = touches.length > 0 ? touches : changed;
      if (list.length > 0) {
        x = list[0].clientX;
        y = list[0].clientY;
      }
    }
    // Mouse Events
    else if ('clientX' in e) {
      x = (e as MouseEvent).clientX;
      y = (e as MouseEvent).clientY;
    }

    this._buffer.push({ t: now, x, y, e: isDown ? 1 : 0 });
  }

  private _pollForCanvas(): void {
    this._tryAttachCanvas();

    this._canvasPollTimer = window.setInterval(() => {
      if (this._canvas) {
        clearInterval(this._canvasPollTimer!);
        this._canvasPollTimer = null;
        return;
      }
      this._tryAttachCanvas();
    }, 500);
  }

  private _tryAttachCanvas(): void {
    const canvas = document.querySelector('canvas');
    if (!canvas || canvas === this._canvas) return;

    this._canvas = canvas;
    ALL_EVENTS.forEach(type => {
      canvas.addEventListener(type, this._boundCapture, { capture: true, passive: true });
    });
    log.info('InputCapture attached to canvas element');
  }

  private _detachCanvas(): void {
    if (!this._canvas) return;
    ALL_EVENTS.forEach(type => {
      this._canvas!.removeEventListener(type, this._boundCapture, { capture: true } as EventListenerOptions);
    });
    this._canvas = null;
  }
}
