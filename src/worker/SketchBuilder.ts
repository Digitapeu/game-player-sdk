/**
 * SketchBuilder (Worker)
 *
 * Builds a 64-byte behavioral fingerprint for bot detection.
 * Runs inside the Security Worker - zero main-thread impact.
 *
 * Layout:
 *   Bytes 0-7:   Tap interval histogram (8 buckets)
 *   Bytes 8-15:  Touch zone distribution (8 zones: 4x2 grid)
 *   Bytes 16-23: Velocity histogram (8 buckets)
 *   Bytes 24-47: Reserved
 *   Bytes 48-55: Entropy measures
 *   Bytes 56-63: Metadata (event counts)
 */

import type { RawEventTuple } from './types';
import { bytesToHex } from './crypto';

export class SketchBuilder {
  private _tapIntervals: number[] = [];
  private _lastTapTime = 0;
  private _touchZones = new Uint8Array(8);
  private _velocities: number[] = [];
  private _lastTap: { x: number; y: number; t: number } | null = null;
  private _tapCount = 0;

  /**
   * Ingest a batch of raw event tuples from the SDK shim.
   */
  ingest(events: RawEventTuple[], screenW: number, screenH: number): void {
    for (const ev of events) {
      if (ev.e === 1) {
        // Tap event
        this._tapCount++;

        if (this._lastTapTime > 0) {
          this._tapIntervals.push(ev.t - this._lastTapTime);
        }
        this._lastTapTime = ev.t;

        // Touch zone (8 zones: 4 cols x 2 rows)
        const col = Math.max(0, Math.min(Math.floor((ev.x / (screenW || 1)) * 4), 3));
        const row = Math.max(0, Math.min(Math.floor((ev.y / (screenH || 1)) * 2), 1));
        const zone = row * 4 + col;
        this._touchZones[zone] = Math.min(this._touchZones[zone] + 1, 255);

        // Velocity between taps
        if (this._lastTap !== null) {
          const dx = ev.x - this._lastTap.x;
          const dy = ev.y - this._lastTap.y;
          const dt = ev.t - this._lastTap.t;
          if (dt > 1) {
            const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
            if (isFinite(velocity) && velocity < 10000) {
              this._velocities.push(velocity);
            }
          }
        }
        this._lastTap = { x: ev.x, y: ev.y, t: ev.t };
      }
    }
  }

  build(): string {
    const sketch = new Uint8Array(64);

    // Bytes 0-7: Tap interval histogram
    sketch.set(this._normalizeHist(
      this._histogram(this._tapIntervals, [50, 100, 150, 200, 250, 300, 350])
    ), 0);

    // Bytes 8-15: Touch zone distribution
    sketch.set(this._normalizeHist(this._touchZones), 8);

    // Bytes 16-23: Velocity histogram
    sketch.set(this._normalizeHist(
      this._histogram(this._velocities, [0.5, 1, 2, 4, 8, 16, 32])
    ), 16);

    // Bytes 48-55: Entropy
    sketch[48] = Math.floor(this._entropy(this._tapIntervals) * 255);
    sketch[49] = Math.floor(this._entropy(Array.from(this._touchZones)) * 255);
    sketch[50] = Math.floor(this._entropy(this._velocities) * 255);
    sketch[51] = Math.floor(this._uniformity(this._touchZones) * 255);

    // Bytes 56-63: Metadata
    sketch[56] = Math.min(this._tapIntervals.length, 255);
    sketch[57] = Math.min(this._velocities.length, 255);
    sketch[58] = Math.min(this._tapCount, 255);
    const zonesUsed = Array.from(this._touchZones).filter(v => v > 0).length;
    sketch[59] = zonesUsed;

    return bytesToHex(sketch);
  }

  reset(): void {
    this._tapIntervals = [];
    this._lastTapTime = 0;
    this._touchZones = new Uint8Array(8);
    this._velocities = [];
    this._lastTap = null;
    this._tapCount = 0;
  }

  private _histogram(values: number[], thresholds: number[]): number[] {
    const hist = new Array<number>(8).fill(0);
    for (const v of values) {
      let bucket = thresholds.length;
      for (let i = 0; i < thresholds.length; i++) {
        if (v < thresholds[i]) { bucket = i; break; }
      }
      hist[Math.min(bucket, 7)]++;
    }
    return hist;
  }

  private _normalizeHist(hist: number[] | Uint8Array): Uint8Array {
    const total = Array.from(hist).reduce((a, b) => a + b, 0) || 1;
    return new Uint8Array(Array.from(hist).map(v => Math.floor((v / total) * 255)));
  }

  private _entropy(values: number[]): number {
    if (values.length === 0) return 0;
    const counts = new Map<number, number>();
    for (const v of values) {
      const bucket = Math.floor(v / 50);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / values.length;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return Math.min(entropy / 3, 1);
  }

  private _uniformity(zones: Uint8Array): number {
    const total = zones.reduce((a, b) => a + b, 0);
    if (total === 0) return 0;
    const expected = total / zones.length;
    let deviation = 0;
    for (const count of zones) deviation += Math.abs(count - expected);
    return 1 - (deviation / (2 * total));
  }
}
