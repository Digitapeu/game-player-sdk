# GameBox Integration Guide: Checkpoint Scheduler & SDK Communication

**Version:** 1.0  
**Date:** January 14, 2026  
**Audience:** GameBox / Platform Team

---

## Overview

This document provides exact instructions for implementing the **checkpoint scheduler** and **SDK communication** in GameBox (the parent container on `win.wam.app`).

### Architecture Reminder

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GAME IFRAME (SDK - UNTRUSTED)                    │
│    - Captures input events, canvas samples, behavioral sketch       │
│    - Responds to _digitapSecurity postMessage requests              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ postMessage
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│              GAMEBOX (PARENT - win.wam.app) - TRUSTED               │
│    - Owns DPoP key (non-extractable CryptoKey in IndexedDB)         │
│    - Computes rolling hash from SDK events                          │
│    - Schedules checkpoints (DPoP every 5s, Passkey every 30s)       │
│    - Signs checkpoint digests with DPoP key                         │
│    - Communicates with backend                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (api.wam.app)                           │
│    POST /score/session/start      - Initialize session              │
│    POST /score/session/checkpoint - Submit window checkpoint        │
│    POST /score/submit             - Final score submission          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 1. SDK Communication Protocol

### 1.1 Security Channel Controller

All security-related communication uses `controller: '_digitapSecurity'` to separate it from the existing game protocol (`_digitapGame` / `_digitapApp`).

### 1.2 Request/Response Message Types

| You Send (Request) | SDK Responds With | Purpose |
|--------------------|-------------------|---------|
| `SDK_INPUT_EVENTS_REQUEST` | `SDK_INPUT_EVENTS_RESPONSE` | Get input events + SHA-256 digest |
| `SDK_INPUT_SKETCH_REQUEST` | `SDK_INPUT_SKETCH_RESPONSE` | Get 64-byte behavioral fingerprint |
| `SDK_CANVAS_SAMPLE_REQUEST` | `SDK_CANVAS_SAMPLE_RESPONSE` | Sample canvas at deterministic points |
| `SDK_CANVAS_EMBED_REQUEST` | `SDK_CANVAS_EMBED_RESPONSE` | Embed watermark in canvas |
| `SDK_META_REQUEST` | `SDK_META_RESPONSE` | Get session metadata |

### 1.3 How to Send Requests to SDK

```typescript
// Reference to the game iframe
const gameIframe: HTMLIFrameElement = document.getElementById('game-iframe');

// Send a request to SDK
function sendSecurityRequest(type: string, data: object = {}): void {
  gameIframe.contentWindow?.postMessage(
    {
      controller: '_digitapSecurity',
      type,
      ...data
    },
    '*' // Or specific origin for security
  );
}

// Example: Request input events
sendSecurityRequest('SDK_INPUT_EVENTS_REQUEST');

// Example: Request canvas sample with seed
sendSecurityRequest('SDK_CANVAS_SAMPLE_REQUEST', { 
  seed: '0x' + sessionId + wIndex 
});

// Example: Embed watermark
sendSecurityRequest('SDK_CANVAS_EMBED_REQUEST', { 
  data: rollingHash 
});
```

### 1.4 How to Receive Responses from SDK

```typescript
// Set up listener for SDK responses
window.addEventListener('message', (event) => {
  // Ignore non-security messages
  if (event.data?.controller !== '_digitapSecurity') return;
  
  switch (event.data.type) {
    case 'SDK_INPUT_EVENTS_RESPONSE':
      handleInputEventsResponse(event.data);
      break;
      
    case 'SDK_INPUT_SKETCH_RESPONSE':
      handleInputSketchResponse(event.data);
      break;
      
    case 'SDK_CANVAS_SAMPLE_RESPONSE':
      handleCanvasSampleResponse(event.data);
      break;
      
    case 'SDK_CANVAS_EMBED_RESPONSE':
      handleCanvasEmbedResponse(event.data);
      break;
      
    case 'SDK_META_RESPONSE':
      handleMetaResponse(event.data);
      break;
  }
});
```

### 1.5 Response Payload Formats

```typescript
// SDK_INPUT_EVENTS_RESPONSE
interface InputEventsResponse {
  controller: '_digitapSecurity';
  type: 'SDK_INPUT_EVENTS_RESPONSE';
  events: Array<{
    type: 'tap' | 'swipe' | 'hold' | 'release';
    x: number;       // 0-1 normalized
    y: number;       // 0-1 normalized
    dt: number;      // Delta time (ms)
    pointerId: number;
  }>;
  digest: string;    // SHA-256 of events (0x prefixed)
}

// SDK_INPUT_SKETCH_RESPONSE
interface InputSketchResponse {
  controller: '_digitapSecurity';
  type: 'SDK_INPUT_SKETCH_RESPONSE';
  sketch: string;    // 64 bytes hex (0x + 128 chars)
}

// SDK_CANVAS_SAMPLE_RESPONSE
interface CanvasSampleResponse {
  controller: '_digitapSecurity';
  type: 'SDK_CANVAS_SAMPLE_RESPONSE';
  canvasHash: string;  // SHA-256 of samples
  sample: string;      // Raw sample bytes hex
}

// SDK_CANVAS_EMBED_RESPONSE
interface CanvasEmbedResponse {
  controller: '_digitapSecurity';
  type: 'SDK_CANVAS_EMBED_RESPONSE';
  success: boolean;
}

// SDK_META_RESPONSE
interface MetaResponse {
  controller: '_digitapSecurity';
  type: 'SDK_META_RESPONSE';
  meta: {
    screenW: number;
    screenH: number;
    dpr: number;
    orientation: 'portrait' | 'landscape';
    platform: 'ios' | 'android' | 'web' | 'desktop';
    touchCapable: boolean;
  };
}
```

---

## 2. Rolling Hash Computation

### 2.1 Algorithm

GameBox computes the rolling hash from events received via the existing `_digitapGame` channel.

```typescript
import { sha256 } from 'some-crypto-lib'; // Or Web Crypto API

class TranscriptRecorder {
  private rollingHash: string = '';
  private eventCount: number = 0;

  /**
   * Initialize transcript with session data.
   */
  async init(sessionId: string, gameId: number, startAtServerMs: number): Promise<void> {
    const initEvent = {
      v: 1,
      type: 'init',
      sessionId,
      gameId,
      startAtServerMs,
      sdkSecurityVersion: 2
    };
    
    // R0 = SHA256(encode(initEvent))
    this.rollingHash = await sha256(this.canonicalJSON(initEvent));
    this.eventCount = 1;
  }

  /**
   * Append an event to the transcript.
   * Call this for every SDK_PLAYER_SCORE_UPDATE, SDK_PLAYER_LEVEL_UP, etc.
   */
  async appendEvent(event: TranscriptEvent): Promise<void> {
    // Ri = SHA256(Ri-1 || SHA256(encode(Ei)))
    const eventHash = await sha256(this.canonicalJSON(event));
    this.rollingHash = await sha256(this.rollingHash + eventHash);
    this.eventCount++;
  }

  /**
   * Append a checkpoint event (internal).
   */
  async appendCheckpoint(wIndex: number, score: number, state: string): Promise<void> {
    const checkpointEvent = {
      v: 1,
      type: 'checkpoint',
      wIndex,
      score,
      state,
      ts: Date.now()
    };
    await this.appendEvent(checkpointEvent);
  }

  /**
   * Get current rolling hash.
   */
  getHash(): string {
    return this.rollingHash;
  }

  /**
   * Canonical JSON encoding (deterministic field ordering).
   */
  private canonicalJSON(obj: any): string {
    return JSON.stringify(obj, Object.keys(obj).sort());
  }
}
```

### 2.2 Event Types to Record

Record these events from the existing `_digitapGame` channel:

```typescript
// When you receive SDK events via postMessage:
window.addEventListener('message', (event) => {
  if (event.data?.controller !== '_digitapGame') return;
  
  switch (event.data.type) {
    case 'SDK_PLAYER_SCORE_UPDATE':
      transcript.appendEvent({
        v: 1,
        type: 'score_update',
        score: event.data.score,
        level: event.data.level,
        state: event.data.state,
        ts: Date.now()
      });
      break;
      
    case 'SDK_PLAYER_LEVEL_UP':
      transcript.appendEvent({
        v: 1,
        type: 'level_up',
        level: event.data.level,
        ts: Date.now()
      });
      break;
      
    case 'SDK_PLAYER_FAILED':
      transcript.appendEvent({
        v: 1,
        type: 'failed',
        state: event.data.state,
        score: currentScore,
        ts: Date.now()
      });
      break;
  }
});
```

---

## 3. Checkpoint Scheduler

### 3.1 Configuration

```typescript
interface CheckpointConfig {
  windowDurationMs: number;     // W = 5000ms (5 seconds)
  dpopEveryWindow: boolean;     // true - DPoP checkpoint every window
  passkeyIntervalWindows: number; // 6 - Passkey every 6 windows (30s)
  minValidatedWindows: number;  // Minimum windows required for payout
  maxScoreDeltaPerWindow: number | null; // Max score increase per window
}

const DEFAULT_CONFIG: CheckpointConfig = {
  windowDurationMs: 5000,
  dpopEveryWindow: true,
  passkeyIntervalWindows: 6,
  minValidatedWindows: 6,
  maxScoreDeltaPerWindow: null // Set per-game
};
```

### 3.2 Checkpoint Engine Implementation

```typescript
class CheckpointEngine {
  private config: CheckpointConfig;
  private sessionId: string = '';
  private wIndex: number = 0;
  private validatedWindows: number = 0;
  private nextWindowAtMs: number = 0;
  private checkpointTimer: number | null = null;
  private isRunning: boolean = false;
  
  // Dependencies
  private transcript: TranscriptRecorder;
  private dpopSigner: DPoPSigner;
  private passkeySigner: PasskeySigner;
  private sdkBridge: SDKSecurityBridge;
  private backend: BackendClient;
  
  // Current state
  private currentScore: number = 0;
  private currentState: string = 'init';

  constructor(deps: Dependencies) {
    this.config = DEFAULT_CONFIG;
    this.transcript = deps.transcript;
    this.dpopSigner = deps.dpopSigner;
    this.passkeySigner = deps.passkeySigner;
    this.sdkBridge = deps.sdkBridge;
    this.backend = deps.backend;
  }

  /**
   * Start a new session.
   */
  async startSession(gameId: number, mode: 'CASUAL' | 'TOURNAMENT' | 'DEGEN'): Promise<void> {
    // 1. Get session metadata from SDK
    const meta = await this.sdkBridge.getMeta();
    
    // 2. Call backend to start session
    const response = await this.backend.startSession({
      gameId,
      mode,
      sdkSecurityVersion: 2,
      dpopJkt: this.dpopSigner.getThumbprint(),
      meta
    });
    
    // 3. Store session info
    this.sessionId = response.sessionId;
    this.config = { ...this.config, ...response.config };
    this.nextWindowAtMs = response.startAtServerMs + this.config.windowDurationMs;
    this.wIndex = 0;
    this.validatedWindows = 0;
    
    // 4. Initialize transcript
    await this.transcript.init(this.sessionId, gameId, response.startAtServerMs);
    
    // 5. Start checkpoint scheduler
    this.startScheduler();
  }

  /**
   * Start the checkpoint scheduler.
   */
  private startScheduler(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    this.scheduleNextCheckpoint();
  }

  /**
   * Schedule the next checkpoint attempt.
   */
  private scheduleNextCheckpoint(): void {
    if (!this.isRunning) return;
    
    const now = Date.now();
    const delay = Math.max(0, this.nextWindowAtMs - now);
    
    this.checkpointTimer = window.setTimeout(() => {
      this.attemptCheckpoint();
    }, delay);
  }

  /**
   * Attempt a checkpoint submission.
   */
  private async attemptCheckpoint(): Promise<void> {
    if (!this.isRunning) return;
    
    try {
      const nextWIndex = this.wIndex + 1;
      
      // 1. Append checkpoint event to transcript
      await this.transcript.appendCheckpoint(nextWIndex, this.currentScore, this.currentState);
      
      // 2. Get input events and digest from SDK
      const inputData = await this.sdkBridge.getInputEvents();
      
      // 3. Get canvas sample from SDK
      const seed = '0x' + this.sessionId.slice(2, 18) + nextWIndex.toString(16).padStart(8, '0');
      const canvasData = await this.sdkBridge.getCanvasSample(seed);
      
      // 4. Build checkpoint digest
      const checkpointDigest = await this.buildCheckpointDigest(nextWIndex, inputData.digest, canvasData.canvasHash);
      
      // 5. Sign with DPoP key
      const dpopSig = await this.dpopSigner.sign(checkpointDigest);
      
      // 6. Submit checkpoint to backend
      const response = await this.backend.submitCheckpoint({
        sessionId: this.sessionId,
        wIndex: nextWIndex,
        rollingHash: this.transcript.getHash(),
        score: this.currentScore,
        state: this.currentState,
        inputDigest: inputData.digest,
        canvasHash: canvasData.canvasHash,
        dpopSig
      });
      
      if (response.accepted) {
        // 7. Update local state
        this.wIndex = response.wIndex;
        this.validatedWindows = response.validatedWindows;
        this.nextWindowAtMs = response.nextWindowAtMs;
        
        // 8. Check if Passkey checkpoint needed
        if (this.wIndex % this.config.passkeyIntervalWindows === 0) {
          await this.attemptPasskeyCheckpoint();
        }
      } else if (response.retryAfterMs) {
        // Too early - wait and retry
        this.nextWindowAtMs = Date.now() + response.retryAfterMs;
      }
      
    } catch (error) {
      // Log error but don't crash - checkpoint failure is non-fatal
      console.error('Checkpoint failed:', error);
    }
    
    // Schedule next checkpoint
    this.scheduleNextCheckpoint();
  }

  /**
   * Attempt a Passkey checkpoint (every 30s for payout modes).
   */
  private async attemptPasskeyCheckpoint(): Promise<void> {
    try {
      // Build passkey digest
      const passkeyDigest = await this.buildPasskeyDigest();
      
      // Request Passkey assertion (will prompt user)
      const assertion = await this.passkeySigner.sign(passkeyDigest);
      
      // Submit to backend
      await this.backend.submitPasskeyCheckpoint({
        sessionId: this.sessionId,
        wIndex: this.wIndex,
        passkeyDigest,
        assertion
      });
      
    } catch (error) {
      // Passkey failure - log but continue
      // Backend will mark this window range as not passkey-verified
      console.warn('Passkey checkpoint failed:', error);
    }
  }

  /**
   * Build the checkpoint digest for DPoP signing.
   */
  private async buildCheckpointDigest(
    wIndex: number,
    inputDigest: string,
    canvasHash: string
  ): Promise<string> {
    const payload = {
      v: 1,
      sessionId: this.sessionId,
      wIndex,
      rollingHash: this.transcript.getHash(),
      score: this.currentScore,
      state: this.currentState,
      inputDigest,
      canvasHash
    };
    
    return sha256(JSON.stringify(payload, Object.keys(payload).sort()));
  }

  /**
   * Build the Passkey digest.
   */
  private async buildPasskeyDigest(): Promise<string> {
    const payload = {
      v: 1,
      sessionId: this.sessionId,
      wIndexRange: [this.wIndex - this.config.passkeyIntervalWindows + 1, this.wIndex],
      rollingHash: this.transcript.getHash(),
      score: this.currentScore
    };
    
    return sha256(JSON.stringify(payload, Object.keys(payload).sort()));
  }

  /**
   * Update current game state (call from SDK event handler).
   */
  updateState(score: number, state: string): void {
    this.currentScore = score;
    this.currentState = state;
  }

  /**
   * End the session and return final claim.
   */
  async endSession(): Promise<FinalClaim> {
    // 1. Stop scheduler
    this.isRunning = false;
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
    }
    
    // 2. Get final input sketch from SDK
    const sketchData = await this.sdkBridge.getInputSketch();
    
    // 3. Build final claim
    const claim: FinalClaim = {
      sessionId: this.sessionId,
      finalScore: this.currentScore,
      rollingHash: this.transcript.getHash(),
      validatedWindows: this.validatedWindows,
      claimedTimeMs: this.validatedWindows * this.config.windowDurationMs,
      inputSketch: sketchData.sketch
    };
    
    // 4. Optionally sign with worker wallet
    // claim.workerSig = await this.workerWallet.sign(claim);
    
    return claim;
  }
}
```

### 3.3 SDK Security Bridge Helper

```typescript
class SDKSecurityBridge {
  private gameIframe: HTMLIFrameElement;
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();

  constructor(gameIframe: HTMLIFrameElement) {
    this.gameIframe = gameIframe;
    this.setupListener();
  }

  private setupListener(): void {
    window.addEventListener('message', (event) => {
      if (event.data?.controller !== '_digitapSecurity') return;
      
      const requestId = event.data.type.replace('_RESPONSE', '_REQUEST');
      const pending = this.pendingRequests.get(requestId);
      
      if (pending) {
        this.pendingRequests.delete(requestId);
        pending.resolve(event.data);
      }
    });
  }

  private sendRequest(type: string, data: object = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      // Timeout after 5 seconds
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(type);
        reject(new Error(`SDK request ${type} timed out`));
      }, 5000);
      
      this.pendingRequests.set(type, {
        resolve: (data: any) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject
      });
      
      this.gameIframe.contentWindow?.postMessage(
        { controller: '_digitapSecurity', type, ...data },
        '*'
      );
    });
  }

  /**
   * Get input events and digest.
   */
  async getInputEvents(): Promise<InputEventsResponse> {
    return this.sendRequest('SDK_INPUT_EVENTS_REQUEST');
  }

  /**
   * Get 64-byte behavioral sketch.
   */
  async getInputSketch(): Promise<InputSketchResponse> {
    return this.sendRequest('SDK_INPUT_SKETCH_REQUEST');
  }

  /**
   * Get canvas sample at seed-derived points.
   */
  async getCanvasSample(seed: string): Promise<CanvasSampleResponse> {
    return this.sendRequest('SDK_CANVAS_SAMPLE_REQUEST', { seed });
  }

  /**
   * Embed watermark in canvas.
   */
  async embedWatermark(data: string): Promise<CanvasEmbedResponse> {
    return this.sendRequest('SDK_CANVAS_EMBED_REQUEST', { data });
  }

  /**
   * Get session metadata.
   */
  async getMeta(): Promise<MetaResponse> {
    return this.sendRequest('SDK_META_REQUEST');
  }
}
```

---

## 4. Backend API Integration

### 4.1 Start Session

```typescript
// Request
POST /score/session/start
Content-Type: application/json

{
  "gameId": 101,
  "mode": "TOURNAMENT",
  "sdkSecurityVersion": 2,
  "dpopJkt": "abc123...",  // DPoP key thumbprint
  "meta": {
    "screenW": 1080,
    "screenH": 1920,
    "dpr": 2.0,
    "orientation": "portrait",
    "platform": "ios",
    "touchCapable": true
  }
}

// Response
{
  "sessionId": "0xabc123...",
  "policyId": "tournament_standard",
  "windowMs": 5000,
  "startAtServerMs": 1705248000000,
  "minValidatedWindows": 6,
  "config": {
    "maxScoreDeltaPerWindow": 500
  }
}
```

### 4.2 Submit Checkpoint

```typescript
// Request
POST /score/session/checkpoint
Content-Type: application/json

{
  "sessionId": "0xabc123...",
  "wIndex": 5,
  "rollingHash": "0xdef456...",
  "score": 2500,
  "state": "playing",
  "inputDigest": "0x789...",
  "canvasHash": "0xabc...",
  "dpopSig": "base64url..."
}

// Success Response
{
  "accepted": true,
  "wIndex": 5,
  "validatedWindows": 5,
  "nextWindowAtMs": 1705248030000
}

// Too Early Response (HTTP 425)
{
  "accepted": false,
  "retryAfterMs": 1500
}
```

### 4.3 Final Submission (Augmented Existing Endpoint)

```typescript
// Request - Augment your existing score submission
POST /score/submit
Content-Type: application/json

{
  // Existing fields
  "gameId": 101,
  "score": 4200,
  "userId": "user123",
  
  // New security fields
  "sessionId": "0xabc123...",
  "rollingHash": "0xdef456...",
  "validatedWindows": 12,
  "claimedTimeMs": 60000,
  "inputSketch": "0x...",  // 64 bytes hex
  "workerSig": "0x..."     // Optional
}

// Response
{
  "verified": true,
  "finalScore": 4200,
  "verifiedTimeMs": 60000,
  "validatedWindows": 12,
  "botScore": 0.15,
  "warnings": []
}
```

---

## 5. Complete Integration Example

```typescript
// Main GameBox integration
class SecureGameSession {
  private checkpointEngine: CheckpointEngine;
  private sdkBridge: SDKSecurityBridge;
  private transcript: TranscriptRecorder;

  constructor(gameIframe: HTMLIFrameElement) {
    this.sdkBridge = new SDKSecurityBridge(gameIframe);
    this.transcript = new TranscriptRecorder();
    this.checkpointEngine = new CheckpointEngine({
      transcript: this.transcript,
      dpopSigner: new DPoPSigner(),
      passkeySigner: new PasskeySigner(),
      sdkBridge: this.sdkBridge,
      backend: new BackendClient()
    });
    
    // Listen for SDK game events
    this.setupGameEventListener();
  }

  private setupGameEventListener(): void {
    window.addEventListener('message', async (event) => {
      // Handle existing game protocol
      if (event.data?.controller !== '_digitapGame') return;
      
      switch (event.data.type) {
        case 'SDK_PLAYER_SCORE_UPDATE':
          // 1. Update checkpoint engine state
          this.checkpointEngine.updateState(
            event.data.score,
            event.data.state
          );
          
          // 2. Record in transcript
          await this.transcript.appendEvent({
            v: 1,
            type: 'score_update',
            score: event.data.score,
            level: event.data.level,
            state: event.data.state,
            ts: Date.now()
          });
          break;
          
        case 'SDK_PLAYER_FAILED':
          // End session and submit final score
          const claim = await this.checkpointEngine.endSession();
          await this.submitFinalScore(claim);
          break;
      }
    });
  }

  async startGame(gameId: number, mode: 'CASUAL' | 'TOURNAMENT' | 'DEGEN'): Promise<void> {
    // Start the secure session
    await this.checkpointEngine.startSession(gameId, mode);
    
    // Then trigger game start via existing protocol
    // gameIframe.contentWindow.postMessage({ controller: '_digitapApp', type: 'SDK_START_GAME' }, '*');
  }

  private async submitFinalScore(claim: FinalClaim): Promise<void> {
    // Submit to backend with security fields
    const response = await fetch('/score/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: this.gameId,
        score: claim.finalScore,
        sessionId: claim.sessionId,
        rollingHash: claim.rollingHash,
        validatedWindows: claim.validatedWindows,
        claimedTimeMs: claim.claimedTimeMs,
        inputSketch: claim.inputSketch
      })
    });
    
    const result = await response.json();
    // Handle result (show to user, etc.)
  }
}

// Usage
const gameIframe = document.getElementById('game-iframe') as HTMLIFrameElement;
const session = new SecureGameSession(gameIframe);

// When user clicks "Play Tournament"
session.startGame(101, 'TOURNAMENT');
```

---

## 6. Timeline & Checkpoints Visual

```
Time:     0s     5s     10s    15s    20s    25s    30s    35s    40s
          │      │      │      │      │      │      │      │      │
Windows:  │  W1  │  W2  │  W3  │  W4  │  W5  │  W6  │  W7  │  W8  │
          │      │      │      │      │      │      │      │      │
DPoP:     ├──✓───├──✓───├──✓───├──✓───├──✓───├──✓───├──✓───├──✓───┤
          │      │      │      │      │      │      │      │      │
Passkey:  │      │      │      │      │      ├──✓───│      │      │
          │      │      │      │      │      │      │      │      │
Backend:  ├─────────────────────────────────────────────────────────┤
          │  Each checkpoint call validates one window              │
          │  Backend enforces: now >= nextWindowAtMs (time gate)    │
```

---

## 7. Error Handling & Edge Cases

### 7.1 SDK Not Responding

```typescript
// SDK bridge with timeout
async getInputEvents(): Promise<InputEventsResponse> {
  try {
    return await this.sendRequest('SDK_INPUT_EVENTS_REQUEST');
  } catch (error) {
    // Return empty data on timeout
    return {
      controller: '_digitapSecurity',
      type: 'SDK_INPUT_EVENTS_RESPONSE',
      events: [],
      digest: '0x0'
    };
  }
}
```

### 7.2 Backend Checkpoint Fails

```typescript
// In attemptCheckpoint():
try {
  const response = await this.backend.submitCheckpoint(checkpointData);
  // ...
} catch (error) {
  // Log but don't crash - window won't be validated
  console.error('Checkpoint submission failed:', error);
  // Continue to next window
  this.scheduleNextCheckpoint();
}
```

### 7.3 Network Offline

```typescript
// Queue checkpoints for later submission
class OfflineQueue {
  private queue: Checkpoint[] = [];
  
  add(checkpoint: Checkpoint): void {
    this.queue.push(checkpoint);
  }
  
  async flush(): Promise<void> {
    while (this.queue.length > 0 && navigator.onLine) {
      const checkpoint = this.queue.shift()!;
      await this.backend.submitCheckpoint(checkpoint);
    }
  }
}

// Listen for reconnection
window.addEventListener('online', () => offlineQueue.flush());
```

---

## 8. Mode-Specific Configuration

| Mode | Window (W) | Min Windows | Passkey Required | Time Gate |
|------|------------|-------------|------------------|-----------|
| **CASUAL** | 5s | 0-2 | No | Client-paced |
| **TOURNAMENT** | 5s | 6+ (30s) | Recommended | Client-paced + validation |
| **DEGEN** | 5s | 12+ (60s) | Yes | Server-paced (strict) |

---

## 9. Checklist Before Go-Live

- [ ] DPoP key properly stored in IndexedDB under `win.wam.app`
- [ ] TranscriptRecorder computes rolling hash from SDK events
- [ ] CheckpointEngine schedules DPoP checkpoints every 5s
- [ ] Passkey checkpoints requested every 30s for payout modes
- [ ] SDK security bridge handles all request/response types
- [ ] Backend endpoints implemented and tested
- [ ] Error handling for SDK timeouts
- [ ] Error handling for network failures
- [ ] Offline queue for checkpoint buffering
- [ ] Logging/monitoring for checkpoint success/failure rates

---

**End of Guide**
