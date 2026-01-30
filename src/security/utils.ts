/**
 * Security Utilities
 * 
 * Provides cryptographic and encoding utilities for the security modules.
 * Uses keccak256 (Ethereum-compatible) for all hashing operations.
 * 
 * Why keccak256?
 * - Ethereum ecosystem standard (backend uses same algorithm)
 * - Deterministic across platforms
 * - Well-audited implementation via @noble/hashes
 */

import { keccak_256 } from '@noble/hashes/sha3.js';

// ============================================================
// Keccak256 Hashing (Ethereum-compatible)
// ============================================================

/**
 * Compute keccak256 hash of a string and return 0x-prefixed hex.
 * This is the standard Ethereum hashing function.
 */
export function keccak256(message: string): string {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = keccak_256(msgBuffer);
  return bytesToHex(hashBuffer);
}

/**
 * Compute keccak256 hash of a Uint8Array and return 0x-prefixed hex.
 */
export function keccak256Bytes(data: Uint8Array): string {
  const hashBuffer = keccak_256(data);
  return bytesToHex(hashBuffer);
}

/**
 * Compute keccak256 hash and return raw bytes.
 */
export function keccak256Raw(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

// ============================================================
// Rolling Hash (Checkpoint Chain Integrity)
// ============================================================

/**
 * Compute rolling hash for checkpoint chain.
 * 
 * rollingHash = keccak256(prevHash || nonceW || inputDigest || canvasHash || score)
 * 
 * This creates a cryptographic chain where each checkpoint
 * depends on the previous one, preventing:
 * - Window omission (skipping checkpoints)
 * - Replay attacks (reusing old windows)
 * - Score manipulation (changing values mid-chain)
 * 
 * @param prevHash - Previous rolling hash (0x... or empty for first)
 * @param nonceW - Server-provided nonce for this window
 * @param inputDigest - Hash of input events for this window
 * @param canvasHash - Hash of canvas sample for this window
 * @param score - Current score
 */
export function computeRollingHash(
  prevHash: string,
  nonceW: string,
  inputDigest: string,
  canvasHash: string,
  score: number
): string {
  // Concatenate all components with delimiters for unambiguous parsing
  const preimage = [
    prevHash || '0x',
    nonceW,
    inputDigest,
    canvasHash,
    score.toString()
  ].join('|');
  
  return keccak256(preimage);
}

/**
 * Compute initial rolling hash for session start.
 * 
 * initialHash = keccak256(sessionId || meta.screenW || meta.screenH || ts)
 */
export function computeInitialRollingHash(
  sessionId: string,
  screenW: number,
  screenH: number,
  ts: number
): string {
  const preimage = `${sessionId}|${screenW}|${screenH}|${ts}`;
  return keccak256(preimage);
}

// ============================================================
// Encoding Utilities
// ============================================================

/**
 * Convert Uint8Array to hex string (with 0x prefix).
 */
export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string (with or without 0x prefix) to Uint8Array.
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generate a deterministic pseudo-random number from seed and index.
 * Uses keccak256 for reproducible randomness.
 */
export function deterministicRandom(seed: string, index: number): number {
  const hash = keccak256(seed + index.toString());
  // Take first 8 hex chars (4 bytes) and convert to number
  return parseInt(hash.slice(2, 10), 16);
}

/**
 * Encode an object to canonical JSON (deterministic field ordering).
 * Critical for hash consistency across platforms.
 */
export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

/**
 * Concatenate multiple Uint8Arrays into one.
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Convert a number to a Uint8Array (big-endian, 8 bytes).
 */
export function numberToBytes(num: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  // Use BigInt for full 64-bit precision
  view.setBigUint64(0, BigInt(Math.floor(num)), false); // false = big-endian
  return bytes;
}
