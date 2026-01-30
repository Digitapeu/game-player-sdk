/**
 * WAM SDK Type Definitions
 * 
 * These types define the security protocol interfaces between
 * the SDK (iframe) and GameBox (parent container).
 * 
 * Cryptography: All hashes use keccak256 (Ethereum-compatible)
 */

// ============================================================
// Input Event Types
// ============================================================

/**
 * Normalized input event in backend format.
 * Coordinates are normalized to 0-1 range.
 */
export interface InputEvent {
  type: 'tap' | 'swipe' | 'hold' | 'release';
  x: number;       // 0-1 normalized (screen width)
  y: number;       // 0-1 normalized (screen height)
  dt: number;      // Delta time from previous input (ms)
  pointerId: number;
}

/**
 * Raw DOM event captured internally.
 */
export interface RawInputEvent {
  type: string;
  x?: number;
  y?: number;
  ts: number;      // Timestamp from performance.now()
  dt: number;      // Delta from previous event
  pointerId: number;
}

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
// Canvas Types
// ============================================================

export interface CanvasSampleResult {
  canvasHash: string;  // keccak256 hash
  sample: string;      // hex-encoded raw samples
}

export interface CanvasEmbedResult {
  success: boolean;
}

// ============================================================
// Input Sketch (64-byte behavioral fingerprint)
// ============================================================

export interface InputSketchResult {
  sketch: string;  // Hex-encoded 64 bytes
}

// ============================================================
// Security Protocol Messages (postMessage)
// ============================================================

export type SecurityMessageType =
  // Basic security data
  | 'SDK_INPUT_EVENTS_REQUEST'
  | 'SDK_INPUT_EVENTS_RESPONSE'
  | 'SDK_INPUT_SKETCH_REQUEST'
  | 'SDK_INPUT_SKETCH_RESPONSE'
  | 'SDK_CANVAS_SAMPLE_REQUEST'
  | 'SDK_CANVAS_SAMPLE_RESPONSE'
  | 'SDK_CANVAS_EMBED_REQUEST'
  | 'SDK_CANVAS_EMBED_RESPONSE'
  | 'SDK_META_REQUEST'
  | 'SDK_META_RESPONSE'
  // Session and checkpoint protocol
  | 'SDK_SECURITY_READY'
  | 'SDK_SESSION_INIT'
  | 'SDK_SESSION_INIT_ACK'
  | 'SDK_CHECKPOINT_REQUEST'
  | 'SDK_CHECKPOINT_RESPONSE'
  | 'SDK_CHECKPOINT_ACK';

export interface SecurityMessageBase {
  controller: '_digitapSecurity';
  type: SecurityMessageType;
}

// ============================================================
// Basic Security Request/Response Messages
// ============================================================

// Request messages (Parent → SDK)
export interface InputEventsRequest extends SecurityMessageBase {
  type: 'SDK_INPUT_EVENTS_REQUEST';
}

export interface InputSketchRequest extends SecurityMessageBase {
  type: 'SDK_INPUT_SKETCH_REQUEST';
}

export interface CanvasSampleRequest extends SecurityMessageBase {
  type: 'SDK_CANVAS_SAMPLE_REQUEST';
  seed: string;
}

export interface CanvasEmbedRequest extends SecurityMessageBase {
  type: 'SDK_CANVAS_EMBED_REQUEST';
  data: string;
}

export interface MetaRequest extends SecurityMessageBase {
  type: 'SDK_META_REQUEST';
}

// Response messages (SDK → Parent)
export interface InputEventsResponse extends SecurityMessageBase {
  type: 'SDK_INPUT_EVENTS_RESPONSE';
  events: InputEvent[];
  digest: string;  // keccak256(canonicalJSON(events))
}

export interface InputSketchResponse extends SecurityMessageBase {
  type: 'SDK_INPUT_SKETCH_RESPONSE';
  sketch: string;
}

export interface CanvasSampleResponse extends SecurityMessageBase {
  type: 'SDK_CANVAS_SAMPLE_RESPONSE';
  canvasHash: string;  // keccak256 of samples
  sample: string;      // raw hex samples
}

export interface CanvasEmbedResponse extends SecurityMessageBase {
  type: 'SDK_CANVAS_EMBED_RESPONSE';
  success: boolean;
}

export interface MetaResponse extends SecurityMessageBase {
  type: 'SDK_META_RESPONSE';
  meta: SessionMeta;
}

// ============================================================
// Session & Checkpoint Protocol Messages
// ============================================================

/**
 * SDK_SECURITY_READY
 * Sent by SDK when SecurityBridge is initialized.
 */
export interface SecurityReadyMessage extends SecurityMessageBase {
  type: 'SDK_SECURITY_READY';
  ts: number;
}

/**
 * SDK_SESSION_INIT (Parent → SDK)
 * Initializes session and rolling hash state.
 */
export interface SessionInitRequest extends SecurityMessageBase {
  type: 'SDK_SESSION_INIT';
  sessionId: string;
}

/**
 * SDK_SESSION_INIT_ACK (SDK → Parent)
 * Confirms session initialization with initial rolling hash.
 */
export interface SessionInitResponse extends SecurityMessageBase {
  type: 'SDK_SESSION_INIT_ACK';
  sessionId: string;
  initialHash: string;  // keccak256(sessionId || screenW || screenH || ts)
  meta: SessionMeta;
}

/**
 * SDK_CHECKPOINT_REQUEST (Parent → SDK)
 * Requests all security data for current window.
 * 
 * Rolling hash chain: H[w] = keccak256(H[w-1] || nonceW || inputDigest || canvasHash || score)
 */
export interface CheckpointRequest extends SecurityMessageBase {
  type: 'SDK_CHECKPOINT_REQUEST';
  seed: string;      // For deterministic canvas sampling
  nonceW: string;    // Server nonce for this window
  score: number;     // Current score to include in hash
}

/**
 * SDK_CHECKPOINT_RESPONSE (SDK → Parent)
 * Returns all security data and rolling hash for the window.
 */
export interface CheckpointResponse extends SecurityMessageBase {
  type: 'SDK_CHECKPOINT_RESPONSE';
  windowIndex: number;
  inputDigest: string;   // keccak256 of input events
  events: InputEvent[];  // Actual input events
  canvasHash: string;    // keccak256 of canvas samples
  sample: string;        // Raw canvas samples
  rollingHash: string;   // Chain hash for integrity
  sketch: string;        // 64-byte behavioral fingerprint
}

/**
 * SDK_CHECKPOINT_ACK (Parent → SDK)
 * Acknowledges checkpoint and provides nonce for next window.
 */
export interface CheckpointAck extends SecurityMessageBase {
  type: 'SDK_CHECKPOINT_ACK';
  windowIndex: number;
  nonceW: string;  // Nonce to use for NEXT rolling hash
}

// ============================================================
// Union Types
// ============================================================

export type SecurityRequest =
  | InputEventsRequest
  | InputSketchRequest
  | CanvasSampleRequest
  | CanvasEmbedRequest
  | MetaRequest
  | SessionInitRequest
  | CheckpointRequest
  | CheckpointAck;

export type SecurityResponse =
  | InputEventsResponse
  | InputSketchResponse
  | CanvasSampleResponse
  | CanvasEmbedResponse
  | MetaResponse
  | SecurityReadyMessage
  | SessionInitResponse
  | CheckpointResponse;

// ============================================================
// Existing SDK Types (for compatibility)
// ============================================================

export interface Progress {
  controller: string;
  type: string;
  score: number;
  level: number;
  state: any;
  continueScore: number;
  stateHash?: string;  // keccak256 hash of input events + canvas state + score
}

export interface CanvasElement extends HTMLCanvasElement {
  captureStream(frameRate?: number): MediaStream;
}
