/**
 * InputCapture Module
 * 
 * Captures all user input events passively and provides:
 * - Raw events array with normalized coordinates (0-1)
 * - Backend can compute digest if needed for verification
 */

import type { InputEvent, RawInputEvent } from '../types';
import { log } from './logger';

export class InputCapture {
  private _buffer: RawInputEvent[] = [];
  private _lastEventTime = 0;
  private _activePointers = new Map<number, { startTime: number; x: number; y: number }>();
  private _isStarted = false;
  private _boundCapture: (e: Event) => void;

  private static readonly _MAX_BUFFER_SIZE = 5000; // Prevent unbounded growth

  constructor() {
    // Bind once so we can remove later
    this._boundCapture = (e: Event) => this._capture(e);
  }

  /**
   * Start capturing input events.
   * NOTE: We only capture start/end events, NOT move events (too frequent on mobile).
   */
  start(): void {
    if (this._isStarted) {
      return;
    }
    this._isStarted = true;

    // Only capture tap/release - NOT move events (they fire 60+ fps and kill mobile)
    const events = ['touchstart', 'touchend', 'mousedown', 'mouseup'];
    events.forEach(type => {
      window.addEventListener(type, this._boundCapture, { passive: true });
    });
    log.info(`InputCapture listening for: ${events.join(', ')}`);

    // Hold detection only runs when there are active pointers (lazy)
    // No interval needed - we detect holds on flush
  }

  /**
   * Stop capturing input events.
   */
  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;

    // Remove event listeners
    const events = ['touchstart', 'touchend', 'mousedown', 'mouseup'];
    events.forEach(type => {
      window.removeEventListener(type, this._boundCapture);
    });

    // Clear state
    this._activePointers.clear();
    this._buffer = [];
    this._lastEventTime = 0;
  }

  /**
   * Capture a DOM event and add to buffer.
   */
  private _capture(e: Event): void {
    const now = performance.now();
    const dt = this._lastEventTime > 0 ? now - this._lastEventTime : 0;
    this._lastEventTime = now;

    const raw: RawInputEvent = {
      type: e.type,
      ts: now,
      dt,
      pointerId: 0
    };

    // Extract coordinates from mouse events
    if ('clientX' in e) {
      raw.x = (e as MouseEvent).clientX;
      raw.y = (e as MouseEvent).clientY;
    }

    // Extract coordinates from touch events
    if ('touches' in e) {
      const touches = (e as TouchEvent).touches;
      const changedTouches = (e as TouchEvent).changedTouches;
      
      // For touchend, use changedTouches since touches will be empty
      const touchList = touches.length > 0 ? touches : changedTouches;
      
      if (touchList.length > 0) {
        const touch = touchList[0];
        raw.x = touch.clientX;
        raw.y = touch.clientY;
        raw.pointerId = touch.identifier;
      }
    }

    // Get pointerId for pointer events
    if ('pointerId' in e) {
      raw.pointerId = (e as PointerEvent).pointerId;
    }

    // Track active pointers for hold detection
    if (e.type === 'touchstart' || e.type === 'mousedown') {
      if (raw.x !== undefined && raw.y !== undefined) {
        this._activePointers.set(raw.pointerId, { startTime: now, x: raw.x, y: raw.y });
      }
    } else if (e.type === 'touchend' || e.type === 'mouseup') {
      this._activePointers.delete(raw.pointerId);
    }

    // Prevent unbounded buffer growth
    if (this._buffer.length < InputCapture._MAX_BUFFER_SIZE) {
      this._buffer.push(raw);
    }
  }

  /**
   * Flush the event buffer and return normalized events.
   * Note: Hash computation skipped for performance - backend can hash if needed.
   */
  flush(): { events: InputEvent[]; digest: string } {
    const events = this._normalize(this._buffer);
    this._buffer = [];
    return { events, digest: '0x0' }; // Backend computes hash if needed
  }

  /**
   * Get events without flushing (for sketch building).
   */
  getEvents(): RawInputEvent[] {
    return [...this._buffer];
  }

  /**
   * Normalize raw events to backend format.
   */
  private _normalize(raw: RawInputEvent[]): InputEvent[] {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;

    return raw.map(e => ({
      type: this._mapType(e.type),
      x: e.x !== undefined ? e.x / w : 0,
      y: e.y !== undefined ? e.y / h : 0,
      dt: Math.round(e.dt),
      pointerId: e.pointerId ?? 0
    }));
  }

  /**
   * Map DOM event type to backend event type.
   * Note: Only tap/release captured now (move events removed for performance).
   */
  private _mapType(domType: string): 'tap' | 'release' {
    switch (domType) {
      case 'touchstart':
      case 'mousedown':
        return 'tap';
      case 'touchend':
      case 'mouseup':
        return 'release';
      default:
        return 'tap';
    }
  }
}
