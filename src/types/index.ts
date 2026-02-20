/**
 * WAM SDK Type Definitions
 *
 * Types for the SDK shim (game iframe) ↔ GameBox (parent) protocol.
 * Worker types are in src/worker/types.ts (separate concern).
 */

// ============================================================
// SDK ↔ GameBox Security Protocol (postMessage)
// ============================================================

export type SecurityMessageType =
  | 'SDK_SECURITY_READY'
  | 'SDK_SESSION_INIT'
  | 'SDK_SESSION_INIT_ACK'
  | 'SDK_CHECKPOINT_REQUEST'
  | 'SDK_CHECKPOINT_RESPONSE'
  | 'SDK_CHECKPOINT_ACK'
  | 'SDK_CANVAS_EMBED_REQUEST'
  | 'SDK_CANVAS_EMBED_RESPONSE'
  | 'SDK_META_REQUEST'
  | 'SDK_META_RESPONSE'
  | 'SDK_LOADED';

// ============================================================
// Session Metadata
// ============================================================

export interface SessionMeta {
  screenW: number;
  screenH: number;
  dpr: number;
  orientation: 'portrait' | 'landscape';
  platform: 'ios' | 'android' | 'web' | 'desktop';
  touchCapable: boolean;
}

// ============================================================
// Existing SDK Types (public API)
// ============================================================

export interface Progress {
  controller: string;
  type: string;
  score: number;
  level: number;
  state: any;
  continueScore: number;
}

export interface CanvasElement extends HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream;
}
