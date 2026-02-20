# GameBox Integration Guide

## Overview

The Security Worker (`security-worker.min.js`) runs in a dedicated Web Worker thread inside your GameBox application. It receives raw data from the SDK shim (game iframe) via the GameBox orchestrator, computes all cryptographic hashes off the main thread, and returns results for your backend API calls.

```
Backend                  GameBox                    SDK Shim          Worker
  │                        │                          │                 │
  │◄─ POST /session/start ─│                          │                 │
  │── { sessionId } ──────►│                          │                 │
  │                        │── SDK_SESSION_INIT ─────►│                 │
  │                        │◄── SDK_SESSION_INIT_ACK ─│                 │
  │                        │── INIT_SESSION ───────────────────────────►│
  │                        │◄── SESSION_READY ──────────────────────────│
  │                        │                          │                 │
  │                        │  ┌── every 5s ─────────────────────┐       │
  │                        │  │                       │         │       │
  │                        │──│─ CHECKPOINT_REQUEST ─►│         │       │
  │                        │◄─│─ CHECKPOINT_RESPONSE ─│         │       │
  │                        │──│─ PROCESS_CHECKPOINT ───────────►│       │
  │                        │◄─│─ CHECKPOINT_RESULT ─────────────│       │
  │◄─ POST /checkpoint ────│  │                       │         │       │
  │── { nonceW } ─────────►│  └─────────────────────────────────┘       │
  │                        │                          │                 │
  │                        │── COMPUTE_FINAL_HASH ─────────────────────►│
  │                        │◄── FINAL_HASH_RESULT ──────────────────────│
  │◄─ POST /session/end ───│                          │                 │
```

---

## Step 1: Load the Worker

```typescript
const worker = new Worker('https://files.digitap.eu/sdk/security-worker.min.js');
```

The Worker has no domain lock (unlike the SDK shim), so it runs on your GameBox origin. It can also be self-hosted or bundled as a Blob URL.

---

## Step 2: Session Lifecycle

### Session Start

```
┌──────────┐          ┌──────────┐         ┌──────────┐          ┌──────────┐
│ Backend  │          │ GameBox  │         │ SDK Shim │          │  Worker  │
└────┬─────┘          └────┬─────┘         └────┬─────┘          └────┬─────┘
     │                     │                    │                     │
     │  POST /session/start│                    │                     │
     │◄────────────────────│                    │                     │
     │                     │                    │                     │
     │  { sessionId,       │                    │                     │
     │    checkpointMs,    │                    │                     │
     │    nonceW₀ }        │                    │                     │
     │────────────────────►│                    │                     │
     │                     │                    │                     │
     │                     │  SDK_SESSION_INIT  │                     │
     │                     │  { sessionId }     │                     │
     │                     │───────────────────►│                     │
     │                     │                    │                     │
     │                     │  SDK_SESSION_INIT_ACK                    │
     │                     │  { meta, ts }      │                     │
     │                     │◄───────────────────│                     │
     │                     │                    │                     │
     │                     │  INIT_SESSION                            │
     │                     │  { sessionId, screenW, screenH, ts }     │
     │                     │─────────────────────────────────────────►│
     │                     │                    │                     │
     │                     │  SESSION_READY                           │
     │                     │  { initialHash }   │                     │
     │                     │◄─────────────────────────────────────────│
     │                     │                    │                     │
     │                     │  Start checkpoint  │                     │
     │                     │  interval (5s)     │                     │
```

**GameBox code:**

```typescript
// 1. Start session with backend
const { sessionId, nonceW } = await api.post('/score/session/start', { gameId, userId });

// 2. Store the first server nonce
let currentNonce = nonceW;

// 3. Tell SDK shim to initialize
gameIframe.contentWindow.postMessage({
  controller: '_digitapSecurity',
  type: 'SDK_SESSION_INIT',
  sessionId,
}, '*');

// 4. When SDK responds with ACK, init the Worker
// (handled in message listener - see Step 3)
```

### Session End

```
┌──────────┐         ┌──────────┐           ┌──────────┐
│ Backend  │         │ GameBox  │           │  Worker  │
└────┬─────┘         └────┬─────┘           └─────┬────┘
     │                     │                      │
     │                     │  Stop checkpoint     │
     │                     │  interval            │
     │                     │                      │
     │                     │  COMPUTE_FINAL_HASH  │
     │                     │  { sessionId,        │
     │                     │    finalScore }      │
     │                     │─────────────────────►│
     │                     │                      │
     │                     │  FINAL_HASH_RESULT   │
     │                     │  { finalHash,        │
     │                     │    rollingHash,      │
     │                     │    totalWindows }    │
     │                     │◄─────────────────────│
     │                     │                      │
     │  POST /session/end  │                      │
     │  { finalHash,       │                      │
     │    rollingHash,     │                      │
     │    totalWindows,    │                      │
     │    finalScore,      │                      │
     │    workerWalletSig }│                      │
     │◄────────────────────│                      │
```

**GameBox code:**

```typescript
// 1. Stop checkpoint loop
clearInterval(checkpointTimer);

// 2. Request final hash from Worker
worker.postMessage({
  type: 'COMPUTE_FINAL_HASH',
  sessionId,
  finalScore: currentScore,
});

// 3. Worker responds with FINAL_HASH_RESULT (handled in worker.onmessage)
// 4. Sign with worker wallet and submit to backend
```

---

## Step 3: Message Listeners

### Listen to SDK Shim (iframe → GameBox)

```typescript
window.addEventListener('message', (event) => {
  // Only accept from our game iframe
  if (event.source !== gameIframe.contentWindow) return;

  const data = event.data;
  if (!data || data.controller !== '_digitapSecurity') return;

  switch (data.type) {
    case 'SDK_SECURITY_READY':
      // SDK shim loaded - safe to send SDK_SESSION_INIT
      break;

    case 'SDK_SESSION_INIT_ACK': {
      // SDK confirmed session, meta available. Init the Worker.
      worker.postMessage({
        type: 'INIT_SESSION',
        sessionId,
        screenW: data.meta.screenW,
        screenH: data.meta.screenH,
        ts: data.ts,
      });
      break;
    }

    case 'SDK_CHECKPOINT_RESPONSE': {
      // Raw events + pixels from SDK. Forward to Worker for hashing.
      worker.postMessage({
        type: 'PROCESS_CHECKPOINT',
        windowIndex: currentWindowIndex,
        nonceW: currentNonce,
        score: currentScore,
        events: data.events,
        pixels: data.pixels,
        screenW: data.screenW,
        screenH: data.screenH,
      });
      currentWindowIndex++;
      break;
    }
  }
});
```

### Listen to Worker (Worker → GameBox)

```typescript
worker.onmessage = (e) => {
  const msg = e.data;

  switch (msg.type) {
    case 'SESSION_READY':
      // Hash chain started, begin checkpoint loop
      startCheckpointLoop();
      break;

    case 'CHECKPOINT_RESULT':
      // Computed hashes ready - sign and send to backend
      submitCheckpoint(msg);
      break;

    case 'FINAL_HASH_RESULT':
      // Session complete - sign with worker wallet and submit
      submitFinalScore(msg);
      break;

    case 'ERROR':
      console.error(`[SecurityWorker] ${msg.context}: ${msg.message}`);
      break;
  }
};
```

---

## Step 4: Checkpoint Loop

```
┌──────────┐          ┌──────────┐         ┌──────────┐           ┌──────────┐
│ Backend  │          │ GameBox  │         │ SDK Shim │           │  Worker  │
└────┬─────┘          └────┬─────┘         └────┬─────┘           └────┬─────┘
     │                     │                    │                      │
     │                     │  CHECKPOINT_REQUEST│                      │
     │                     │  { seed }          │                      │
     │                     │───────────────────►│                      │
     │                     │                    │                      │
     │                     │                    │  flush events        │
     │                     │                    │  sample canvas       │
     │                     │                    │                      │
     │                     │  CHECKPOINT_RESPONSE                      │
     │                     │  { events[], pixels,                      │
     │                     │    screenW, screenH }                     │
     │                     │◄───────────────────│                      │
     │                     │                    │                      │
     │                     │  PROCESS_CHECKPOINT│                      │
     │                     │  { events, pixels, │                      │
     │                     │    nonceW, score } │                      │
     │                     │──────────────────────────────────────────►│
     │                     │                    │                      │
     │                     │                    │  keccak256(events)   │
     │                     │                    │  keccak256(pixels)   │
     │                     │                    │  build sketch        │
     │                     │                    │  update rolling hash │
     │                     │                    │                      │
     │                     │  CHECKPOINT_RESULT │                      │
     │                     │  { inputDigest,    │                      │
     │                     │    canvasHash,     │                      │
     │                     │    rollingHash,    │                      │
     │                     │    sketch }        │                      │
     │                     │◄──────────────────────────────────────────│
     │                     │                    │                      │
     │  POST /checkpoint   │                    │                      │
     │  { windowIndex,     │                    │                      │
     │    inputDigest,     │                    │                      │
     │    canvasHash,      │                    │                      │
     │    rollingHash,     │                    │                      │
     │    sketch,          │                    │                      │
     │    dpopSig }        │                    │                      │
     │◄────────────────────│                    │                      │
     │                     │                    │                      │
     │  { nextNonceW }     │                    │                      │
     │────────────────────►│                    │                      │
     │                     │  Store for next    │                      │
     │                     │  checkpoint        │                      │
```

**GameBox code:**

```typescript
let checkpointTimer: ReturnType<typeof setInterval> | null = null;
let currentWindowIndex = 0;
let currentNonce = ''; // From POST /session/start, then from each checkpoint response

function startCheckpointLoop() {
  checkpointTimer = setInterval(() => {
    // Ask SDK shim for raw data
    gameIframe.contentWindow?.postMessage({
      controller: '_digitapSecurity',
      type: 'SDK_CHECKPOINT_REQUEST',
      seed: currentWindowIndex,
      skipCanvas: true, // set false to enable canvas sampling
    }, '*');

    // Response handled in message listener (SDK_CHECKPOINT_RESPONSE → PROCESS_CHECKPOINT)
  }, 5000);
}

async function submitCheckpoint(result: WorkerCheckpointResult) {
  const response = await api.post('/score/session/checkpoint', {
    windowIndex: result.windowIndex,
    inputDigest: result.inputDigest,
    canvasHash: result.canvasHash,
    rollingHash: result.rollingHash,
    sketch: result.sketch,
    eventCount: result.eventCount,
  }, {
    headers: { 'DPoP': await signDPoP(/* ... */) }
  });

  // Store the server nonce for the NEXT checkpoint
  currentNonce = response.data.nonceW;
}
```

---

## Step 5: Server Nonce Flow (Critical)

The server nonce (`nonceW`) is what makes the rolling hash chain **server-paced**. The client cannot compute window N+1 without the nonce issued by the server after validating window N.

```
Server issues nonceW₀ at session start
        │
        ▼
Client computes H[0] = keccak256(H_init | nonceW₀ | inputDigest | canvasHash | score)
Client sends H[0] to server
        │
        ▼
Server validates H[0], issues nonceW₁
        │
        ▼
Client computes H[1] = keccak256(H[0] | nonceW₁ | inputDigest | canvasHash | score)
Client sends H[1] to server
        │
        ▼
Server validates H[1], issues nonceW₂
        ...and so on
```

**If the client tries to skip ahead or batch-generate proofs, it can't** - each window requires a nonce from the previous server response.

---

## Data Sizes

| Per Checkpoint | Size |
|----------------|------|
| `inputDigest` | 66 bytes (0x + 64 hex chars) |
| `canvasHash` | 66 bytes |
| `rollingHash` | 66 bytes |
| `sketch` | 130 bytes (0x + 128 hex chars = 64 bytes) |
| `windowIndex` | 4 bytes |
| `eventCount` | 4 bytes |
| **Total per checkpoint** | **~336 bytes** |

| Per Session End | Size |
|-----------------|------|
| `finalHash` | 66 bytes |
| `rollingHash` | 66 bytes |
| `totalWindows` | 4 bytes |
| **Total** | **~136 bytes** |

---

## Worker Message Reference

### GameBox → Worker

| Message | When | Payload |
|---------|------|---------|
| `INIT_SESSION` | After SDK_SESSION_INIT_ACK | `{ sessionId, screenW, screenH, ts }` |
| `PROCESS_CHECKPOINT` | Every 5s, after SDK_CHECKPOINT_RESPONSE | `{ windowIndex, nonceW, score, events, pixels, screenW, screenH }` |
| `COMPUTE_FINAL_HASH` | Game session ends | `{ sessionId, finalScore }` |
| `RESET` | Cleanup / new session | - |

### Worker → GameBox

| Message | When | Payload |
|---------|------|---------|
| `SESSION_READY` | After INIT_SESSION | `{ initialHash }` |
| `CHECKPOINT_RESULT` | After PROCESS_CHECKPOINT | `{ windowIndex, inputDigest, canvasHash, rollingHash, sketch, eventCount }` |
| `FINAL_HASH_RESULT` | After COMPUTE_FINAL_HASH | `{ finalHash, rollingHash, totalWindows }` |
| `ERROR` | On any failure | `{ message, context }` |

### GameBox → SDK Shim

| Message | When | Payload |
|---------|------|---------|
| `SDK_SESSION_INIT` | Session start | `{ sessionId }` |
| `SDK_CHECKPOINT_REQUEST` | Every 5s | `{ seed, skipCanvas? }` |
| `SDK_CANVAS_EMBED_REQUEST` | When Worker produces watermark | `{ data: Uint8Array }` |
| `SDK_META_REQUEST` | On demand | - |

### SDK Shim → GameBox

| Message | When | Payload |
|---------|------|---------|
| `SDK_SECURITY_READY` | Script loaded | `{ ts }` |
| `SDK_SESSION_INIT_ACK` | After SDK_SESSION_INIT | `{ meta, ts }` |
| `SDK_CHECKPOINT_RESPONSE` | After SDK_CHECKPOINT_REQUEST | `{ events, pixels, eventCount, screenW, screenH }` |
| `SDK_CANVAS_EMBED_RESPONSE` | After embed request | `{ success }` |
| `SDK_META_RESPONSE` | After meta request | `{ meta }` |

---

## Cleanup

```typescript
// When navigating away from game
function destroySession() {
  // Stop checkpoint loop
  if (checkpointTimer) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }

  // Reset worker state (reusable for next session)
  worker.postMessage({ type: 'RESET' });

  // Or terminate entirely
  worker.terminate();
}
```

---

*All controllers use `_digitapSecurity` for the security protocol. Game score/lifecycle messages use `_digitapGame` / `_digitapApp` and are handled separately by the SDK's public API.*
