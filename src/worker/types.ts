/**
 * Security Worker Message Protocol
 *
 * Defines the contract between GameBox main thread and the Security Worker.
 * GameBox sends commands, Worker returns computed results.
 * All crypto runs inside the Worker (separate thread, untouchable by game iframe).
 */

// ============================================================
// Compact Event Tuple (from SDK shim → GameBox → Worker)
// ============================================================

/**
 * Compact input event: [timestamp, x, y, eventType]
 * - t: performance.now() timestamp (ms)
 * - x: clientX (raw pixels)
 * - y: clientY (raw pixels)
 * - e: 1 = tap/touchstart/mousedown, 0 = release/touchend/mouseup
 */
export interface RawEventTuple {
  t: number;
  x: number;
  y: number;
  e: number;
}

// ============================================================
// Worker Inbound Messages (GameBox → Worker)
// ============================================================

export interface WorkerInitSession {
  type: 'INIT_SESSION';
  sessionId: string;
  screenW: number;
  screenH: number;
  ts: number;
}

export interface WorkerProcessCheckpoint {
  type: 'PROCESS_CHECKPOINT';
  windowIndex: number;
  nonceW: string;
  score: number;
  events: RawEventTuple[];
  pixels: Uint8Array | null;
  screenW: number;
  screenH: number;
}

export interface WorkerComputeFinalHash {
  type: 'COMPUTE_FINAL_HASH';
  sessionId: string;
  finalScore: number;
}

export interface WorkerReset {
  type: 'RESET';
}

export type WorkerInboundMessage =
  | WorkerInitSession
  | WorkerProcessCheckpoint
  | WorkerComputeFinalHash
  | WorkerReset;

// ============================================================
// Worker Outbound Messages (Worker → GameBox)
// ============================================================

export interface WorkerSessionReady {
  type: 'SESSION_READY';
  initialHash: string;
}

export interface WorkerCheckpointResult {
  type: 'CHECKPOINT_RESULT';
  windowIndex: number;
  inputDigest: string;
  canvasHash: string;
  rollingHash: string;
  sketch: string;
  eventCount: number;
}

export interface WorkerFinalHashResult {
  type: 'FINAL_HASH_RESULT';
  finalHash: string;
  rollingHash: string;
  totalWindows: number;
}

export interface WorkerError {
  type: 'ERROR';
  message: string;
  context?: string;
}

export type WorkerOutboundMessage =
  | WorkerSessionReady
  | WorkerCheckpointResult
  | WorkerFinalHashResult
  | WorkerError;
