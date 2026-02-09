/**
 * SketchBuilder Module
 * 
 * Builds a 64-byte behavioral fingerprint for bot detection.
 * 
 * Layout:
 *   Bytes 0-7:   Tap interval histogram (8 buckets)
 *   Bytes 8-15:  Touch zone distribution (8 zones: 4x2 grid)
 *   Bytes 16-23: Velocity histogram (8 buckets)
 *   Bytes 24-47: Reserved for future use
 *   Bytes 48-55: Entropy measures
 *   Bytes 56-63: Metadata (event counts)
 */

import type { RawInputEvent } from '../types';
import { bytesToHex } from './utils';

export class SketchBuilder {
  private _tapIntervals: number[] = [];
  private _lastTapTime = 0;
  private _touchZones = new Uint8Array(8);
  private _velocities: number[] = [];
  private _lastPosition: { x: number; y: number; ts: number } | null = null;

  /**
   * Record an input event for sketch building.
   */
  recordEvent(e: RawInputEvent): void {
    const now = e.ts;

    // Track tap intervals
    if (e.type === 'touchstart' || e.type === 'mousedown') {
      if (this._lastTapTime > 0) {
        const interval = now - this._lastTapTime;
        this._tapIntervals.push(interval);
      }
      this._lastTapTime = now;

      // Record touch zone (8 zones: 4 columns × 2 rows)
      if (e.x !== undefined && e.y !== undefined) {
        const w = window.innerWidth || 1;
        const h = window.innerHeight || 1;
        const col = Math.min(Math.floor((e.x / w) * 4), 3);
        const row = Math.min(Math.floor((e.y / h) * 2), 1);
        const zone = row * 4 + col;
        this._touchZones[zone] = Math.min(this._touchZones[zone] + 1, 255);
      }
    }

    // Track velocities on move events
    if ((e.type === 'touchmove' || e.type === 'mousemove') && 
        e.x !== undefined && e.y !== undefined) {
      if (this._lastPosition !== null) {
        const dx = e.x - this._lastPosition.x;
        const dy = e.y - this._lastPosition.y;
        const dt = now - this._lastPosition.ts;
        
        // Only record if dt is reasonable (>1ms) to avoid Infinity/NaN
        if (dt > 1) {
          const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
          // Sanity check: cap velocity at reasonable max (10000 px/ms is absurd)
          if (isFinite(velocity) && velocity < 10000) {
            this._velocities.push(velocity);
          }
        }
      }
      
      this._lastPosition = { x: e.x, y: e.y, ts: now };
    }

    // Reset position tracking on release
    if (e.type === 'touchend' || e.type === 'mouseup') {
      this._lastPosition = null;
    }
  }

  /**
   * Record multiple events (from InputCapture buffer).
   */
  recordEvents(events: RawInputEvent[]): void {
    for (const e of events) {
      this.recordEvent(e);
    }
  }

  /**
   * Build the 64-byte behavioral fingerprint.
   */
  build(): string {
    const sketch = new Uint8Array(64);

    // Bytes 0-7: Tap interval histogram
    const tapHist = this._histogram(this._tapIntervals, [50, 100, 150, 200, 250, 300, 350]);
    sketch.set(this._normalizeHist(tapHist), 0);

    // Bytes 8-15: Touch zone distribution
    sketch.set(this._normalizeHist(this._touchZones), 8);

    // Bytes 16-23: Velocity histogram
    const velHist = this._histogram(this._velocities, [0.5, 1, 2, 4, 8, 16, 32]);
    sketch.set(this._normalizeHist(velHist), 16);

    // Bytes 24-47: Reserved (zeros)

    // Bytes 48-55: Entropy measures
    sketch[48] = Math.floor(this._entropy(this._tapIntervals) * 255);
    sketch[49] = Math.floor(this._entropy(Array.from(this._touchZones)) * 255);
    sketch[50] = Math.floor(this._entropy(this._velocities) * 255);
    sketch[51] = Math.floor(this._uniformity(this._touchZones) * 255);
    // Bytes 52-55: Reserved

    // Bytes 56-63: Metadata
    sketch[56] = Math.min(this._tapIntervals.length, 255);
    sketch[57] = Math.min(this._velocities.length, 255);
    
    // Total tap count
    const totalTaps = Array.from(this._touchZones).reduce((a, b) => a + b, 0);
    sketch[58] = Math.min(totalTaps, 255);
    
    // Unique zones touched
    const zonesUsed = Array.from(this._touchZones).filter(v => v > 0).length;
    sketch[59] = zonesUsed;

    // Bytes 60-63: Reserved

    return bytesToHex(sketch);
  }

  /**
   * Reset the sketch builder for a new session.
   */
  reset(): void {
    this._tapIntervals = [];
    this._lastTapTime = 0;
    this._touchZones = new Uint8Array(8);
    this._velocities = [];
    this._lastPosition = null;
  }

  /**
   * Build a histogram of values into buckets.
   */
  private _histogram(values: number[], thresholds: number[]): Uint8Array {
    const hist = new Uint8Array(8);
    
    for (const v of values) {
      let bucket = thresholds.length;
      for (let i = 0; i < thresholds.length; i++) {
        if (v < thresholds[i]) {
          bucket = i;
          break;
        }
      }
      hist[Math.min(bucket, 7)]++;
    }
    
    return hist;
  }

  /**
   * Normalize histogram to 0-255 range based on proportions.
   */
  private _normalizeHist(hist: Uint8Array): Uint8Array {
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    return new Uint8Array(hist.map(v => Math.floor((v / total) * 255)));
  }

  /**
   * Calculate Shannon entropy of values (normalized to 0-1).
   */
  private _entropy(values: number[]): number {
    if (values.length === 0) return 0;

    // Bucket values for distribution
    const bucketSize = 50;
    const counts = new Map<number, number>();
    
    for (const v of values) {
      const bucket = Math.floor(v / bucketSize);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }

    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / values.length;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }

    // Normalize to 0-1 (max entropy for reasonable bucket count ~3-4)
    return Math.min(entropy / 3, 1);
  }

  /**
   * Calculate uniformity of zone distribution (0 = concentrated, 1 = uniform).
   */
  private _uniformity(zones: Uint8Array): number {
    const total = zones.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;

    const expected = total / zones.length;
    let deviation = 0;
    
    for (const count of zones) {
      deviation += Math.abs(count - expected);
    }

    // Normalize: max deviation is 2*total, so divide by that
    return 1 - (deviation / (2 * total));
  }
}
