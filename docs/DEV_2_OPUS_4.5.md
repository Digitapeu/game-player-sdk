# WAM SDK Score Hardening - Implementation Plan

**Author:** Claude Opus 4.5  
**Date:** December 2024  
**Status:** Proposed  

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Constraints](#3-constraints)
4. [Solution Overview](#4-solution-overview)
5. [Core Mechanisms](#5-core-mechanisms)
   - [5.1 Rolling Hash with Input Binding](#51-rolling-hash-with-input-binding)
   - [5.2 Canvas Steganography Loop](#52-canvas-steganography-loop)
   - [5.3 Input Sketch (Behavioral Fingerprint)](#53-input-sketch-behavioral-fingerprint)
   - [5.4 Checkpoint Anchoring](#54-checkpoint-anchoring)
6. [Architecture](#6-architecture)
7. [Data Flow](#7-data-flow)
8. [Payload Design](#8-payload-design)
9. [SDK Implementation](#9-sdk-implementation)
10. [GameBox Implementation](#10-gamebox-implementation)
11. [Backend Implementation](#11-backend-implementation)
12. [Security Analysis](#12-security-analysis)
13. [Rollout Plan](#13-rollout-plan)
14. [Appendix: Code Examples](#14-appendix-code-examples)

---

## 1. Executive Summary

This document specifies a client-side score hardening system for WAM's HTML5 gaming platform. The solution creates **tamper-evident, device-bound, behaviorally-verified score submissions** while sending **less than 500 bytes per session** to the backend.

### Key Innovations

1. **Input-Bound Hash Chain**: Rolling hash cryptographically binds score progression to actual user input
2. **Canvas Steganography Loop**: Closed feedback loop proves canvas was rendered live
3. **64-Byte Behavioral Fingerprint**: Compressed input statistics enable bot detection without raw data
4. **Device-Bound Checkpoints**: DPoP signatures prove real-time device presence

### What This Proves

| Claim | Proof Mechanism |
|-------|-----------------|
| Score wasn't edited | Rolling hash integrity |
| User interacted with game | Input digest in hash chain |
| Canvas was rendered live | Steganographic watermark loop |
| Session was real-time | DPoP checkpoint density |
| Behavior was human-like | Input sketch classification |
| Bound to user identity | Worker wallet signature |

---

## 2. Problem Statement

### Current State

The existing SDK (`src/index.ts`) sends raw score data via `postMessage`:

```typescript
{
  controller: "_digitapGame",
  type: "SDK_PLAYER_SCORE_UPDATE",
  score: 4200,
  level: 3,
  state: "playing"
}
```

**Security: None.** Any attacker can:
- Inject `window.parent.postMessage({score: 999999, ...})` in console
- Modify SDK in memory
- Replay captured sessions
- Run automated bots
- Fast-forward game execution

### Requirements

1. Prevent score fabrication
2. Detect/reject automated play (bots)
3. Detect tool-assisted play
4. Prevent replay attacks
5. Verify real-time execution
6. **Constraint**: Cannot modify third-party game code
7. **Constraint**: SDK public API must remain unchanged
8. **Constraint**: Minimal backend data transfer (cost-sensitive)

---

## 3. Constraints

### Hard Constraints

| Constraint | Implication |
|------------|-------------|
| SDK API frozen | All changes must be internal/additive |
| Games are third-party HTML5 | Can't modify game logic |
| Client-only execution | No server-side game state |
| Cross-platform (web, iOS, Android, TMA) | Must work everywhere |
| Cost-sensitive | Minimize data transfer |

### Existing Primitives (in GameBox)

| Primitive | Storage | Current Use |
|-----------|---------|-------------|
| DPoP key | IndexedDB | API request signing |
| Passkey | Secure Enclave | Wallet encryption |
| Worker Wallet | IndexedDB (encrypted) | Gas voucher signing |

---

## 4. Solution Overview

### The Core Idea

Create an **unforgeable dependency chain** where:

```
Rolling Hash = f(previous_hash, score, user_input, canvas_state)
```

To produce a valid hash, an attacker must:
1. Know the previous hash (public, but chained)
2. Provide input that hashes correctly (must interact)
3. Have canvas render correctly (must run game)
4. Do all this in real-time (checkpoints enforce)

### Mathematical Foundation

```
R₀ = H(sessionId || gameId || timestamp)

For each window i:
  inputDigest_i = H(inputEvents_i)
  canvasSample_i = sampleCanvas(seed: R_{i-1})
  watermark_i = embed_then_extract(canvas, R_{i-1})
  
  R_i = H(R_{i-1} || score_i || inputDigest_i || canvasSample_i || watermark_i)
```

**Properties:**
- Forward-only: Easy to compute with real gameplay
- Tamper-evident: Any edit breaks the chain
- Input-bound: Hash depends on what user did
- Canvas-bound: Hash depends on visual state
- Time-bound: Checkpoints enforce real-time execution

---

## 5. Core Mechanisms

### 5.1 Rolling Hash with Input Binding

**Purpose:** Prove score progression is bound to actual user interaction.

**Algorithm:**

```typescript
class TranscriptRecorder {
  private rollingHash: Uint8Array;
  private inputBuffer: InputEvent[] = [];
  
  constructor(sessionId: string, gameId: string) {
    // R₀ = H(sessionId || gameId || timestamp)
    this.rollingHash = sha256(
      concat(sessionId, gameId, Date.now().toString())
    );
  }
  
  recordInput(event: InputEvent): void {
    this.inputBuffer.push({
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      ts: performance.now(),
      // Touch-specific
      pressure: event.pressure,
      radiusX: event.radiusX,
      radiusY: event.radiusY
    });
  }
  
  commitWindow(score: number, canvasSample: Uint8Array, watermark: Uint8Array): void {
    const inputDigest = sha256(canonicalize(this.inputBuffer));
    
    // R_i = H(R_{i-1} || score || inputDigest || canvasSample || watermark)
    this.rollingHash = sha256(concat(
      this.rollingHash,
      encodeScore(score),
      inputDigest,
      canvasSample,
      watermark
    ));
    
    this.inputBuffer = [];
  }
  
  getHash(): string {
    return bytesToHex(this.rollingHash);
  }
}
```

**Why Input Binding Matters:**

Without input binding:
```
Attacker: "My score is 10000"
System: "Prove it"
Attacker: Fabricates hash chain with arbitrary scores ✓
```

With input binding:
```
Attacker: "My score is 10000"
System: "Prove it"
Attacker: Must provide input sequence that:
  - Hashes to correct inputDigest for each window
  - Is statistically human-like
  - Matches score progression timeline
  ✗ Cannot fabricate without playing
```

---

### 5.2 Canvas Steganography Loop

**Purpose:** Prove the game canvas was actually rendered live, not pre-computed.

**Technique A: Canvas Sampling**

Sample pixels from unpredictable locations (determined by previous hash):

```typescript
function sampleCanvas(canvas: HTMLCanvasElement, seed: string): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width, h = canvas.height;
  const samples = new Uint8Array(32);
  
  // Derive 8 sample points from seed (unpredictable without knowing seed)
  for (let i = 0; i < 8; i++) {
    const pointSeed = sha256(seed + i.toString());
    const x = bytesToInt(pointSeed.slice(0, 4)) % w;
    const y = bytesToInt(pointSeed.slice(4, 8)) % h;
    
    // Sample 2x2 block and average (reduces device variance)
    const block = ctx.getImageData(x, y, 2, 2).data;
    const avg = averageBlock(block);
    
    // Quantize to 4 bits per channel (handles anti-aliasing differences)
    samples[i * 4 + 0] = avg.r >> 4;
    samples[i * 4 + 1] = avg.g >> 4;
    samples[i * 4 + 2] = avg.b >> 4;
    samples[i * 4 + 3] = avg.a >> 4;
  }
  
  return samples;
}
```

**Technique B: Watermark Embed-Extract Loop**

Create a closed loop: embed → render → extract → hash → embed...

```typescript
const WATERMARK_REGION = { x: 0, y: 0, w: 64, h: 8 }; // Top-left, invisible area
const WATERMARK_SIZE = 16; // bytes

function embedWatermark(canvas: HTMLCanvasElement, data: Uint8Array): void {
  const ctx = canvas.getContext('2d')!;
  const { x, y, w, h } = WATERMARK_REGION;
  const imageData = ctx.getImageData(x, y, w, h);
  const pixels = imageData.data;
  
  // Embed in LSB of blue channel
  for (let i = 0; i < data.length * 8 && i < pixels.length / 4; i++) {
    const bit = (data[Math.floor(i / 8)] >> (7 - (i % 8))) & 1;
    const pixelIdx = i * 4 + 2; // Blue channel
    pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
  }
  
  ctx.putImageData(imageData, x, y);
}

function extractWatermark(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')!;
  const { x, y, w, h } = WATERMARK_REGION;
  const imageData = ctx.getImageData(x, y, w, h);
  const pixels = imageData.data;
  const data = new Uint8Array(WATERMARK_SIZE);
  
  for (let i = 0; i < WATERMARK_SIZE * 8; i++) {
    const bit = pixels[i * 4 + 2] & 1; // Blue channel LSB
    data[Math.floor(i / 8)] |= bit << (7 - (i % 8));
  }
  
  return data;
}
```

**The Closed Loop:**

```
Window N:
├── expectedWatermark = truncate(H(R_{N-1}), 16)
├── embedWatermark(canvas, expectedWatermark)
├── [Game renders frame - watermark persists in LSB]
├── extractedWatermark = extractWatermark(canvas)
├── R_N = H(R_{N-1} || ... || extractedWatermark)
│
Window N+1:
├── expectedWatermark = truncate(H(R_N), 16)  // Depends on R_N
├── ... loop continues
```

**Why This Is Unforgeable:**

1. To compute R_N, you need extractedWatermark
2. To get extractedWatermark, you must read from canvas
3. Canvas only has correct watermark if it was embedded based on R_{N-1}
4. R_{N-1} depends on R_{N-2}, which depends on...
5. **Circular dependency requires live canvas rendering**

---

### 5.3 Input Sketch (Behavioral Fingerprint)

**Purpose:** Detect bots and tool-assisted play without sending raw input data.

**Design:** 64 bytes capturing statistical properties of input:

```typescript
interface InputSketch {
  // Timing distribution (16 bytes)
  tapIntervals: Uint8Array;      // 8 histogram buckets for time between taps
  holdDurations: Uint8Array;     // 8 histogram buckets for touch hold time
  
  // Spatial distribution (16 bytes)
  touchZones: Uint8Array;        // 8 screen zones, tap frequency per zone
  movementMagnitude: Uint8Array; // 8 buckets for swipe/move distances
  
  // Dynamics (16 bytes)
  velocityProfile: Uint8Array;   // 8 buckets for touch velocity
  accelerationProfile: Uint8Array; // 8 buckets for touch acceleration
  
  // Entropy measures (16 bytes)
  positionEntropy: Uint8Array;   // 4 bytes - randomness of touch positions
  timingEntropy: Uint8Array;     // 4 bytes - randomness of timing
  gestureVariance: Uint8Array;   // 4 bytes - variance in gesture patterns
  reserved: Uint8Array;          // 4 bytes - future use
}
```

**Histogram Bucketing:**

```typescript
class InputSketchBuilder {
  private tapIntervals: number[] = [];
  private lastTapTime: number = 0;
  private touchZoneCounts = new Uint8Array(8);
  private velocities: number[] = [];
  
  recordTap(x: number, y: number, timestamp: number): void {
    // Tap interval
    if (this.lastTapTime > 0) {
      this.tapIntervals.push(timestamp - this.lastTapTime);
    }
    this.lastTapTime = timestamp;
    
    // Touch zone (divide screen into 8 zones)
    const zone = Math.floor(x / (window.innerWidth / 4)) + 
                 Math.floor(y / (window.innerHeight / 2)) * 4;
    this.touchZoneCounts[Math.min(zone, 7)]++;
  }
  
  recordMove(velocity: number): void {
    this.velocities.push(velocity);
  }
  
  build(): Uint8Array {
    const sketch = new Uint8Array(64);
    
    // Tap intervals -> 8 histogram buckets (0-50ms, 50-100ms, ..., 350ms+)
    const intervalHist = histogram(this.tapIntervals, [50, 100, 150, 200, 250, 300, 350]);
    sketch.set(normalizeHistogram(intervalHist), 0);
    
    // Touch zones (already 8 buckets)
    sketch.set(normalizeHistogram(this.touchZoneCounts), 8);
    
    // Velocity profile
    const velocityHist = histogram(this.velocities, [10, 25, 50, 100, 200, 400, 800]);
    sketch.set(normalizeHistogram(velocityHist), 16);
    
    // ... continue for other metrics
    
    // Entropy calculations
    sketch.set(calculateEntropy(this.tapIntervals), 48);
    sketch.set(calculateEntropy(this.velocities), 52);
    
    return sketch;
  }
}

function normalizeHistogram(hist: Uint8Array): Uint8Array {
  const total = hist.reduce((a, b) => a + b, 0) || 1;
  return hist.map(v => Math.floor((v / total) * 255));
}
```

**Bot Detection Signals:**

| Signal | Human Pattern | Bot Pattern |
|--------|---------------|-------------|
| Tap interval variance | High (50-500ms range) | Low (very consistent) |
| Position entropy | Medium-high | Very low (same spots) or very high (random) |
| Velocity profile | Bell curve around natural speed | Bimodal or flat |
| Touch zone distribution | Clustered around game UI | Uniform or single-zone |

---

### 5.4 Checkpoint Anchoring

**Purpose:** Prove the session occurred in real-time, bound to user's device.

**Two-Tier Checkpoints:**

| Type | Frequency | Key | User Interaction |
|------|-----------|-----|------------------|
| DPoP (frequent) | Every window (5s) | Device key (IndexedDB) | None (silent) |
| Passkey (strong) | On session end | Secure Enclave | Biometric/PIN |

**DPoP Checkpoint:**

```typescript
interface DPoPCheckpoint {
  type: "dpop";
  windowIndex: number;
  digest: string;  // H(sessionId || windowIndex || rollingHash || score)
  signature: string;
  timestamp: number;
}

// SDK requests from GameBox
postMessage({
  controller: "_digitapGame",
  type: "SDK_REQUEST_DPOP_CHECKPOINT",
  sessionId: "...",
  windowIndex: 5,
  rollingHash: "0x...",
  score: 420
}, origin);

// GameBox responds
postMessage({
  controller: "_digitapApp", 
  type: "SDK_DPOP_CHECKPOINT_RESPONSE",
  windowIndex: 5,
  digest: "0x...",
  signature: "0x...",  // Sign(deviceKey, digest)
  timestamp: Date.now()
}, origin);
```

**Passkey Checkpoint (Session End):**

```typescript
interface PasskeyCheckpoint {
  type: "passkey";
  digest: string;  // H(sessionId || finalHash || finalScore || ...)
  credentialId: string;
  authenticatorData: string;  // Base64
  clientDataJSON: string;     // Base64
  signature: string;          // Base64
}

// Triggered at session end for reward-bearing modes
// Uses WebAuthn assertion with challenge = digest
```

**Density Enforcement:**

```
claimedTimeMs = validatedWindows × windowDurationMs

If game reports 60s but only 8 DPoP checkpoints exist:
  → claimedTimeMs = 8 × 5000 = 40000ms (clamped)
  → Rewards calculated on 40s, not 60s
```

---

## 6. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                      │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                     GAME IFRAME                                     │ │
│  │  ┌──────────────┐                                                   │ │
│  │  │  Third-Party │                                                   │ │
│  │  │    Game      │                                                   │ │
│  │  │   (HTML5)    │                                                   │ │
│  │  └──────┬───────┘                                                   │ │
│  │         │ canvas                                                     │ │
│  │         ▼                                                            │ │
│  │  ┌──────────────────────────────────────────────────────────┐       │ │
│  │  │                    WAM SDK                                │       │ │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────┐    │       │ │
│  │  │  │ Transcript  │ │   Canvas    │ │     Input        │    │       │ │
│  │  │  │  Recorder   │ │ Stegano     │ │     Sketch       │    │       │ │
│  │  │  │             │ │             │ │     Builder      │    │       │ │
│  │  │  │ rollingHash │ │ embed/      │ │                  │    │       │ │
│  │  │  │ inputDigest │ │ extract     │ │ 64-byte          │    │       │ │
│  │  │  └──────┬──────┘ └──────┬──────┘ │ fingerprint      │    │       │ │
│  │  │         │               │        └────────┬─────────┘    │       │ │
│  │  │         └───────────────┴─────────────────┘              │       │ │
│  │  │                         │                                 │       │ │
│  │  │  ┌──────────────────────┴───────────────────────┐        │       │ │
│  │  │  │              Checkpoint Manager               │        │       │ │
│  │  │  │  - Window clock                               │        │       │ │
│  │  │  │  - DPoP request/response                      │        │       │ │
│  │  │  │  - Payload builder                            │        │       │ │
│  │  │  └──────────────────────┬───────────────────────┘        │       │ │
│  │  └─────────────────────────┼────────────────────────────────┘       │ │
│  └────────────────────────────┼────────────────────────────────────────┘ │
│                               │ postMessage                              │
│                               ▼                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                         GAMEBOX (Parent)                            │ │
│  │                                                                      │ │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │ │
│  │  │   DPoP Signer   │  │ Passkey Handler │  │  Worker Wallet  │     │ │
│  │  │   (IndexedDB)   │  │ (Secure Enclave)│  │   (IndexedDB)   │     │ │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │ │
│  │           │                    │                    │               │ │
│  │           └────────────────────┴────────────────────┘               │ │
│  │                                │                                     │ │
│  │                    ┌───────────┴───────────┐                        │ │
│  │                    │   Backend Relay       │                        │ │
│  │                    └───────────┬───────────┘                        │ │
│  └────────────────────────────────┼────────────────────────────────────┘ │
└───────────────────────────────────┼─────────────────────────────────────┘
                                    │ HTTPS (~500 bytes/session)
                                    ▼
                    ┌───────────────────────────────────┐
                    │             BACKEND               │
                    │                                   │
                    │  ┌─────────────────────────────┐  │
                    │  │    Fast Ingestion Layer     │  │
                    │  │    (Redis Streams/Kafka)    │  │
                    │  └──────────────┬──────────────┘  │
                    │                 │                 │
                    │  ┌──────────────┴──────────────┐  │
                    │  │     Async Validators        │  │
                    │  │  ┌────────────────────────┐ │  │
                    │  │  │ Hash Chain Verifier    │ │  │
                    │  │  │ Checkpoint Validator   │ │  │
                    │  │  │ Density Enforcer       │ │  │
                    │  │  │ Behavioral Classifier  │ │  │
                    │  │  │ Anomaly Detector       │ │  │
                    │  │  └────────────────────────┘ │  │
                    │  └─────────────────────────────┘  │
                    └───────────────────────────────────┘
```

---

## 7. Data Flow

### Session Lifecycle

```
1. INIT
   ├── SDK.init() called by game
   ├── Generate sessionId = crypto.randomUUID()
   ├── R₀ = H(sessionId || gameId || timestamp)
   ├── Start WindowClock
   ├── Attach input listeners (touch, mouse, keyboard)
   ├── postMessage SDK_SETTINGS to GameBox

2. GAMEPLAY (repeats every window = 5s)
   ├── Collect input events → inputBuffer
   ├── On setProgress(state, score, level):
   │   ├── inputDigest = H(inputBuffer)
   │   ├── canvasSample = sampleCanvas(canvas, R_{i-1})
   │   ├── embedWatermark(canvas, H(R_{i-1}))
   │   ├── [next frame renders]
   │   ├── watermark = extractWatermark(canvas)
   │   ├── R_i = H(R_{i-1} || score || inputDigest || canvasSample || watermark)
   │   ├── updateInputSketch(inputBuffer)
   │   ├── inputBuffer = []
   │   ├── Request DPoP checkpoint from GameBox
   │   └── Send tick to GameBox: { w, score, rh, inputCount }

3. SESSION END
   ├── SDK.setPlayerFailed() or game ends
   ├── Finalize rollingHash
   ├── Finalize anchorsHash = H(allCheckpoints)
   ├── Finalize inputSketch (64 bytes)
   ├── Request Passkey checkpoint (if reward mode)
   ├── Request workerSig from GameBox
   └── Send final payload to GameBox → Backend
```

---

## 8. Payload Design

### Per-Window Tick (~25 bytes)

```typescript
interface TickPayload {
  w: number;           // Window index (uint16) - 2 bytes
  s: number;           // Score (uint32) - 4 bytes
  ic: number;          // Input count (uint16) - 2 bytes
  rh: string;          // Rolling hash truncated (16 bytes hex = 32 chars, but send raw 16 bytes)
  ts: number;          // Client timestamp (uint32) - 4 bytes
}
// Total: ~25 bytes binary, ~50 bytes JSON
```

**For 60-second game (12 windows): ~300-600 bytes**

### Session End Payload (~220 bytes)

```typescript
interface SessionEndPayload {
  sid: string;          // Session ID (16 bytes)
  gid: number;          // Game ID (4 bytes)
  v: number;            // SDK security version (1 byte)
  fs: number;           // Final score (4 bytes)
  ct: number;           // Claimed time ms (4 bytes)
  vw: number;           // Validated windows count (2 bytes)
  rh: string;           // Final rolling hash (32 bytes)
  ah: string;           // Anchors hash (32 bytes)
  is: string;           // Input sketch (64 bytes)
  ws: string;           // Worker wallet signature (64 bytes)
}
// Total: ~223 bytes binary
```

### Total Per Session: **~500-800 bytes**

Compare to alternatives:
- Raw input events: 50KB - 500KB
- Video recording: 5MB - 50MB
- **This solution: 500 bytes** (99.9% reduction)

---

## 9. SDK Implementation

### File Structure

```
src/
├── index.ts                      # Existing - minimal changes
├── security/
│   ├── index.ts                  # Security module entry point
│   ├── types.ts                  # TypeScript interfaces
│   ├── config.ts                 # Configuration
│   ├── hash.ts                   # SHA-256 wrapper
│   ├── transcript.ts             # TranscriptRecorder
│   ├── canvas-stegano.ts         # Canvas sampling + watermark
│   ├── input-sketch.ts           # InputSketchBuilder
│   ├── window-clock.ts           # WindowClock
│   ├── checkpoint-manager.ts     # CheckpointManager
│   └── payload-builder.ts        # PayloadBuilder
└── streamer.ts                   # Existing - unchanged
```

### Integration Points in `index.ts`

```typescript
// Additions to DigitapGamePlayerSDK class

import { SecurityModule } from './security';

class DigitapGamePlayerSDK {
  // ... existing code ...
  
  private static security: SecurityModule | null = null;
  
  public static init(hasScore: boolean = true, hasHighScore: boolean = true): void {
    // ... existing init code ...
    
    // Initialize security module (additive, non-breaking)
    if (SecurityModule.isEnabled()) {
      this.security = new SecurityModule({
        sessionId: crypto.randomUUID(),
        gameId: this.extractGameId(),
        canvas: document.querySelector('canvas')!
      });
      this.security.start();
    }
  }
  
  public static setProgress(state: string, score: number, level: number): void {
    // ... existing code ...
    
    // Security: record in transcript
    if (this.security) {
      this.security.recordProgress(state, score, level);
    }
    
    this.sendData();
  }
  
  private static sendData(): void {
    // Extend payload with security envelope
    const payload = this.security 
      ? { ...this.progress, _sec: this.security.getTickEnvelope() }
      : this.progress;
    
    window.parent.postMessage(payload, this.origin ?? "*");
  }
  
  public static setPlayerFailed(state: string = "FAIL"): void {
    // ... existing code ...
    
    // Security: finalize and request end checkpoint
    if (this.security) {
      this.security.finalize().then(finalPayload => {
        window.parent.postMessage({
          controller: "_digitapGame",
          type: "SDK_SESSION_END",
          payload: finalPayload
        }, this.origin ?? "*");
      });
    }
  }
}
```

### Security Module Implementation

```typescript
// src/security/index.ts

import { TranscriptRecorder } from './transcript';
import { CanvasStegano } from './canvas-stegano';
import { InputSketchBuilder } from './input-sketch';
import { WindowClock } from './window-clock';
import { CheckpointManager } from './checkpoint-manager';
import { PayloadBuilder } from './payload-builder';
import { SecurityConfig, TickEnvelope, SessionEndPayload } from './types';

export class SecurityModule {
  private config: SecurityConfig;
  private transcript: TranscriptRecorder;
  private canvas: CanvasStegano;
  private inputSketch: InputSketchBuilder;
  private clock: WindowClock;
  private checkpoints: CheckpointManager;
  private sessionId: string;
  private gameId: number;
  
  constructor(options: { sessionId: string; gameId: number; canvas: HTMLCanvasElement }) {
    this.config = SecurityConfig.load();
    this.sessionId = options.sessionId;
    this.gameId = options.gameId;
    
    this.transcript = new TranscriptRecorder(options.sessionId, options.gameId);
    this.canvas = new CanvasStegano(options.canvas);
    this.inputSketch = new InputSketchBuilder();
    this.clock = new WindowClock(this.config.windowDurationMs);
    this.checkpoints = new CheckpointManager(this.sessionId);
  }
  
  static isEnabled(): boolean {
    // Feature flag check - can be per-game, per-mode, etc.
    return true; // Or check config/feature flags
  }
  
  start(): void {
    this.clock.start();
    this.attachInputListeners();
  }
  
  private attachInputListeners(): void {
    const handler = (e: TouchEvent | MouseEvent | KeyboardEvent) => {
      this.transcript.recordInput(e);
      this.inputSketch.recordEvent(e);
    };
    
    window.addEventListener('touchstart', handler, { passive: true });
    window.addEventListener('touchmove', handler, { passive: true });
    window.addEventListener('touchend', handler, { passive: true });
    window.addEventListener('mousedown', handler, { passive: true });
    window.addEventListener('mousemove', handler, { passive: true });
    window.addEventListener('mouseup', handler, { passive: true });
    window.addEventListener('keydown', handler, { passive: true });
    window.addEventListener('keyup', handler, { passive: true });
  }
  
  recordProgress(state: string, score: number, level: number): void {
    const windowIndex = this.clock.getCurrentWindow();
    const prevHash = this.transcript.getHash();
    
    // Canvas operations
    const canvasSample = this.canvas.sample(prevHash);
    this.canvas.embedWatermark(prevHash);
    
    // Defer watermark extraction to next frame
    requestAnimationFrame(() => {
      const watermark = this.canvas.extractWatermark();
      this.transcript.commitWindow(score, canvasSample, watermark);
      
      // Request DPoP checkpoint
      if (this.clock.isCheckpointDue(windowIndex)) {
        this.checkpoints.requestDPoP(windowIndex, this.transcript.getHash(), score);
      }
    });
  }
  
  getTickEnvelope(): TickEnvelope {
    return {
      v: 1,
      sid: this.sessionId,
      w: this.clock.getCurrentWindow(),
      rh: this.transcript.getHash().slice(0, 32), // Truncated
      ic: this.transcript.getInputCount(),
      ts: Date.now()
    };
  }
  
  async finalize(): Promise<SessionEndPayload> {
    const finalHash = this.transcript.getHash();
    const anchorsHash = this.checkpoints.computeAnchorsHash();
    const inputSketch = this.inputSketch.build();
    const validatedWindows = this.checkpoints.getValidatedWindowCount();
    const claimedTimeMs = validatedWindows * this.config.windowDurationMs;
    
    // Request final Passkey + worker signature
    const { passkeySig, workerSig } = await this.checkpoints.requestFinalSignatures(
      finalHash,
      anchorsHash,
      this.transcript.getFinalScore(),
      claimedTimeMs
    );
    
    return PayloadBuilder.build({
      sessionId: this.sessionId,
      gameId: this.gameId,
      finalScore: this.transcript.getFinalScore(),
      claimedTimeMs,
      validatedWindows,
      rollingHash: finalHash,
      anchorsHash,
      inputSketch: bytesToHex(inputSketch),
      workerSig
    });
  }
}
```

---

## 10. GameBox Implementation

### New Message Handlers

```typescript
// In GameBox parent window

window.addEventListener('message', async (event) => {
  if (event.data?.controller !== '_digitapGame') return;
  
  switch (event.data.type) {
    case 'SDK_REQUEST_DPOP_CHECKPOINT':
      await handleDPoPCheckpoint(event);
      break;
      
    case 'SDK_REQUEST_PASSKEY_CHECKPOINT':
      await handlePasskeyCheckpoint(event);
      break;
      
    case 'SDK_SESSION_END':
      await handleSessionEnd(event);
      break;
      
    // ... existing handlers ...
  }
});

async function handleDPoPCheckpoint(event: MessageEvent): Promise<void> {
  const { sessionId, windowIndex, rollingHash, score } = event.data;
  
  // Compute digest
  const digest = await sha256(concat(sessionId, windowIndex, rollingHash, score));
  
  // Sign with DPoP key from IndexedDB
  const dpopKey = await getDPoPKeyFromIndexedDB();
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    dpopKey.privateKey,
    hexToBytes(digest)
  );
  
  // Respond to SDK
  event.source.postMessage({
    controller: '_digitapApp',
    type: 'SDK_DPOP_CHECKPOINT_RESPONSE',
    windowIndex,
    digest,
    signature: bytesToHex(new Uint8Array(signature)),
    timestamp: Date.now()
  }, event.origin);
}

async function handlePasskeyCheckpoint(event: MessageEvent): Promise<void> {
  const { sessionId, digest } = event.data;
  
  // Trigger WebAuthn assertion
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: hexToBytes(digest),
      rpId: 'wam.app',
      allowCredentials: [/* user's registered credentials */],
      userVerification: 'preferred',
      timeout: 60000
    }
  }) as PublicKeyCredential;
  
  const response = assertion.response as AuthenticatorAssertionResponse;
  
  event.source.postMessage({
    controller: '_digitapApp',
    type: 'SDK_PASSKEY_CHECKPOINT_RESPONSE',
    digest,
    credentialId: bytesToBase64url(new Uint8Array(assertion.rawId)),
    authenticatorData: bytesToBase64url(new Uint8Array(response.authenticatorData)),
    clientDataJSON: bytesToBase64url(new Uint8Array(response.clientDataJSON)),
    signature: bytesToBase64url(new Uint8Array(response.signature))
  }, event.origin);
}

async function handleSessionEnd(event: MessageEvent): Promise<void> {
  const { payload } = event.data;
  
  // Sign with worker wallet
  const wallet = await unlockWorkerWallet(); // Requires Passkey
  const claimDigest = await sha256(canonicalize(payload));
  const workerSig = await wallet.signMessage(hexToBytes(claimDigest));
  
  // Send to backend
  const finalPayload = { ...payload, workerSig };
  await fetch('/api/v2/game/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalPayload)
  });
}
```

---

## 11. Backend Implementation

### Ingestion Endpoint

```typescript
// POST /api/v2/game/tick
// Fast path - fire and forget

async function handleTick(req: Request): Promise<Response> {
  const tick = req.body;
  
  // Validate basic structure
  if (!isValidTick(tick)) {
    return new Response('Invalid tick', { status: 400 });
  }
  
  // Push to Redis Stream (non-blocking)
  await redis.xadd(`session:${tick.sid}:ticks`, '*', tick);
  
  // Async: update server-side timestamp for drift detection
  await redis.hset(`session:${tick.sid}:meta`, {
    lastTick: Date.now(),
    lastWindow: tick.w
  });
  
  return new Response('', { status: 202 });
}
```

### Validation Endpoint

```typescript
// POST /api/v2/game/end
// Full validation

async function handleSessionEnd(req: Request): Promise<Response> {
  const payload: SessionEndPayload = req.body;
  
  const result = await validateSession(payload);
  
  if (!result.accepted) {
    return Response.json({ 
      accepted: false, 
      reason: result.reason,
      failed: result.failedChecks 
    }, { status: 400 });
  }
  
  // Store validated session
  await db.sessions.insert({
    ...payload,
    validatedAt: Date.now(),
    claimedTimeMs: result.clampedTimeMs, // May be clamped
    warnings: result.warnings
  });
  
  // Trigger rewards if applicable
  if (result.eligibleForRewards) {
    await rewardsQueue.enqueue(payload.sid);
  }
  
  return Response.json({ 
    accepted: true,
    claimedTimeMs: result.clampedTimeMs,
    warnings: result.warnings
  });
}
```

### Validation Logic

```typescript
interface ValidationResult {
  accepted: boolean;
  reason?: string;
  failedChecks?: string[];
  clampedTimeMs: number;
  warnings: string[];
  eligibleForRewards: boolean;
}

async function validateSession(payload: SessionEndPayload): Promise<ValidationResult> {
  const checks: { name: string; pass: boolean; critical: boolean }[] = [];
  const warnings: string[] = [];
  
  // 1. Reconstruct and verify hash chain
  const ticks = await redis.xrange(`session:${payload.sid}:ticks`, '-', '+');
  const reconstructedHash = await reconstructHashChain(ticks, payload.sid, payload.gid);
  checks.push({ 
    name: 'hash_integrity', 
    pass: reconstructedHash === payload.rh,
    critical: true 
  });
  
  // 2. Verify DPoP checkpoint signatures
  const checkpoints = await getCheckpoints(payload.sid);
  const dpopChecks = checkpoints.filter(c => c.type === 'dpop');
  for (const cp of dpopChecks) {
    const valid = await verifyDPoPSignature(cp, payload.deviceKeyJwk);
    checks.push({ 
      name: `dpop_w${cp.windowIndex}`, 
      pass: valid,
      critical: false 
    });
  }
  
  // 3. Window density
  const expectedWindows = Math.ceil(payload.ct / 5000);
  const validatedWindows = dpopChecks.filter(cp => 
    checks.find(c => c.name === `dpop_w${cp.windowIndex}`)?.pass
  ).length;
  const density = validatedWindows / expectedWindows;
  checks.push({ 
    name: 'checkpoint_density', 
    pass: density >= 0.8, // 80% threshold
    critical: false 
  });
  
  // 4. Input density
  const avgInputPerWindow = ticks.reduce((a, t) => a + t.ic, 0) / ticks.length;
  checks.push({ 
    name: 'input_density', 
    pass: avgInputPerWindow >= 2, // At least 2 inputs per window
    critical: false 
  });
  
  // 5. Passkey verification (if present)
  if (payload.passkeySig) {
    const valid = await verifyPasskeyAssertion(payload.passkeySig);
    checks.push({ 
      name: 'passkey', 
      pass: valid,
      critical: true // Critical for reward modes
    });
  }
  
  // 6. Worker wallet signature
  const claimDigest = computeClaimDigest(payload);
  const walletValid = await verifyWorkerSignature(
    payload.ws, 
    claimDigest, 
    payload.userId
  );
  checks.push({ 
    name: 'worker_signature', 
    pass: walletValid,
    critical: true 
  });
  
  // 7. Behavioral analysis (async, non-blocking for accept/reject)
  const botScore = await classifyInputSketch(payload.is);
  if (botScore > 0.7) {
    warnings.push('behavioral_anomaly');
    // Queue for manual review, don't reject
  }
  if (botScore > 0.95) {
    checks.push({ 
      name: 'behavioral_classification', 
      pass: false,
      critical: true 
    });
  }
  
  // 8. Clock drift detection
  const meta = await redis.hgetall(`session:${payload.sid}:meta`);
  const serverDuration = meta.lastTick - meta.firstTick;
  const clientDuration = payload.ct;
  const drift = Math.abs(serverDuration - clientDuration) / clientDuration;
  if (drift > 0.2) { // >20% drift
    warnings.push('clock_drift');
  }
  if (drift > 0.5) { // >50% drift = likely manipulation
    checks.push({ 
      name: 'clock_integrity', 
      pass: false,
      critical: true 
    });
  }
  
  // Decision
  const criticalFailed = checks.filter(c => c.critical && !c.pass);
  if (criticalFailed.length > 0) {
    return {
      accepted: false,
      reason: 'VALIDATION_FAILED',
      failedChecks: criticalFailed.map(c => c.name),
      clampedTimeMs: 0,
      warnings,
      eligibleForRewards: false
    };
  }
  
  // Clamp time based on validated windows
  const clampedTimeMs = validatedWindows * 5000;
  
  // Non-critical failures generate warnings
  const nonCriticalFailed = checks.filter(c => !c.critical && !c.pass);
  warnings.push(...nonCriticalFailed.map(c => c.name));
  
  return {
    accepted: true,
    clampedTimeMs,
    warnings,
    eligibleForRewards: warnings.length === 0 && payload.passkeySig != null
  };
}
```

### Behavioral Classification

```typescript
// Simple rule-based classifier (can upgrade to ML later)

async function classifyInputSketch(sketchHex: string): Promise<number> {
  const sketch = hexToBytes(sketchHex);
  let botScore = 0;
  
  // Extract histograms
  const tapIntervals = sketch.slice(0, 8);
  const touchZones = sketch.slice(8, 16);
  const velocities = sketch.slice(16, 24);
  const entropy = sketch.slice(48, 56);
  
  // Check 1: Tap interval variance
  const intervalVariance = calculateVariance(tapIntervals);
  if (intervalVariance < 5) botScore += 0.3; // Too consistent = bot
  
  // Check 2: Touch zone distribution
  const zoneEntropy = calculateEntropy(touchZones);
  if (zoneEntropy < 0.5) botScore += 0.2; // Too concentrated
  if (zoneEntropy > 2.8) botScore += 0.2; // Too uniform (random)
  
  // Check 3: Velocity profile
  const velocityShape = analyzeDistributionShape(velocities);
  if (velocityShape !== 'bell') botScore += 0.2; // Humans have bell curve
  
  // Check 4: Overall entropy
  const overallEntropy = bytesToFloat(entropy.slice(0, 4));
  if (overallEntropy < 2.0) botScore += 0.2; // Too predictable
  
  return Math.min(botScore, 1.0);
}
```

---

## 12. Security Analysis

### Threat Matrix

| Threat | Attack Vector | Defense | Effectiveness |
|--------|---------------|---------|---------------|
| Score fabrication | Inject fake postMessage | Rolling hash must chain correctly | ✅ Strong |
| Replay attack | Resubmit old session | sessionId nonce, bound from R₀ | ✅ Strong |
| Fast-forward | Speed up game clock | DPoP checkpoint density | ✅ Strong |
| Bot automation | Script plays game | Input sketch + behavioral analysis | ⚠️ Good (not perfect) |
| Tool-assisted | Auto-aim, slowdown | Canvas binding + input patterns | ⚠️ Good |
| Memory editing | Modify score in memory | Hash chain breaks | ✅ Strong |
| Pre-rendering | Pre-compute canvas | Watermark loop dependency | ✅ Strong |
| Device spoofing | Fake DPoP key | Key bound to device, Passkey requires enclave | ✅ Strong |
| Identity theft | Steal credentials | Worker wallet requires Passkey unlock | ✅ Strong |

### What Cannot Be Prevented

1. **Perfect bot that mimics human behavior**: If a bot produces human-like input patterns AND plays the game legitimately, it's indistinguishable from a human. This is acceptable - they're "earning" the score.

2. **Compromised device**: If attacker has root access to device AND secure enclave, all bets are off. Out of scope.

3. **Collusion with game developer**: If game code is modified to report fake scores, can't detect without game-specific validation.

### Residual Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Sophisticated bot bypasses ML | Medium | Medium | Continuous model training, manual review |
| Device key extraction | Low | High | Passkey required for high-value |
| Zero-day in WebAuthn | Very Low | Critical | Defense in depth, multiple layers |

---

## 13. Rollout Plan

### Phase 0: Shadow Mode (Week 1-4)

**Goal:** Collect baseline data, verify no breakage

- Deploy SDK with security module in observe-only mode
- Collect all transcripts, sketches, hashes
- **No enforcement**
- Backend validates offline, compares to actual outcomes
- Build behavioral baselines per game

**Success Criteria:**
- 0 game breakages
- >99% sessions produce valid hash chains
- Baseline data for all active games

### Phase 1: Soft Enforcement (Week 5-8)

**Goal:** Start clamping time, don't reject

- Enable DPoP checkpoints
- Clamp `claimedTimeMs` based on validated windows
- Flag sessions with anomalies for review
- **Don't reject any sessions yet**

**Success Criteria:**
- <1% sessions flagged
- No false positives on manual review
- Clamp logic matches expected behavior

### Phase 2: Hard Enforcement - Casual (Week 9-12)

**Goal:** Enforce for non-reward modes

- Reject sessions with invalid hash chains
- Reject sessions with 0 input density
- Continue soft enforcement for reward modes

**Success Criteria:**
- Rejection rate <0.5%
- No legitimate user complaints
- Cheating attempts blocked

### Phase 3: Hard Enforcement - Rewards (Week 13+)

**Goal:** Full enforcement for all modes

- Require Passkey checkpoint for reward-bearing sessions
- Full behavioral classification
- Reject high-confidence bots

**Success Criteria:**
- Cheating effectively eliminated
- False positive rate <0.01%
- User friction acceptable

### Rollback Plan

Each phase has a kill switch:

```typescript
// Backend config
{
  "security": {
    "enabled": true,
    "mode": "shadow" | "soft" | "hard_casual" | "hard_full",
    "perGameOverrides": {
      "game_123": "shadow" // Override for specific game
    }
  }
}
```

---

## 14. Appendix: Code Examples

### A. SHA-256 Implementation (Browser)

```typescript
// src/security/hash.ts

export async function sha256(data: Uint8Array | string): Promise<string> {
  const buffer = typeof data === 'string' 
    ? new TextEncoder().encode(data) 
    : data;
  
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return bytesToHex(new Uint8Array(hashBuffer));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
```

### B. Canonical Encoding

```typescript
// src/security/canonical.ts

export function canonicalize(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

export function encodeScore(score: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, score, false); // Big-endian
  return new Uint8Array(buffer);
}

export function encodeTimestamp(ts: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, BigInt(ts), false);
  return new Uint8Array(buffer);
}
```

### C. Window Clock

```typescript
// src/security/window-clock.ts

export class WindowClock {
  private startTime: number = 0;
  private windowDurationMs: number;
  private currentWindow: number = 0;
  
  constructor(windowDurationMs: number = 5000) {
    this.windowDurationMs = windowDurationMs;
  }
  
  start(): void {
    this.startTime = performance.now();
    this.currentWindow = 0;
  }
  
  getCurrentWindow(): number {
    const elapsed = performance.now() - this.startTime;
    return Math.floor(elapsed / this.windowDurationMs);
  }
  
  isNewWindow(): boolean {
    const newWindow = this.getCurrentWindow();
    if (newWindow > this.currentWindow) {
      this.currentWindow = newWindow;
      return true;
    }
    return false;
  }
  
  isCheckpointDue(windowIndex: number): boolean {
    // DPoP every window
    return true;
  }
  
  getElapsedMs(): number {
    return performance.now() - this.startTime;
  }
}
```

### D. Full TranscriptRecorder

```typescript
// src/security/transcript.ts

import { sha256, concat, bytesToHex, hexToBytes } from './hash';
import { encodeScore, canonicalize } from './canonical';

interface InputEvent {
  type: string;
  x?: number;
  y?: number;
  ts: number;
  pressure?: number;
}

export class TranscriptRecorder {
  private rollingHash: Uint8Array;
  private inputBuffer: InputEvent[] = [];
  private inputCount: number = 0;
  private lastScore: number = 0;
  
  constructor(sessionId: string, gameId: number) {
    // Will be set async
    this.rollingHash = new Uint8Array(32);
    this.initHash(sessionId, gameId);
  }
  
  private async initHash(sessionId: string, gameId: number): Promise<void> {
    const initData = canonicalize({
      sessionId,
      gameId,
      timestamp: Date.now()
    });
    this.rollingHash = hexToBytes(await sha256(initData));
  }
  
  recordInput(event: TouchEvent | MouseEvent | KeyboardEvent): void {
    const inputEvent: InputEvent = {
      type: event.type,
      ts: performance.now()
    };
    
    if ('clientX' in event) {
      inputEvent.x = event.clientX;
      inputEvent.y = event.clientY;
    }
    
    if ('touches' in event && event.touches.length > 0) {
      inputEvent.x = event.touches[0].clientX;
      inputEvent.y = event.touches[0].clientY;
      inputEvent.pressure = (event.touches[0] as any).force;
    }
    
    this.inputBuffer.push(inputEvent);
    this.inputCount++;
  }
  
  async commitWindow(
    score: number, 
    canvasSample: Uint8Array, 
    watermark: Uint8Array
  ): Promise<void> {
    // inputDigest = H(inputBuffer)
    const inputDigest = hexToBytes(await sha256(canonicalize(this.inputBuffer)));
    
    // R_i = H(R_{i-1} || score || inputDigest || canvasSample || watermark)
    this.rollingHash = hexToBytes(await sha256(concat(
      this.rollingHash,
      encodeScore(score),
      inputDigest,
      canvasSample,
      watermark
    )));
    
    this.lastScore = score;
    this.inputBuffer = [];
  }
  
  getHash(): string {
    return bytesToHex(this.rollingHash);
  }
  
  getInputCount(): number {
    const count = this.inputBuffer.length;
    return count;
  }
  
  getFinalScore(): number {
    return this.lastScore;
  }
}
```

### E. Complete Canvas Steganography

```typescript
// src/security/canvas-stegano.ts

import { sha256, hexToBytes, bytesToHex } from './hash';

const WATERMARK_REGION = { x: 0, y: 0, w: 64, h: 8 };
const WATERMARK_SIZE = 16; // bytes
const SAMPLE_POINTS = 8;

export class CanvasStegano {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }
  
  /**
   * Sample pixels from unpredictable locations based on seed
   */
  async sample(seed: string): Promise<Uint8Array> {
    const samples = new Uint8Array(SAMPLE_POINTS * 4);
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    for (let i = 0; i < SAMPLE_POINTS; i++) {
      const pointSeed = await sha256(seed + i.toString());
      const x = parseInt(pointSeed.slice(0, 8), 16) % w;
      const y = parseInt(pointSeed.slice(8, 16), 16) % h;
      
      // Sample 2x2 block and average for noise reduction
      const block = this.ctx.getImageData(x, y, 2, 2).data;
      const avg = this.averageBlock(block);
      
      // Quantize to 4 bits (handles anti-aliasing variance)
      samples[i * 4 + 0] = avg.r >> 4;
      samples[i * 4 + 1] = avg.g >> 4;
      samples[i * 4 + 2] = avg.b >> 4;
      samples[i * 4 + 3] = avg.a >> 4;
    }
    
    return samples;
  }
  
  private averageBlock(block: Uint8ClampedArray): { r: number; g: number; b: number; a: number } {
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
  
  /**
   * Embed watermark in canvas LSB
   */
  async embedWatermark(seed: string): Promise<void> {
    const watermarkData = hexToBytes((await sha256(seed)).slice(0, WATERMARK_SIZE * 2));
    const { x, y, w, h } = WATERMARK_REGION;
    
    const imageData = this.ctx.getImageData(x, y, w, h);
    const pixels = imageData.data;
    
    // Embed in LSB of blue channel
    for (let i = 0; i < watermarkData.length * 8 && i < pixels.length / 4; i++) {
      const bit = (watermarkData[Math.floor(i / 8)] >> (7 - (i % 8))) & 1;
      const pixelIdx = i * 4 + 2; // Blue channel
      pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
    }
    
    this.ctx.putImageData(imageData, x, y);
  }
  
  /**
   * Extract watermark from canvas LSB
   */
  extractWatermark(): Uint8Array {
    const { x, y, w, h } = WATERMARK_REGION;
    const imageData = this.ctx.getImageData(x, y, w, h);
    const pixels = imageData.data;
    const data = new Uint8Array(WATERMARK_SIZE);
    
    for (let i = 0; i < WATERMARK_SIZE * 8; i++) {
      const bit = pixels[i * 4 + 2] & 1; // Blue channel LSB
      data[Math.floor(i / 8)] |= bit << (7 - (i % 8));
    }
    
    return data;
  }
}
```

---

## Summary

This implementation provides **defense in depth** against score manipulation:

1. **Cryptographic integrity** via rolling hash chain
2. **Input binding** makes hash depend on actual interaction  
3. **Canvas binding** via steganography proves live rendering
4. **Time binding** via checkpoint density prevents fast-forward
5. **Device binding** via DPoP signatures proves device possession
6. **Identity binding** via worker wallet ties score to user
7. **Behavioral analysis** via input sketch detects automation

All while sending **<500 bytes per session** to the backend.

---

**End of Document**
