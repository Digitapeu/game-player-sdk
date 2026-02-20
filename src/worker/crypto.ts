/**
 * Worker Crypto Module
 *
 * All cryptographic operations run here, inside the Web Worker.
 * Zero impact on game rendering. Unreachable from game iframe JS context.
 *
 * Uses keccak256 (Ethereum-compatible) via @noble/hashes.
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import type { RawEventTuple } from './types';

// ============================================================
// Encoding
// ============================================================

export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ============================================================
// Keccak256
// ============================================================

export function keccak256(message: string): string {
  return bytesToHex(keccak_256(new TextEncoder().encode(message)));
}

export function keccak256Bytes(data: Uint8Array): string {
  return bytesToHex(keccak_256(data));
}

export function keccak256Raw(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

// ============================================================
// Deterministic Random (for canvas sampling seed)
// ============================================================

export function deterministicRandom(seed: string, index: number): number {
  const hash = keccak256(seed + index.toString());
  return parseInt(hash.slice(2, 10), 16);
}

// ============================================================
// Rolling Hash Chain
// ============================================================

/**
 * H[0] = keccak256(sessionId | screenW | screenH | ts)
 */
export function computeInitialHash(
  sessionId: string,
  screenW: number,
  screenH: number,
  ts: number
): string {
  return keccak256(`${sessionId}|${screenW}|${screenH}|${ts}`);
}

/**
 * H[w] = keccak256(H[w-1] | nonceW | inputDigest | canvasHash | score)
 */
export function computeRollingHash(
  prevHash: string,
  nonceW: string,
  inputDigest: string,
  canvasHash: string,
  score: number
): string {
  return keccak256(
    [prevHash || '0x', nonceW, inputDigest, canvasHash, score.toString()].join('|')
  );
}

/**
 * finalHash = keccak256(sessionId | rollingHash | finalScore)
 */
export function computeFinalHash(
  sessionId: string,
  rollingHash: string,
  finalScore: number
): string {
  return keccak256(`${sessionId}|${rollingHash}|${finalScore}`);
}

// ============================================================
// Input Digest
// ============================================================

/**
 * Compute keccak256 over compact event tuples.
 * Encodes each event as 20 bytes: float64(t) + float32(x) + float32(y) + uint8(e) + 3 padding.
 * Float64 for timestamp preserves precision for sessions up to weeks.
 */
export function computeInputDigest(events: RawEventTuple[]): string {
  if (events.length === 0) return '0x0';

  const STRIDE = 20;
  const buffer = new ArrayBuffer(events.length * STRIDE);
  const view = new DataView(buffer);

  for (let i = 0; i < events.length; i++) {
    const offset = i * STRIDE;
    view.setFloat64(offset, events[i].t, false);
    view.setFloat32(offset + 8, events[i].x, false);
    view.setFloat32(offset + 12, events[i].y, false);
    view.setUint8(offset + 16, events[i].e);
  }

  return keccak256Bytes(new Uint8Array(buffer));
}

// ============================================================
// Canvas Hash
// ============================================================

/**
 * Compute keccak256 over raw pixel bytes from canvas sampling.
 */
export function computeCanvasHash(pixels: Uint8Array | null): string {
  if (!pixels || pixels.length === 0) return '0x0';
  return keccak256Bytes(pixels);
}
