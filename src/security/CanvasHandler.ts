/**
 * CanvasHandler (SDK Shim)
 *
 * Reads raw pixel data from the game canvas. NO hashing, NO crypto.
 * Returns raw Uint8Array - the Security Worker computes the hash.
 *
 * Handles both 2D and WebGL canvases (e.g., Construct 3, Phaser).
 */

import { log } from './logger';

export class CanvasHandler {
  private _canvas: HTMLCanvasElement | null = null;
  private _ctx: CanvasRenderingContext2D | null = null;
  private _glCtx: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private _samplerCanvas: HTMLCanvasElement | null = null;
  private _samplerCtx: CanvasRenderingContext2D | null = null;
  private _findInterval: number | null = null;
  private _isStarted = false;
  private _isWebGL = false;

  private static readonly _SAMPLE_POINTS = 8;

  start(): void {
    if (this._isStarted) return;
    this._isStarted = true;
    this._findCanvas();
    this._findInterval = window.setInterval(() => this._findCanvas(), 500);
  }

  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;
    if (this._findInterval !== null) {
      clearInterval(this._findInterval);
      this._findInterval = null;
    }
  }

  /**
   * Sample canvas at deterministic points and return raw RGBA bytes.
   * Seed is provided by GameBox (from server nonce). Worker hashes the result.
   */
  sampleRaw(seed: number): Uint8Array | null {
    this._findCanvas();
    if (!this._canvas) return null;

    const ctx = this._getReadableContext();
    if (!ctx) return null;

    const w = this._canvas.width;
    const h = this._canvas.height;
    if (w === 0 || h === 0) return null;

    const samples = new Uint8Array(CanvasHandler._SAMPLE_POINTS * 16);

    try {
      for (let i = 0; i < CanvasHandler._SAMPLE_POINTS; i++) {
        const pointSeed = this._prng(seed, i);
        const x = pointSeed % w;
        const y = Math.floor(pointSeed / w) % h;

        const block = ctx.getImageData(x, y, 2, 2).data;
        samples.set(block, i * 16);
      }
      return samples;
    } catch {
      log.warn('Canvas sample failed');
      return null;
    }
  }

  /**
   * Write raw watermark bytes into canvas LSB (steganography).
   * Watermark data is computed by Worker, sent here via GameBox.
   */
  embedWatermark(data: Uint8Array): boolean {
    if (!this._ctx || !this._canvas) return false;

    try {
      const region = { x: 0, y: 0, w: 64, h: 8 };
      const imageData = this._ctx.getImageData(region.x, region.y, region.w, region.h);
      const pixels = imageData.data;
      const maxBits = Math.min(data.length * 8, Math.floor(pixels.length / 4));

      for (let i = 0; i < maxBits; i++) {
        const byteIdx = Math.floor(i / 8);
        const bitIdx = 7 - (i % 8);
        const bit = (data[byteIdx] >> bitIdx) & 1;
        const pixelIdx = i * 4 + 2; // blue channel LSB
        pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
      }

      this._ctx.putImageData(imageData, region.x, region.y);
      return true;
    } catch {
      return false;
    }
  }

  private _findCanvas(): void {
    if (this._canvas) return;

    this._canvas = document.querySelector('canvas');
    if (!this._canvas) return;

    log.info(`Canvas found: ${this._canvas.width}x${this._canvas.height}`);

    try {
      this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
      if (this._ctx) {
        this._isWebGL = false;
      } else {
        this._glCtx = (this._canvas.getContext('webgl2') as WebGL2RenderingContext)
          || (this._canvas.getContext('webgl') as WebGLRenderingContext);

        if (this._glCtx) {
          this._isWebGL = true;
          this._samplerCanvas = document.createElement('canvas');
          this._samplerCanvas.width = this._canvas.width;
          this._samplerCanvas.height = this._canvas.height;
          this._samplerCtx = this._samplerCanvas.getContext('2d', { willReadFrequently: true });
        }
      }
    } catch (err) {
      log.warn('Failed to get canvas context', err);
    }

    if (this._findInterval !== null) {
      clearInterval(this._findInterval);
      this._findInterval = null;
    }
  }

  private _getReadableContext(): CanvasRenderingContext2D | null {
    if (!this._canvas) return null;

    if (this._ctx) return this._ctx;

    if (this._isWebGL && this._samplerCanvas && this._samplerCtx) {
      try {
        if (this._samplerCanvas.width !== this._canvas.width ||
            this._samplerCanvas.height !== this._canvas.height) {
          this._samplerCanvas.width = this._canvas.width;
          this._samplerCanvas.height = this._canvas.height;
        }
        this._samplerCtx.drawImage(this._canvas, 0, 0);
        return this._samplerCtx;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Simple PRNG from seed+index. Not crypto - just deterministic point selection.
   */
  private _prng(seed: number, index: number): number {
    let h = seed ^ (index * 2654435761);
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
}
