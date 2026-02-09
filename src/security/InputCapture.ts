/**
 * InputCapture Module
 * 
 * Captures all user input events passively and provides:
 * - Raw events array with normalized coordinates (0-1)
 * - keccak256 digest of events for integrity verification (Ethereum-compatible)
 * - Hold detection (>300ms threshold)
 */

import type { InputEvent, RawInputEvent } from '../types';
import { keccak256, canonicalJSON } from './utils';
import { log } from './logger';

export class InputCapture {
  private _buffer: RawInputEvent[] = [];
  private _lastEventTime = 0;
  private _activePointers = new Map<number, { startTime: number; x: number; y: number }>();
  private _holdCheckInterval: number | null = null;
  private _isStarted = false;
  private _boundCapture: (e: Event) => void;

  private static readonly _HOLD_THRESHOLD_MS = 300;
  private static readonly _MAX_BUFFER_SIZE = 10000; // Prevent unbounded growth

  constructor() {
    // Bind once so we can remove later
    this._boundCapture = (e: Event) => this._capture(e);
  }

  /**
   * Start capturing input events.
   */
  start(): void {
    if (this._isStarted) {
      log.warn('InputCapture already started');
      return;
    }
    this._isStarted = true;

    const events = ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup'];
    events.forEach(type => {
      window.addEventListener(type, this._boundCapture, { passive: true });
    });
    log.info(`InputCapture listening for: ${events.join(', ')}`);

    // Periodic hold detection
    this._holdCheckInterval = window.setInterval(() => this._checkHolds(), 100);
    log.info('Hold detection interval started (100ms)');
  }

  /**
   * Stop capturing input events.
   */
  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;

    // Remove event listeners
    const events = ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup'];
    events.forEach(type => {
      window.removeEventListener(type, this._boundCapture);
    });

    if (this._holdCheckInterval !== null) {
      clearInterval(this._holdCheckInterval);
      this._holdCheckInterval = null;
    }
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
      log.event(`TAP at (${raw.x?.toFixed(0)}, ${raw.y?.toFixed(0)}) - buffer: ${this._buffer.length + 1}`);
    } else if (e.type === 'touchend' || e.type === 'mouseup') {
      this._activePointers.delete(raw.pointerId);
      log.event(`RELEASE at (${raw.x?.toFixed(0)}, ${raw.y?.toFixed(0)}) - buffer: ${this._buffer.length + 1}`);
    }

    // Prevent unbounded buffer growth
    if (this._buffer.length < InputCapture._MAX_BUFFER_SIZE) {
      this._buffer.push(raw);
    }
  }

  /**
   * Check for hold gestures (pointer held > threshold).
   */
  private _checkHolds(): void {
    const now = performance.now();
    for (const [pointerId, pointer] of this._activePointers) {
      if (now - pointer.startTime > InputCapture._HOLD_THRESHOLD_MS) {
        this._buffer.push({
          type: 'hold',
          ts: now,
          dt: now - this._lastEventTime,
          x: pointer.x,
          y: pointer.y,
          pointerId
        });
        // Reset start time to prevent duplicate holds
        pointer.startTime = now;
      }
    }
  }

  /**
   * Flush the event buffer and return normalized events with digest.
   * Digest is keccak256 hash for backend verification.
   */
  flush(): { events: InputEvent[]; digest: string } {
    const events = this._normalize(this._buffer);
    const digest = keccak256(canonicalJSON(events));
    this._buffer = [];
    log.info(`Flushed ${events.length} events, digest: ${digest.slice(0, 18)}...`);
    return { events, digest };
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
   */
  private _mapType(domType: string): 'tap' | 'swipe' | 'hold' | 'release' {
    switch (domType) {
      case 'touchstart':
      case 'mousedown':
        return 'tap';
      case 'touchmove':
      case 'mousemove':
        return 'swipe';
      case 'touchend':
      case 'mouseup':
        return 'release';
      case 'hold':
        return 'hold';
      default:
        return 'tap';
    }
  }
}
