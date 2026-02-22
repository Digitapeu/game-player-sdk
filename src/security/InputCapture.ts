/**
 * InputCapture (SDK Shim)
 *
 * Passively captures raw input events with minimal overhead.
 * Returns compact tuples - NO normalization, NO hashing, NO digest.
 * All processing happens in the Security Worker.
 *
 * Uses feature detection to register ONLY the event family the platform supports:
 *   - PointerEvent available → pointerdown/pointerup only (covers touch + mouse)
 *   - No PointerEvent, touch available → touchstart/touchend only
 *   - Neither → mousedown/mouseup only
 *
 * This prevents the "6 handlers fire per tap" problem that causes jank on low-end Android.
 */

import type { RawEventTuple } from '../worker/types';
import { log } from './logger';

export class InputCapture {
  private _buffer: RawEventTuple[] = [];
  private _isStarted = false;
  private _boundCapture: (e: Event) => void;
  private _events: readonly string[] = [];
  private _canvas: HTMLCanvasElement | null = null;
  private _canvasPollTimer: number | null = null;

  private static readonly _MAX_BUFFER = 5000;

  constructor() {
    this._boundCapture = (e: Event) => this._capture(e);
  }

  start(): void {
    if (this._isStarted) return;
    this._isStarted = true;

    this._events = InputCapture._detectEvents();

    this._events.forEach(type => {
      window.addEventListener(type, this._boundCapture, { capture: true, passive: true });
    });

    this._pollForCanvas();
    log.info('InputCapture listening for:', this._events.join(', '));
  }

  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;

    this._events.forEach(type => {
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

  /**
   * Pick ONE event family. Pointer Events already unify touch + mouse,
   * so we never need to listen for more than one family.
   */
  private static _detectEvents(): readonly string[] {
    if (typeof PointerEvent !== 'undefined') {
      return ['pointerdown', 'pointerup'];
    }
    if ('ontouchstart' in window) {
      return ['touchstart', 'touchend'];
    }
    return ['mousedown', 'mouseup'];
  }

  private _capture(e: Event): void {
    if (this._buffer.length >= InputCapture._MAX_BUFFER) return;

    const now = performance.now();
    const type = e.type;
    const isDown = type === 'pointerdown' || type === 'touchstart' || type === 'mousedown';

    let x = 0, y = 0;

    if ('clientX' in e) {
      x = (e as PointerEvent | MouseEvent).clientX;
      y = (e as PointerEvent | MouseEvent).clientY;
    } else if ('touches' in e) {
      const touches = (e as TouchEvent).touches;
      const changed = (e as TouchEvent).changedTouches;
      const list = touches.length > 0 ? touches : changed;
      if (list.length > 0) {
        x = list[0].clientX;
        y = list[0].clientY;
      }
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
    this._events.forEach(type => {
      canvas.addEventListener(type, this._boundCapture, { capture: true, passive: true });
    });
    log.info('InputCapture attached to canvas element');
  }

  private _detachCanvas(): void {
    if (!this._canvas) return;
    this._events.forEach(type => {
      this._canvas!.removeEventListener(type, this._boundCapture, { capture: true } as EventListenerOptions);
    });
    this._canvas = null;
  }
}
