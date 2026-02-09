/**
 * CanvasHandler Module
 * 
 * Handles canvas operations for security verification:
 * - Sampling: Deterministic pixel sampling based on seed (keccak256 hash)
 * - Watermarking: LSB steganography in canvas corner regions
 */

import type { CanvasSampleResult, CanvasEmbedResult } from '../types';
import { keccak256Bytes, deterministicRandom, hexToBytes, bytesToHex } from './utils';
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
  private static readonly _WATERMARK_REGION = { x: 0, y: 0, w: 64, h: 8 };

  /**
   * Start looking for the canvas element.
   */
  start(): void {
    if (this._isStarted) {
      log.warn('CanvasHandler already started');
      return;
    }
    this._isStarted = true;

    // Try to find canvas immediately
    this._findCanvas();

    // Keep looking in case canvas is added later
    this._findInterval = window.setInterval(() => this._findCanvas(), 500);
    log.info('CanvasHandler searching for canvas element (polling every 500ms)');
  }

  /**
   * Stop looking for canvas.
   */
  stop(): void {
    if (!this._isStarted) return;
    this._isStarted = false;

    if (this._findInterval !== null) {
      clearInterval(this._findInterval);
      this._findInterval = null;
    }
  }

  /**
   * Find the canvas element in the document.
   * Handles both 2D and WebGL canvases (e.g., Construct 3).
   */
  private _findCanvas(): void {
    if (this._canvas) return;

    this._canvas = document.querySelector('canvas');
    if (this._canvas) {
      log.info(`✓ Canvas found! Size: ${this._canvas.width}x${this._canvas.height}`);
      
      // Try to determine context type by checking existing context
      // Note: calling getContext() with a different type than existing returns null
      try {
        // First try 2D (most common for simple games)
        this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
        if (this._ctx) {
          log.info('✓ Got 2D context with willReadFrequently=true');
          this._isWebGL = false;
        } else {
          // Canvas is likely WebGL - try to get its GL context
          this._glCtx = this._canvas.getContext('webgl2') as WebGL2RenderingContext
                     || this._canvas.getContext('webgl') as WebGLRenderingContext
                     || this._canvas.getContext('experimental-webgl') as WebGLRenderingContext;
          
          if (this._glCtx) {
            log.info('✓ Detected WebGL canvas - using snapshot method for sampling');
            this._isWebGL = true;
            
            // Create offscreen canvas for sampling WebGL content
            this._samplerCanvas = document.createElement('canvas');
            this._samplerCanvas.width = this._canvas.width;
            this._samplerCanvas.height = this._canvas.height;
            this._samplerCtx = this._samplerCanvas.getContext('2d', { willReadFrequently: true });
          } else {
            log.warn('Could not get any canvas context');
          }
        }
      } catch (err) {
        log.warn('Failed to get canvas context', err);
      }
      
      // Stop looking once found
      if (this._findInterval !== null) {
        clearInterval(this._findInterval);
        this._findInterval = null;
        log.info('Stopped canvas polling');
      }
    }
  }

  /**
   * Sample canvas at deterministic points based on seed.
   * Uses keccak256 for hash (Ethereum-compatible).
   * Handles both 2D and WebGL canvases.
   */
  sample(seed: string): CanvasSampleResult {
    // Ensure we have a canvas
    this._findCanvas();

    if (!this._canvas) {
      log.warn('Canvas sample failed - no canvas found');
      return { canvasHash: '0x', sample: '' };
    }

    // Get appropriate 2D context (either native or via snapshot for WebGL)
    const ctx = this._getReadableContext();
    if (!ctx) {
      log.warn('Canvas sample failed - no readable context available');
      return { canvasHash: '0x', sample: '' };
    }

    const w = this._canvas.width;
    const h = this._canvas.height;

    if (w === 0 || h === 0) {
      log.warn(`Canvas sample failed - invalid dimensions: ${w}x${h}`);
      return { canvasHash: '0x', sample: '' };
    }

    const samples = new Uint8Array(CanvasHandler._SAMPLE_POINTS * 4);
    const samplePoints: string[] = [];

    try {
      for (let i = 0; i < CanvasHandler._SAMPLE_POINTS; i++) {
        const pointSeed = deterministicRandom(seed, i);
        const x = pointSeed % w;
        const y = Math.floor(pointSeed / w) % h;

        // Sample a 2x2 block and average
        const block = ctx.getImageData(x, y, 2, 2).data;
        const avg = this._averageBlock(block);

        // Store 4-bit quantized values
        samples[i * 4 + 0] = avg.r >> 4;
        samples[i * 4 + 1] = avg.g >> 4;
        samples[i * 4 + 2] = avg.b >> 4;
        samples[i * 4 + 3] = avg.a >> 4;
        
        samplePoints.push(`(${x},${y})`);
      }

      const canvasHash = keccak256Bytes(samples);
      const sample = bytesToHex(samples);

      log.info(`Sampled ${CanvasHandler._SAMPLE_POINTS} points${this._isWebGL ? ' (WebGL)' : ''}: ${samplePoints.join(', ')}`);
      return { canvasHash, sample };
    } catch (err) {
      // Canvas might be tainted or have other issues
      log.error('Canvas sample failed - possibly tainted or CORS issue', err);
      return { canvasHash: '0x', sample: '' };
    }
  }

  /**
   * Get a 2D context that can read pixels.
   * For WebGL canvases, creates a snapshot into 2D canvas first.
   */
  private _getReadableContext(): CanvasRenderingContext2D | null {
    if (!this._canvas) return null;

    // 2D canvas - use directly
    if (this._ctx) {
      return this._ctx;
    }

    // WebGL canvas - snapshot to 2D canvas
    if (this._isWebGL && this._samplerCanvas && this._samplerCtx) {
      try {
        // Resize sampler canvas if game canvas changed
        if (this._samplerCanvas.width !== this._canvas.width ||
            this._samplerCanvas.height !== this._canvas.height) {
          this._samplerCanvas.width = this._canvas.width;
          this._samplerCanvas.height = this._canvas.height;
        }

        // Draw WebGL canvas content to 2D canvas
        this._samplerCtx.drawImage(this._canvas, 0, 0);
        return this._samplerCtx;
      } catch (err) {
        log.warn('Failed to snapshot WebGL canvas', err);
        return null;
      }
    }

    return null;
  }

  /**
   * Embed watermark data in canvas using LSB steganography.
   * Note: Only works on 2D canvases. WebGL canvases don't support embedding.
   */
  embed(data: string): CanvasEmbedResult {
    // Ensure we have a canvas
    this._findCanvas();

    // Embedding only works on 2D canvas (not WebGL)
    if (!this._ctx || !this._canvas) {
      log.warn('Canvas embed failed - no 2D context (WebGL canvases not supported for embedding)');
      return { success: false };
    }

    try {
      const region = CanvasHandler._WATERMARK_REGION;
      
      // Get watermark data (16 bytes from hash)
      const watermarkBytes = hexToBytes(data.slice(0, 34)); // 0x + 32 hex chars = 16 bytes
      
      const imageData = this._ctx.getImageData(region.x, region.y, region.w, region.h);
      const pixels = imageData.data;

      // Embed bits into blue channel LSB
      const bitsToEmbed = watermarkBytes.length * 8;
      const maxBits = Math.min(bitsToEmbed, Math.floor(pixels.length / 4));

      for (let i = 0; i < maxBits; i++) {
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8);
        const bit = (watermarkBytes[byteIndex] >> bitIndex) & 1;
        
        // Embed in blue channel LSB
        const pixelIdx = i * 4 + 2;
        pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
      }

      this._ctx.putImageData(imageData, region.x, region.y);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  /**
   * Extract watermark data from canvas.
   */
  extract(): string {
    // Ensure we have a canvas
    this._findCanvas();

    if (!this._ctx || !this._canvas) {
      return '0x';
    }

    try {
      const region = CanvasHandler._WATERMARK_REGION;
      const imageData = this._ctx.getImageData(region.x, region.y, region.w, region.h);
      const pixels = imageData.data;

      // Extract 16 bytes (128 bits) from blue channel LSB
      const extractedBytes = new Uint8Array(16);
      const bitsToExtract = 128;

      for (let i = 0; i < bitsToExtract; i++) {
        const pixelIdx = i * 4 + 2;
        const bit = pixels[pixelIdx] & 1;
        
        const byteIndex = Math.floor(i / 8);
        const bitIndex = 7 - (i % 8);
        extractedBytes[byteIndex] |= (bit << bitIndex);
      }

      return bytesToHex(extractedBytes);
    } catch {
      return '0x';
    }
  }

  /**
   * Average RGBA values of a pixel block.
   */
  private _averageBlock(block: Uint8ClampedArray): { r: number; g: number; b: number; a: number } {
    let r = 0, g = 0, b = 0, a = 0;
    const pixels = block.length / 4;
    
    for (let i = 0; i < block.length; i += 4) {
      r += block[i];
      g += block[i + 1];
      b += block[i + 2];
      a += block[i + 3];
    }
    
    return {
      r: Math.floor(r / pixels),
      g: Math.floor(g / pixels),
      b: Math.floor(b / pixels),
      a: Math.floor(a / pixels)
    };
  }
}
