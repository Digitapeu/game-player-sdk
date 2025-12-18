# WAM SDK Security Hardening - Implementation Plan

**Version:** 1.0  
**Date:** December 17, 2024  
**Status:** Ready for Implementation  
**Timeline:** 8 weeks

---

## Table of Contents

1. [Scope](#1-scope)
2. [Architecture Overview](#2-architecture-overview)
3. [Component Responsibilities](#3-component-responsibilities)
4. [Phase 0: Infrastructure](#4-phase-0-infrastructure-week-1)
5. [Phase 1: Server-Paced Checkpoints](#5-phase-1-server-paced-checkpoints-week-2)
6. [Phase 2: Input & Canvas Binding](#6-phase-2-input--canvas-binding-week-3-4)
7. [Phase 3: Behavioral Fingerprinting](#7-phase-3-behavioral-fingerprinting-week-5)
8. [Phase 4: Enforcement & Policies](#8-phase-4-enforcement--policies-week-6)
9. [Phase 5: Testing & Monitoring](#9-phase-5-testing--monitoring-week-7)
10. [Phase 6: Rollout](#10-phase-6-rollout-week-8)
11. [API Contracts](#11-api-contracts)
12. [Data Models](#12-data-models)
13. [Configuration](#13-configuration)
14. [Risk Mitigation](#14-risk-mitigation)

---

## 1. Scope

### In Scope

| Item | Description |
|------|-------------|
| Server-paced window checkpoints | Backend acts as time oracle, issues nonces |
| Rolling hash transcript | Tamper-evident event chain computed in GameBox |
| Input-bound hashing | User input digests included in hash chain |
| Canvas steganography | Watermark embedding + extraction loop |
| DPoP checkpoints | Silent device signatures every 5s |
| Passkey gating | One assertion per app session for reward tiers |
| Worker wallet binding | Final claim signed by existing wallet |
| Behavioral fingerprint | 64-byte input sketch for bot detection |
| Time clamping | Verified time = validated windows × 5s |
| Mode-based policies | Casual, Tournament, Degen enforcement levels |

### Out of Scope

| Item | Reason |
|------|--------|
| On-chain score commitment | Backend-only for now, chain later |
| Game logic verification | Cannot prove third-party game correctness |
| Video recording | Too expensive, not needed |
| ML behavioral model | Rule-based first, ML in future phase |
| SDK public API changes | Frozen, cannot break existing games |

### Constraints

1. **SDK API is frozen** - No changes to `init`, `setProgress`, `setLevelUp`, `setPlayerFailed`
2. **Games are third-party** - Cannot modify game code
3. **Cross-platform** - Must work on web, iOS webview, Android webview, Telegram Mini App
4. **Cost-sensitive** - Minimal data transfer (~500 bytes per session)

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  CLIENT                                      │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          GAME IFRAME                                  │   │
│  │                                                                       │   │
│  │   ┌─────────────────────────────────────────────────────────────┐    │   │
│  │   │                    EXISTING SDK                              │    │   │
│  │   │   • init()                    UNCHANGED                      │    │   │
│  │   │   • setProgress()             Public API frozen              │    │   │
│  │   │   • setLevelUp()              postMessage to parent          │    │   │
│  │   │   • setPlayerFailed()                                        │    │   │
│  │   └─────────────────────────────────────────────────────────────┘    │   │
│  │                              │                                        │   │
│  │                              │ postMessage (score, state, level)      │   │
│  │                              ▼                                        │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────┼───────────────────────────────────────┐   │
│  │                          GAMEBOX (Parent)                             │   │
│  │                              │                                        │   │
│  │   ┌──────────────────────────▼──────────────────────────────────┐    │   │
│  │   │                  SECURITY MODULE (NEW)                       │    │   │
│  │   │                                                              │    │   │
│  │   │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐     │    │   │
│  │   │   │ Transcript  │  │   Input     │  │    Canvas       │     │    │   │
│  │   │   │  Recorder   │  │  Collector  │  │   Steganography │     │    │   │
│  │   │   │             │  │             │  │                 │     │    │   │
│  │   │   │ rollingHash │  │ inputDigest │  │ sample/embed/   │     │    │   │
│  │   │   │ keccak256   │  │ inputSketch │  │ extract         │     │    │   │
│  │   │   └──────┬──────┘  └──────┬──────┘  └────────┬────────┘     │    │   │
│  │   │          │                │                  │               │    │   │
│  │   │          └────────────────┴──────────────────┘               │    │   │
│  │   │                           │                                  │    │   │
│  │   │   ┌───────────────────────▼───────────────────────────┐     │    │   │
│  │   │   │              Checkpoint Manager                    │     │    │   │
│  │   │   │   • Request server nonce                          │     │    │   │
│  │   │   │   • Sign with DPoP key                            │     │    │   │
│  │   │   │   • Submit checkpoint                              │     │    │   │
│  │   │   └───────────────────────┬───────────────────────────┘     │    │   │
│  │   └───────────────────────────┼──────────────────────────────────┘    │   │
│  │                               │                                       │   │
│  │   ┌───────────────────────────┼───────────────────────────────────┐  │   │
│  │   │                    CRYPTO STORE                                │  │   │
│  │   │   • DPoP Key (IndexedDB)                                      │  │   │
│  │   │   • Passkey (Secure Enclave)                                  │  │   │
│  │   │   • Worker Wallet (IndexedDB, encrypted)                      │  │   │
│  │   └───────────────────────────┬───────────────────────────────────┘  │   │
│  └───────────────────────────────┼───────────────────────────────────────┘   │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │ HTTPS
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 BACKEND                                       │
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐    │
│   │                         API LAYER                                    │    │
│   │   POST /score/session/start      → Start session, return config     │    │
│   │   POST /score/session/checkpoint → Issue nonce, verify sig          │    │
│   │   POST /score/session/end        → Final validation, store          │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                           │
│   ┌───────────────────────────────┼─────────────────────────────────────┐    │
│   │                          REDIS                                       │    │
│   │   session:{id}:state     → wIndex, nextWindowAt, lastHash, etc.    │    │
│   │   session:{id}:ticks     → Stream of checkpoints                    │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                           │
│   ┌───────────────────────────────┼─────────────────────────────────────┐    │
│   │                        POSTGRES                                      │    │
│   │   score_sessions         → Final verified sessions                  │    │
│   │   score_checkpoints      → Audit trail (optional)                   │    │
│   │   dpop_keys              → Public keys by JKT                       │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
│                                   │                                           │
│   ┌───────────────────────────────┼─────────────────────────────────────┐    │
│   │                     ASYNC PROCESSORS                                 │    │
│   │   • Behavioral classifier (input sketch → bot score)                │    │
│   │   • Anomaly detector (statistical patterns)                         │    │
│   └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Responsibilities

### 3.1 SDK (iframe) - NO CHANGES

The SDK remains **completely unchanged**. All security logic lives in GameBox.

| Current Function | Behavior | Change |
|-----------------|----------|--------|
| `init()` | postMessage SDK_SETTINGS | None |
| `setProgress()` | postMessage score/state | None |
| `setLevelUp()` | postMessage level | None |
| `setPlayerFailed()` | postMessage fail | None |

### 3.2 GameBox (Parent) - NEW SECURITY MODULE

| Module | Responsibility | Deliverable |
|--------|---------------|-------------|
| `TranscriptRecorder` | Rolling hash over events | `rollingHash` |
| `InputCollector` | Capture touch/mouse/keyboard | `inputDigest`, `inputSketch` |
| `CanvasSteganography` | Sample, embed, extract watermarks | `canvasHash`, `watermark` |
| `CheckpointManager` | Coordinate server requests + DPoP signing | `checkpoints[]` |
| `SessionManager` | Lifecycle: start → checkpoints → end | Final payload |

### 3.3 Backend - NEW ENDPOINTS

| Endpoint | Responsibility | Deliverable |
|----------|---------------|-------------|
| `POST /score/session/start` | Initialize session, return config | `sessionId`, `windowMs` |
| `POST /score/session/checkpoint` | Time gate + nonce + verify sig | `nonceW`, `validatedWindows` |
| `POST /score/session/end` | Final validation + store | `verified`, `claimedTimeMs` |

### 3.4 Backend - ASYNC PROCESSORS

| Processor | Responsibility | Input | Output |
|-----------|---------------|-------|--------|
| `BehavioralClassifier` | Bot detection | `inputSketch` | `botScore` (0-1) |
| `AnomalyDetector` | Statistical analysis | Session data | Flags |

---

## 4. Phase 0: Infrastructure (Week 1)

### Objective
Set up database schema, Redis structures, and base API scaffolding.

### Deliverables

#### 4.1 Database Schema (PostgreSQL)

```sql
-- Score sessions (final verified)
CREATE TABLE score_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  game_session_id INT NOT NULL REFERENCES game_sessions(id),
  user_id TEXT NOT NULL,
  game_id INT NOT NULL,
  
  -- Commitments
  rolling_hash TEXT NOT NULL,
  anchors_hash TEXT NOT NULL,
  input_sketch BYTEA,  -- 64 bytes
  
  -- Score data
  submitted_score INT NOT NULL,
  claimed_time_ms BIGINT NOT NULL,
  verified_time_ms BIGINT NOT NULL,
  
  -- Validation counts
  windows_expected INT NOT NULL,
  windows_validated INT NOT NULL,
  
  -- Signatures
  worker_signature TEXT,
  passkey_verified BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  sdk_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('CASUAL', 'TOURNAMENT', 'DEGEN')),
  bot_score DECIMAL(3, 2),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  
  -- Indexes
  CONSTRAINT idx_session_id UNIQUE (session_id)
);

CREATE INDEX idx_score_sessions_user ON score_sessions(user_id);
CREATE INDEX idx_score_sessions_game ON score_sessions(game_id);
CREATE INDEX idx_score_sessions_mode ON score_sessions(mode);

-- DPoP public keys (for signature verification)
CREATE TABLE dpop_keys (
  jkt TEXT PRIMARY KEY,
  public_key_jwk JSONB NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dpop_keys_user ON dpop_keys(user_id);
```

#### 4.2 Redis Structures

```
# Session state (TTL: 1 hour)
HSET session:{sessionId}:state
  userId          "user_123"
  gameId          "42"
  mode            "TOURNAMENT"
  wIndex          "0"
  nextWindowAt    "1702857600000"
  windowMs        "5000"
  lastRollingHash "0x..."
  lastScore       "0"
  validatedWindows "0"
  startedAt       "1702857595000"
  dpopJkt         "abc123..."

# Checkpoint stream (for audit)
XADD session:{sessionId}:checkpoints *
  wIndex "1"
  rollingHash "0x..."
  score "150"
  dpopSig "0x..."
  canvasHash "0x..."
  timestamp "1702857600000"
```

#### 4.3 API Scaffolding

```typescript
// src/routes/score.ts
router.post('/score/session/start', authMiddleware, startSession);
router.post('/score/session/checkpoint', authMiddleware, submitCheckpoint);
router.post('/score/session/end', authMiddleware, endSession);
```

### Acceptance Criteria
- [ ] Database migrations run successfully
- [ ] Redis structures documented
- [ ] API routes return 501 Not Implemented
- [ ] Monitoring dashboards created (empty)

---

## 5. Phase 1: Server-Paced Checkpoints (Week 2)

### Objective
Implement the server as time oracle. Clients cannot advance windows faster than wall-clock time.

### Deliverables

#### 5.1 Backend: Start Session

**Endpoint:** `POST /score/session/start`

**Request:**
```typescript
interface StartSessionRequest {
  gameId: number;
  gameSessionId: number;
  mode: 'CASUAL' | 'TOURNAMENT' | 'DEGEN';
  sdkVersion: string;
  dpopJkt: string;  // DPoP key thumbprint
  passkeyProof?: string;  // Required for TOURNAMENT/DEGEN
}
```

**Response:**
```typescript
interface StartSessionResponse {
  sessionId: string;
  windowMs: number;  // 5000
  startAtServerMs: number;
  minValidatedWindows: number;
  config: {
    requirePasskey: boolean;
    requireWorkerSig: boolean;
    maxScoreDeltaPerWindow: number | null;
  };
}
```

**Implementation:**
```typescript
async function startSession(req: Request, res: Response) {
  const { gameId, gameSessionId, mode, sdkVersion, dpopJkt, passkeyProof } = req.body;
  const userId = req.user.id;
  
  // Validate passkey for reward tiers
  if ((mode === 'TOURNAMENT' || mode === 'DEGEN') && !passkeyProof) {
    return res.status(400).json({ error: 'Passkey required for this mode' });
  }
  
  if (passkeyProof) {
    const valid = await verifyPasskeyAssertion(passkeyProof, userId);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid passkey' });
    }
  }
  
  const sessionId = crypto.randomUUID();
  const now = Date.now();
  const windowMs = 5000;
  
  // Store in Redis
  await redis.hset(`session:${sessionId}:state`, {
    userId,
    gameId,
    gameSessionId,
    mode,
    sdkVersion,
    dpopJkt,
    wIndex: 0,
    nextWindowAt: now + windowMs,
    windowMs,
    lastRollingHash: '',
    lastScore: 0,
    validatedWindows: 0,
    startedAt: now,
    passkeyVerified: !!passkeyProof
  });
  
  await redis.expire(`session:${sessionId}:state`, 3600);  // 1 hour TTL
  
  return res.json({
    sessionId,
    windowMs,
    startAtServerMs: now,
    minValidatedWindows: getMinWindows(mode),
    config: getConfig(mode)
  });
}
```

#### 5.2 Backend: Checkpoint (Time Gate + Verify)

**Endpoint:** `POST /score/session/checkpoint`

**Request:**
```typescript
interface CheckpointRequest {
  sessionId: string;
  wIndex: number;
  rollingHash: string;
  score: number;
  inputDigest: string;
  canvasHash: string;
  dpopSig: string;
}
```

**Response:**
```typescript
interface CheckpointResponse {
  accepted: boolean;
  wIndex: number;
  nonceW: string;
  validatedWindows: number;
  nextWindowAt: number;
}

// Or if too early:
interface CheckpointRetry {
  accepted: false;
  retryAfterMs: number;
}
```

**Implementation:**
```typescript
async function submitCheckpoint(req: Request, res: Response) {
  const { sessionId, wIndex, rollingHash, score, inputDigest, canvasHash, dpopSig } = req.body;
  
  // Load session
  const state = await redis.hgetall(`session:${sessionId}:state`);
  if (!state) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  const now = Date.now();
  const nextWindowAt = parseInt(state.nextWindowAt);
  const windowMs = parseInt(state.windowMs);
  const expectedWIndex = parseInt(state.wIndex) + 1;
  
  // TIME GATE: Cannot advance before time
  if (now < nextWindowAt) {
    return res.status(425).json({
      accepted: false,
      retryAfterMs: nextWindowAt - now
    });
  }
  
  // Validate window index
  if (wIndex !== expectedWIndex) {
    return res.status(400).json({ error: `Expected wIndex ${expectedWIndex}, got ${wIndex}` });
  }
  
  // Generate server nonce (deterministic for replay)
  const nonceW = keccak256(
    solidityPacked(
      ['bytes32', 'string', 'uint256', 'uint256'],
      [process.env.SERVER_SECRET, sessionId, wIndex, nextWindowAt]
    )
  );
  
  // Compute expected digest
  const checkpointDigest = keccak256(
    solidityPacked(
      ['string', 'uint256', 'bytes32', 'string', 'uint256', 'string', 'string'],
      [sessionId, wIndex, nonceW, rollingHash, score, inputDigest, canvasHash]
    )
  );
  
  // Verify DPoP signature
  const dpopKey = await getDPoPPublicKey(state.dpopJkt);
  const sigValid = await verifySignature(dpopKey, checkpointDigest, dpopSig);
  
  if (!sigValid) {
    return res.status(401).json({ error: 'Invalid DPoP signature' });
  }
  
  // Score delta check (optional per game)
  const maxDelta = getMaxScoreDelta(state.gameId, state.mode);
  if (maxDelta && score - parseInt(state.lastScore) > maxDelta) {
    return res.status(400).json({ error: 'Score delta exceeds maximum' });
  }
  
  // Update Redis state
  const newValidated = parseInt(state.validatedWindows) + 1;
  await redis.hset(`session:${sessionId}:state`, {
    wIndex,
    nextWindowAt: nextWindowAt + windowMs,
    lastRollingHash: rollingHash,
    lastScore: score,
    validatedWindows: newValidated
  });
  
  // Store checkpoint in stream (audit)
  await redis.xadd(`session:${sessionId}:checkpoints`, '*', {
    wIndex,
    rollingHash,
    score,
    inputDigest,
    canvasHash,
    dpopSig,
    nonceW,
    timestamp: now
  });
  
  return res.json({
    accepted: true,
    wIndex,
    nonceW,
    validatedWindows: newValidated,
    nextWindowAt: nextWindowAt + windowMs
  });
}
```

#### 5.3 GameBox: Checkpoint Manager

```typescript
// gamebox/security/CheckpointManager.ts

export class CheckpointManager {
  private sessionId: string;
  private config: SessionConfig;
  private dpopSigner: DPoPSigner;
  private intervalId: number | null = null;
  
  async start(sessionId: string, config: SessionConfig): Promise<void> {
    this.sessionId = sessionId;
    this.config = config;
    this.dpopSigner = new DPoPSigner();
    await this.dpopSigner.init();
    
    // Start checkpoint loop
    this.scheduleNextCheckpoint();
  }
  
  private scheduleNextCheckpoint(): void {
    this.intervalId = window.setTimeout(async () => {
      await this.submitCheckpoint();
      this.scheduleNextCheckpoint();
    }, this.config.windowMs);
  }
  
  private async submitCheckpoint(): Promise<void> {
    const wIndex = this.currentWindow + 1;
    const rollingHash = TranscriptRecorder.getHash();
    const score = this.getCurrentScore();
    const inputDigest = InputCollector.getDigest();
    const canvasHash = CanvasSteganography.getHash();
    
    // Compute digest (must match server)
    const checkpointDigest = keccak256(
      solidityPacked(
        ['string', 'uint256', 'bytes32', 'string', 'uint256', 'string', 'string'],
        [this.sessionId, wIndex, '0x', rollingHash, score, inputDigest, canvasHash]
      )
    );
    
    // Sign with DPoP key
    const dpopSig = await this.dpopSigner.sign(checkpointDigest);
    
    // Submit to server
    const response = await fetch('/score/session/checkpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        wIndex,
        rollingHash,
        score,
        inputDigest,
        canvasHash,
        dpopSig
      })
    });
    
    if (response.status === 425) {
      // Too early - server will tell us when to retry
      const { retryAfterMs } = await response.json();
      await this.delay(retryAfterMs);
      return this.submitCheckpoint();  // Retry
    }
    
    const result = await response.json();
    this.currentWindow = result.wIndex;
    this.validatedWindows = result.validatedWindows;
  }
  
  stop(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }
  }
}
```

### Acceptance Criteria
- [ ] Session start returns valid config
- [ ] Checkpoint rejects requests before `nextWindowAt`
- [ ] Checkpoint accepts requests after `nextWindowAt`
- [ ] DPoP signature verification works
- [ ] Redis state updates correctly
- [ ] Cannot generate windows faster than real time (test)

---

## 6. Phase 2: Input & Canvas Binding (Week 3-4)

### Objective
Bind the rolling hash to actual user input and canvas state.

### Deliverables

#### 6.1 GameBox: Transcript Recorder

```typescript
// gamebox/security/TranscriptRecorder.ts

import { keccak256, solidityPacked, toUtf8Bytes } from 'ethers';

export class TranscriptRecorder {
  private static rollingHash: string = '';
  private static events: TranscriptEvent[] = [];
  
  static init(sessionId: string, gameId: number): void {
    // R₀ = keccak256(sessionId || gameId || timestamp)
    this.rollingHash = keccak256(
      solidityPacked(
        ['string', 'uint256', 'uint256'],
        [sessionId, gameId, Date.now()]
      )
    );
    this.events = [];
  }
  
  static recordEvent(event: GameEvent): void {
    const transcriptEvent: TranscriptEvent = {
      v: 1,
      t: event.type,
      w: WindowClock.current(),
      ms: Date.now(),
      score: event.score,
      level: event.level,
      state: event.state
    };
    
    this.events.push(transcriptEvent);
    
    // R_i = keccak256(R_{i-1} || encode(event))
    this.rollingHash = keccak256(
      solidityPacked(
        ['bytes32', 'string'],
        [this.rollingHash, this.canonicalize(transcriptEvent)]
      )
    );
  }
  
  static commitWindow(
    score: number,
    inputDigest: string,
    serverNonce: string,
    canvasSample: string,
    watermarkExtract: string
  ): void {
    // Full commit: R_i = keccak256(R_{i-1} || score || inputDigest || nonce || canvas || watermark)
    this.rollingHash = keccak256(
      solidityPacked(
        ['bytes32', 'uint256', 'bytes32', 'bytes32', 'bytes32', 'bytes32'],
        [this.rollingHash, score, inputDigest, serverNonce, canvasSample, watermarkExtract]
      )
    );
  }
  
  static getHash(): string {
    return this.rollingHash;
  }
  
  private static canonicalize(obj: any): string {
    const sorted = Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {} as any);
    return JSON.stringify(sorted);
  }
}
```

#### 6.2 GameBox: Input Collector

```typescript
// gamebox/security/InputCollector.ts

import { keccak256, toUtf8Bytes } from 'ethers';

interface InputEvent {
  type: string;
  x?: number;
  y?: number;
  ts: number;
  pressure?: number;
  key?: string;
}

export class InputCollector {
  private static buffer: InputEvent[] = [];
  private static listeners: (() => void)[] = [];
  
  static init(): void {
    const handler = (e: TouchEvent | MouseEvent | KeyboardEvent) => {
      this.record(e);
    };
    
    // Attach to game iframe's contentWindow
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const target = iframe?.contentWindow || window;
    
    ['touchstart', 'touchmove', 'touchend', 
     'mousedown', 'mousemove', 'mouseup',
     'keydown', 'keyup'].forEach(type => {
      target.addEventListener(type, handler as EventListener, { passive: true, capture: true });
      this.listeners.push(() => target.removeEventListener(type, handler as EventListener));
    });
  }
  
  private static record(e: TouchEvent | MouseEvent | KeyboardEvent): void {
    const event: InputEvent = {
      type: e.type,
      ts: performance.now()
    };
    
    if ('clientX' in e) {
      event.x = e.clientX;
      event.y = e.clientY;
    }
    
    if ('touches' in e && e.touches.length > 0) {
      event.x = e.touches[0].clientX;
      event.y = e.touches[0].clientY;
      event.pressure = (e.touches[0] as any).force || 0;
    }
    
    if ('key' in e) {
      event.key = e.key;
    }
    
    this.buffer.push(event);
  }
  
  static getDigest(): string {
    // Hash all input events in buffer
    const data = JSON.stringify(this.buffer);
    return keccak256(toUtf8Bytes(data));
  }
  
  static getCount(): number {
    return this.buffer.length;
  }
  
  static flush(): void {
    this.buffer = [];
  }
  
  static destroy(): void {
    this.listeners.forEach(remove => remove());
    this.listeners = [];
    this.buffer = [];
  }
}
```

#### 6.3 GameBox: Canvas Steganography

```typescript
// gamebox/security/CanvasSteganography.ts

import { keccak256, toUtf8Bytes } from 'ethers';

const WATERMARK_REGION = { x: 0, y: 0, w: 64, h: 8 };
const WATERMARK_SIZE = 16;  // bytes
const SAMPLE_POINTS = 8;

export class CanvasSteganography {
  private static canvas: HTMLCanvasElement | null = null;
  private static ctx: CanvasRenderingContext2D | null = null;
  
  static init(): void {
    // Find game canvas (in iframe)
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
    this.canvas = iframeDoc?.querySelector('canvas') || document.querySelector('canvas');
    this.ctx = this.canvas?.getContext('2d') || null;
  }
  
  /**
   * Sample pixels from seed-derived random locations
   */
  static sample(seed: string): string {
    if (!this.ctx || !this.canvas) return '0x';
    
    const samples = new Uint8Array(SAMPLE_POINTS * 4);
    const w = this.canvas.width;
    const h = this.canvas.height;
    
    for (let i = 0; i < SAMPLE_POINTS; i++) {
      // Derive point from seed (unpredictable without seed)
      const pointSeed = keccak256(toUtf8Bytes(seed + i.toString()));
      const x = parseInt(pointSeed.slice(2, 10), 16) % w;
      const y = parseInt(pointSeed.slice(10, 18), 16) % h;
      
      // Sample 2x2 block, average for noise reduction
      const block = this.ctx.getImageData(x, y, 2, 2).data;
      const avg = this.averageBlock(block);
      
      // Quantize to 4 bits (handles anti-aliasing variance)
      samples[i * 4 + 0] = avg.r >> 4;
      samples[i * 4 + 1] = avg.g >> 4;
      samples[i * 4 + 2] = avg.b >> 4;
      samples[i * 4 + 3] = avg.a >> 4;
    }
    
    return keccak256(samples);
  }
  
  /**
   * Embed watermark (closed-loop binding)
   */
  static embedWatermark(seed: string): void {
    if (!this.ctx) return;
    
    const watermarkData = this.hexToBytes(keccak256(toUtf8Bytes(seed)).slice(2, 2 + WATERMARK_SIZE * 2));
    const { x, y, w, h } = WATERMARK_REGION;
    
    const imageData = this.ctx.getImageData(x, y, w, h);
    const pixels = imageData.data;
    
    // Embed in LSB of blue channel
    for (let i = 0; i < watermarkData.length * 8 && i < pixels.length / 4; i++) {
      const bit = (watermarkData[Math.floor(i / 8)] >> (7 - (i % 8))) & 1;
      const pixelIdx = i * 4 + 2;  // Blue channel
      pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
    }
    
    this.ctx.putImageData(imageData, x, y);
  }
  
  /**
   * Extract watermark from canvas
   */
  static extractWatermark(): string {
    if (!this.ctx) return '0x';
    
    const { x, y, w, h } = WATERMARK_REGION;
    const imageData = this.ctx.getImageData(x, y, w, h);
    const pixels = imageData.data;
    const data = new Uint8Array(WATERMARK_SIZE);
    
    for (let i = 0; i < WATERMARK_SIZE * 8; i++) {
      const bit = pixels[i * 4 + 2] & 1;
      data[Math.floor(i / 8)] |= bit << (7 - (i % 8));
    }
    
    return '0x' + Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  /**
   * Get current canvas hash
   */
  static getHash(): string {
    if (!this.ctx || !this.canvas) return '0x';
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    return keccak256(imageData.data);
  }
  
  private static averageBlock(block: Uint8ClampedArray): { r: number; g: number; b: number; a: number } {
    let r = 0, g = 0, b = 0, a = 0;
    const pixels = block.length / 4;
    for (let i = 0; i < block.length; i += 4) {
      r += block[i]; g += block[i+1]; b += block[i+2]; a += block[i+3];
    }
    return { r: Math.floor(r/pixels), g: Math.floor(g/pixels), b: Math.floor(b/pixels), a: Math.floor(a/pixels) };
  }
  
  private static hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
}
```

### Acceptance Criteria
- [ ] Rolling hash updates on each event
- [ ] Input digest changes with input
- [ ] Canvas sample returns consistent values for same seed
- [ ] Watermark embed/extract round-trips correctly
- [ ] Hash chain includes input + canvas + nonce

---

## 7. Phase 3: Behavioral Fingerprinting (Week 5)

### Objective
Collect a 64-byte behavioral fingerprint for bot detection.

### Deliverables

#### 7.1 GameBox: Input Sketch Builder

```typescript
// gamebox/security/InputSketchBuilder.ts

export class InputSketchBuilder {
  private tapIntervals: number[] = [];
  private lastTapTime: number = 0;
  private touchZones = new Uint8Array(8);
  private velocities: number[] = [];
  private holdDurations: number[] = [];
  private lastTouchStart: number = 0;
  
  recordTap(x: number, y: number, timestamp: number): void {
    // Tap interval
    if (this.lastTapTime > 0) {
      this.tapIntervals.push(timestamp - this.lastTapTime);
    }
    this.lastTapTime = timestamp;
    
    // Touch zone (8 zones: 4 columns × 2 rows)
    const zone = Math.min(
      Math.floor(x / (window.innerWidth / 4)) + 
      Math.floor(y / (window.innerHeight / 2)) * 4,
      7
    );
    this.touchZones[zone]++;
  }
  
  recordMove(velocity: number): void {
    this.velocities.push(velocity);
  }
  
  recordHold(duration: number): void {
    this.holdDurations.push(duration);
  }
  
  build(): Uint8Array {
    const sketch = new Uint8Array(64);
    
    // Bytes 0-7: Tap interval histogram
    const intervalHist = this.histogram(this.tapIntervals, [50, 100, 150, 200, 250, 300, 350]);
    sketch.set(this.normalize(intervalHist), 0);
    
    // Bytes 8-15: Hold duration histogram
    const holdHist = this.histogram(this.holdDurations, [50, 100, 200, 400, 800, 1600, 3200]);
    sketch.set(this.normalize(holdHist), 8);
    
    // Bytes 16-23: Touch zone distribution
    sketch.set(this.normalize(this.touchZones), 16);
    
    // Bytes 24-31: Velocity histogram
    const velocityHist = this.histogram(this.velocities, [10, 25, 50, 100, 200, 400, 800]);
    sketch.set(this.normalize(velocityHist), 24);
    
    // Bytes 32-39: Reserved (acceleration, etc.)
    
    // Bytes 40-47: Reserved
    
    // Bytes 48-55: Entropy measures
    const intervalEntropy = this.entropy(this.tapIntervals);
    const positionEntropy = this.entropy(Array.from(this.touchZones));
    sketch[48] = Math.floor(intervalEntropy * 255);
    sketch[49] = Math.floor(positionEntropy * 255);
    
    // Bytes 56-63: Metadata
    sketch[56] = Math.min(this.tapIntervals.length, 255);  // Tap count
    sketch[57] = Math.min(this.velocities.length, 255);    // Move count
    
    return sketch;
  }
  
  private histogram(values: number[], thresholds: number[]): Uint8Array {
    const hist = new Uint8Array(8);
    for (const v of values) {
      let bucket = thresholds.length;
      for (let i = 0; i < thresholds.length; i++) {
        if (v < thresholds[i]) { bucket = i; break; }
      }
      hist[Math.min(bucket, 7)]++;
    }
    return hist;
  }
  
  private normalize(hist: Uint8Array): Uint8Array {
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    return new Uint8Array(hist.map(v => Math.floor((v / total) * 255)));
  }
  
  private entropy(values: number[]): number {
    if (values.length === 0) return 0;
    const counts = new Map<number, number>();
    for (const v of values) {
      const bucket = Math.floor(v / 50);  // 50ms buckets
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
    const total = values.length;
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return Math.min(entropy / 3, 1);  // Normalize to 0-1
  }
  
  reset(): void {
    this.tapIntervals = [];
    this.lastTapTime = 0;
    this.touchZones = new Uint8Array(8);
    this.velocities = [];
    this.holdDurations = [];
  }
}
```

#### 7.2 Backend: Behavioral Classifier

```typescript
// backend/services/BehavioralClassifier.ts

export class BehavioralClassifier {
  /**
   * Classify input sketch - returns bot probability (0-1)
   */
  async classify(sketch: Uint8Array): Promise<number> {
    let botScore = 0;
    
    // Extract features
    const intervalHist = sketch.slice(0, 8);
    const holdHist = sketch.slice(8, 16);
    const zoneHist = sketch.slice(16, 24);
    const velocityHist = sketch.slice(24, 32);
    const intervalEntropy = sketch[48] / 255;
    const positionEntropy = sketch[49] / 255;
    const tapCount = sketch[56];
    const moveCount = sketch[57];
    
    // Rule 1: Tap interval variance too low = bot
    const intervalVariance = this.variance(intervalHist);
    if (intervalVariance < 10) botScore += 0.3;
    
    // Rule 2: Position entropy too low (same spot) or too high (random)
    if (positionEntropy < 0.2) botScore += 0.2;
    if (positionEntropy > 0.95) botScore += 0.15;
    
    // Rule 3: Velocity profile should be bell-shaped for humans
    const velocityShape = this.analyzeShape(velocityHist);
    if (velocityShape !== 'bell') botScore += 0.2;
    
    // Rule 4: Too few interactions for session length
    if (tapCount < 10) botScore += 0.1;
    
    // Rule 5: Interval entropy too low = too regular
    if (intervalEntropy < 0.3) botScore += 0.2;
    
    return Math.min(botScore, 1);
  }
  
  private variance(hist: Uint8Array): number {
    const values = Array.from(hist);
    const mean = values.reduce((a, b) => a + b) / values.length;
    return values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  }
  
  private analyzeShape(hist: Uint8Array): 'bell' | 'flat' | 'bimodal' | 'skewed' {
    const values = Array.from(hist);
    const max = Math.max(...values);
    const maxIdx = values.indexOf(max);
    
    // Check for bell curve: peak in middle, tails on sides
    if (maxIdx >= 2 && maxIdx <= 5) {
      const leftSum = values.slice(0, maxIdx).reduce((a, b) => a + b);
      const rightSum = values.slice(maxIdx + 1).reduce((a, b) => a + b);
      if (Math.abs(leftSum - rightSum) < max * 2) return 'bell';
    }
    
    // Check for flat: all similar values
    if (max - Math.min(...values) < 30) return 'flat';
    
    // Check for bimodal: two peaks
    const peaks = values.filter(v => v > max * 0.7).length;
    if (peaks >= 2) return 'bimodal';
    
    return 'skewed';
  }
}
```

### Acceptance Criteria
- [ ] Input sketch is exactly 64 bytes
- [ ] Sketch captures timing, spatial, velocity distributions
- [ ] Entropy measures work correctly
- [ ] Classifier produces 0-1 score
- [ ] Known bot patterns score > 0.7
- [ ] Human patterns score < 0.3

---

## 8. Phase 4: Enforcement & Policies (Week 6)

### Objective
Implement session end validation with mode-based policies.

### Deliverables

#### 8.1 Backend: End Session

**Endpoint:** `POST /score/session/end`

**Request:**
```typescript
interface EndSessionRequest {
  sessionId: string;
  finalScore: number;
  rollingHash: string;
  inputSketch: string;  // 64 bytes hex
  workerSig?: string;
}
```

**Response:**
```typescript
interface EndSessionResponse {
  verified: boolean;
  sessionId: string;
  finalScore: number;
  claimedTimeMs: number;
  verifiedTimeMs: number;
  validatedWindows: number;
  botScore: number;
  warnings: string[];
}
```

**Implementation:**
```typescript
async function endSession(req: Request, res: Response) {
  const { sessionId, finalScore, rollingHash, inputSketch, workerSig } = req.body;
  
  // Load session state
  const state = await redis.hgetall(`session:${sessionId}:state`);
  if (!state) {
    return res.status(404).json({ error: 'Session not found or expired' });
  }
  
  const mode = state.mode as 'CASUAL' | 'TOURNAMENT' | 'DEGEN';
  const policy = getPolicy(mode);
  const warnings: string[] = [];
  
  // 1. Verify rolling hash matches last checkpoint
  if (rollingHash !== state.lastRollingHash) {
    if (policy.strictHashCheck) {
      return res.status(400).json({ error: 'Rolling hash mismatch' });
    }
    warnings.push('hash_mismatch');
  }
  
  // 2. Calculate verified time
  const validatedWindows = parseInt(state.validatedWindows);
  const windowMs = parseInt(state.windowMs);
  const verifiedTimeMs = validatedWindows * windowMs;
  const claimedTimeMs = Date.now() - parseInt(state.startedAt);
  
  // 3. Check minimum windows
  if (validatedWindows < policy.minValidatedWindows) {
    if (policy.rejectInsufficientWindows) {
      return res.status(400).json({ 
        error: `Insufficient checkpoints: ${validatedWindows} < ${policy.minValidatedWindows}` 
      });
    }
    warnings.push('insufficient_checkpoints');
  }
  
  // 4. Verify worker signature (for TOURNAMENT/DEGEN)
  if (policy.requireWorkerSig) {
    if (!workerSig) {
      return res.status(400).json({ error: 'Worker signature required' });
    }
    const valid = await verifyWorkerSignature(state.userId, rollingHash, finalScore, workerSig);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid worker signature' });
    }
  }
  
  // 5. Classify behavior
  const sketchBytes = hexToBytes(inputSketch);
  const classifier = new BehavioralClassifier();
  const botScore = await classifier.classify(sketchBytes);
  
  if (botScore > policy.maxBotScore) {
    if (policy.rejectBots) {
      return res.status(400).json({ error: 'Behavioral analysis failed' });
    }
    warnings.push('behavioral_anomaly');
  }
  
  // 6. Store verified session
  await db.scoreSession.create({
    data: {
      sessionId,
      gameSessionId: parseInt(state.gameSessionId),
      userId: state.userId,
      gameId: parseInt(state.gameId),
      rollingHash,
      anchorsHash: await computeAnchorsHash(sessionId),
      inputSketch: sketchBytes,
      submittedScore: finalScore,
      claimedTimeMs,
      verifiedTimeMs,
      windowsExpected: Math.floor(claimedTimeMs / windowMs),
      windowsValidated: validatedWindows,
      workerSignature: workerSig,
      passkeyVerified: state.passkeyVerified === 'true',
      sdkVersion: state.sdkVersion,
      mode,
      botScore,
      verifiedAt: new Date()
    }
  });
  
  // 7. Cleanup Redis
  await redis.del(`session:${sessionId}:state`);
  // Keep checkpoints stream for audit (TTL will expire)
  
  return res.json({
    verified: true,
    sessionId,
    finalScore,
    claimedTimeMs,
    verifiedTimeMs,
    validatedWindows,
    botScore,
    warnings
  });
}
```

#### 8.2 Policy Configuration

```typescript
// backend/config/policies.ts

interface Policy {
  minValidatedWindows: number;
  strictHashCheck: boolean;
  rejectInsufficientWindows: boolean;
  requireWorkerSig: boolean;
  requirePasskey: boolean;
  maxBotScore: number;
  rejectBots: boolean;
  maxScoreDeltaPerWindow: number | null;
}

export const POLICIES: Record<string, Policy> = {
  CASUAL: {
    minValidatedWindows: 1,
    strictHashCheck: false,
    rejectInsufficientWindows: false,
    requireWorkerSig: false,
    requirePasskey: false,
    maxBotScore: 1.0,  // No rejection
    rejectBots: false,
    maxScoreDeltaPerWindow: null
  },
  
  TOURNAMENT: {
    minValidatedWindows: 6,  // 30 seconds minimum
    strictHashCheck: true,
    rejectInsufficientWindows: true,
    requireWorkerSig: true,
    requirePasskey: true,
    maxBotScore: 0.7,
    rejectBots: false,  // Flag but don't reject
    maxScoreDeltaPerWindow: 1000
  },
  
  DEGEN: {
    minValidatedWindows: 12,  // 60 seconds minimum
    strictHashCheck: true,
    rejectInsufficientWindows: true,
    requireWorkerSig: true,
    requirePasskey: true,
    maxBotScore: 0.5,
    rejectBots: true,  // Reject suspected bots
    maxScoreDeltaPerWindow: 500
  }
};
```

### Acceptance Criteria
- [ ] Session end validates all components
- [ ] Time is clamped to validated windows
- [ ] Worker signature verification works
- [ ] Behavioral classification runs
- [ ] Policies applied correctly per mode
- [ ] Session stored in database
- [ ] Redis cleaned up

---

## 9. Phase 5: Testing & Monitoring (Week 7)

### Objective
Comprehensive testing and monitoring infrastructure.

### Deliverables

#### 9.1 Unit Tests

```typescript
// __tests__/TranscriptRecorder.test.ts
describe('TranscriptRecorder', () => {
  it('should initialize with session hash');
  it('should update hash on each event');
  it('should produce deterministic hashes');
  it('should include all components in commit');
});

// __tests__/CanvasSteganography.test.ts
describe('CanvasSteganography', () => {
  it('should sample from seed-derived points');
  it('should embed watermark in LSB');
  it('should extract watermark correctly');
  it('should be visually imperceptible');
});

// __tests__/InputSketchBuilder.test.ts
describe('InputSketchBuilder', () => {
  it('should build 64-byte sketch');
  it('should capture timing distribution');
  it('should capture spatial distribution');
  it('should calculate entropy');
});

// __tests__/BehavioralClassifier.test.ts
describe('BehavioralClassifier', () => {
  it('should score known bot pattern > 0.7');
  it('should score known human pattern < 0.3');
  it('should handle edge cases');
});
```

#### 9.2 Integration Tests

```typescript
// __tests__/integration/session.test.ts
describe('Score Session Flow', () => {
  it('should complete casual session', async () => {
    // 1. Start session
    const start = await api.post('/score/session/start', { mode: 'CASUAL', ... });
    expect(start.sessionId).toBeDefined();
    
    // 2. Submit checkpoints
    for (let i = 0; i < 6; i++) {
      await delay(5000);
      const cp = await api.post('/score/session/checkpoint', { ... });
      expect(cp.accepted).toBe(true);
    }
    
    // 3. End session
    const end = await api.post('/score/session/end', { ... });
    expect(end.verified).toBe(true);
    expect(end.validatedWindows).toBe(6);
  });
  
  it('should reject checkpoint before time', async () => {
    const start = await api.post('/score/session/start', { ... });
    
    // Immediately try checkpoint (should fail)
    const cp = await api.post('/score/session/checkpoint', { ... });
    expect(cp.status).toBe(425);
    expect(cp.retryAfterMs).toBeGreaterThan(0);
  });
  
  it('should enforce TOURNAMENT policy', async () => {
    const start = await api.post('/score/session/start', { mode: 'TOURNAMENT', ... });
    
    // Only submit 3 checkpoints (below minimum)
    for (let i = 0; i < 3; i++) {
      await delay(5000);
      await api.post('/score/session/checkpoint', { ... });
    }
    
    // End should fail
    const end = await api.post('/score/session/end', { ... });
    expect(end.status).toBe(400);
    expect(end.error).toContain('Insufficient checkpoints');
  });
});
```

#### 9.3 Security Tests

```typescript
// __tests__/security/attacks.test.ts
describe('Attack Resistance', () => {
  it('should prevent burst checkpoint generation', async () => {
    const start = await api.post('/score/session/start', { ... });
    
    // Try to submit 10 checkpoints immediately
    const results = await Promise.all(
      Array(10).fill(0).map((_, i) => 
        api.post('/score/session/checkpoint', { wIndex: i + 1, ... })
      )
    );
    
    // Only first should succeed, rest should be time-gated
    expect(results.filter(r => r.accepted).length).toBe(1);
  });
  
  it('should detect forged DPoP signature', async () => {
    // Use wrong key to sign
    const fakeKey = await generateKey();
    const fakeSig = await sign(fakeKey, digest);
    
    const cp = await api.post('/score/session/checkpoint', { dpopSig: fakeSig, ... });
    expect(cp.status).toBe(401);
  });
  
  it('should detect hash chain tampering', async () => {
    // Submit checkpoints with inconsistent rolling hash
    // ...
    
    const end = await api.post('/score/session/end', { 
      rollingHash: 'tampered_hash', 
      ... 
    });
    expect(end.status).toBe(400);
  });
});
```

#### 9.4 Monitoring Dashboard

**Metrics to Track:**

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `session_starts_total` | Sessions started by mode | - |
| `session_completions_total` | Sessions completed | - |
| `checkpoint_success_rate` | % checkpoints accepted | < 95% |
| `checkpoint_time_gate_rejections` | Too-early requests | > 10% |
| `signature_failures` | Invalid DPoP signatures | > 5% |
| `hash_mismatches` | Rolling hash mismatches | > 1% |
| `bot_score_distribution` | Histogram of bot scores | Mean > 0.4 |
| `time_clamping_rate` | Sessions with time clamped | > 20% |
| `policy_rejections` | Sessions rejected by policy | > 5% |
| `worker_sig_failures` | Invalid worker signatures | > 1% |

**Grafana Dashboard:**

```yaml
# grafana/dashboards/score-security.json
panels:
  - title: Session Flow
    type: graph
    metrics:
      - session_starts_total
      - session_completions_total
      - policy_rejections
  
  - title: Checkpoint Health
    type: graph
    metrics:
      - checkpoint_success_rate
      - checkpoint_time_gate_rejections
      - signature_failures
  
  - title: Bot Detection
    type: heatmap
    metrics:
      - bot_score_distribution
  
  - title: Time Integrity
    type: gauge
    metrics:
      - avg(verified_time_ms / claimed_time_ms)
```

### Acceptance Criteria
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All security tests pass
- [ ] Monitoring dashboard functional
- [ ] Alerts configured

---

## 10. Phase 6: Rollout (Week 8)

### Objective
Gradual production rollout with feature flags.

### Deliverables

#### 10.1 Feature Flags

```typescript
// backend/config/featureFlags.ts

export interface FeatureFlags {
  securityEnabled: boolean;
  shadowMode: boolean;  // Collect but don't enforce
  modes: {
    CASUAL: boolean;
    TOURNAMENT: boolean;
    DEGEN: boolean;
  };
  gameOverrides: Record<number, Partial<FeatureFlags>>;
  rolloutPercentage: number;  // 0-100
}

export const DEFAULT_FLAGS: FeatureFlags = {
  securityEnabled: true,
  shadowMode: true,  // Start in shadow mode
  modes: {
    CASUAL: true,
    TOURNAMENT: true,
    DEGEN: true
  },
  gameOverrides: {},
  rolloutPercentage: 100
};
```

#### 10.2 Rollout Schedule

| Day | Action | Config |
|-----|--------|--------|
| Day 1-3 | Shadow mode all games | `shadowMode: true`, `rolloutPercentage: 100` |
| Day 4-5 | Shadow mode, monitor metrics | Review dashboards |
| Day 6-7 | Enable CASUAL enforcement | `shadowMode: false` for CASUAL only |
| Day 8-10 | Enable TOURNAMENT enforcement | `shadowMode: false` for TOURNAMENT |
| Day 11-14 | Enable DEGEN enforcement | `shadowMode: false` for DEGEN |
| Day 15+ | Full enforcement | Monitor and tune |

#### 10.3 Rollback Plan

```typescript
// Emergency rollback procedure

// Option 1: Disable all security
await setFeatureFlag('securityEnabled', false);

// Option 2: Switch to shadow mode
await setFeatureFlag('shadowMode', true);

// Option 3: Disable specific mode
await setFeatureFlag('modes.DEGEN', false);

// Option 4: Disable for specific game
await setFeatureFlag('gameOverrides.42', { securityEnabled: false });
```

### Acceptance Criteria
- [ ] Feature flags working
- [ ] Shadow mode collects data without enforcement
- [ ] Gradual rollout proceeds without issues
- [ ] Rollback tested and documented
- [ ] No increase in user complaints
- [ ] Metrics within expected ranges

---

## 11. API Contracts

### Complete Endpoint Reference

#### `POST /score/session/start`

**Purpose:** Initialize a secure game session

**Headers:**
```
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Request:**
```json
{
  "gameId": 42,
  "gameSessionId": 12345,
  "mode": "TOURNAMENT",
  "sdkVersion": "2.0.0",
  "dpopJkt": "abc123...",
  "passkeyProof": "eyJ..."
}
```

**Response (200):**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "windowMs": 5000,
  "startAtServerMs": 1702857595000,
  "minValidatedWindows": 6,
  "config": {
    "requirePasskey": true,
    "requireWorkerSig": true,
    "maxScoreDeltaPerWindow": 1000
  }
}
```

---

#### `POST /score/session/checkpoint`

**Purpose:** Submit a window checkpoint (server acts as time gate)

**Headers:**
```
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Request:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "wIndex": 5,
  "rollingHash": "0x1234...",
  "score": 1500,
  "inputDigest": "0xabcd...",
  "canvasHash": "0xef01...",
  "dpopSig": "0x9876..."
}
```

**Response (200) - Accepted:**
```json
{
  "accepted": true,
  "wIndex": 5,
  "nonceW": "0x5678...",
  "validatedWindows": 5,
  "nextWindowAt": 1702857620000
}
```

**Response (425) - Too Early:**
```json
{
  "accepted": false,
  "retryAfterMs": 2500
}
```

---

#### `POST /score/session/end`

**Purpose:** Finalize and validate the session

**Headers:**
```
Authorization: Bearer <jwt>
Content-Type: application/json
```

**Request:**
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "finalScore": 4200,
  "rollingHash": "0xfinal...",
  "inputSketch": "0x0102030405...64bytes",
  "workerSig": "0xworker..."
}
```

**Response (200):**
```json
{
  "verified": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "finalScore": 4200,
  "claimedTimeMs": 65000,
  "verifiedTimeMs": 60000,
  "validatedWindows": 12,
  "botScore": 0.15,
  "warnings": []
}
```

---

## 12. Data Models

### TypeScript Interfaces

```typescript
// Shared types between GameBox and Backend

interface SessionConfig {
  sessionId: string;
  windowMs: number;
  startAtServerMs: number;
  minValidatedWindows: number;
  requirePasskey: boolean;
  requireWorkerSig: boolean;
  maxScoreDeltaPerWindow: number | null;
}

interface Checkpoint {
  wIndex: number;
  rollingHash: string;
  score: number;
  inputDigest: string;
  canvasHash: string;
  dpopSig: string;
  nonceW: string;
  timestamp: number;
}

interface SessionEndPayload {
  sessionId: string;
  finalScore: number;
  rollingHash: string;
  inputSketch: string;
  workerSig?: string;
}

interface VerificationResult {
  verified: boolean;
  sessionId: string;
  finalScore: number;
  claimedTimeMs: number;
  verifiedTimeMs: number;
  validatedWindows: number;
  botScore: number;
  warnings: string[];
}
```

---

## 13. Configuration

### Environment Variables

```bash
# Backend
SERVER_SECRET=<32-byte-hex>           # For nonce generation
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://...

# Feature flags
SECURITY_ENABLED=true
SECURITY_SHADOW_MODE=true
SECURITY_ROLLOUT_PERCENTAGE=100

# Thresholds
MIN_WINDOWS_CASUAL=1
MIN_WINDOWS_TOURNAMENT=6
MIN_WINDOWS_DEGEN=12
MAX_BOT_SCORE_TOURNAMENT=0.7
MAX_BOT_SCORE_DEGEN=0.5
```

### GameBox Configuration

```typescript
// Injected by platform before game loads
window.__WAM_SECURITY_CONFIG__ = {
  enabled: true,
  apiBase: 'https://api.wam.app',
  windowMs: 5000,
  dpopKeyName: 'wam-dpop-key',
  workerWalletAvailable: true
};
```

---

## 14. Risk Mitigation

### Identified Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| UX friction from checkpoints | Medium | High | Silent DPoP, Passkey only at session start |
| False positive bot detection | Medium | High | Start with flags not rejections, tune thresholds |
| Canvas access fails (WebGL) | Low | Medium | Graceful degradation, skip canvas binding |
| Clock drift causes issues | Low | Medium | Server time is authoritative, generous windows |
| Performance impact | Low | Medium | Async operations, minimal overhead |
| Rollback needed | Medium | Low | Feature flags, shadow mode |

### Contingency Plans

1. **High false positive rate:** Switch to shadow mode, tune classifier
2. **Performance issues:** Reduce checkpoint frequency, skip canvas
3. **User complaints:** Disable for specific games/users
4. **Security bypass found:** Enable stricter policies immediately

---

## Summary: Deliverables by Component

### SDK (No Changes)
- ✅ Already complete

### GameBox (New Security Module)
| Module | Phase | Owner |
|--------|-------|-------|
| TranscriptRecorder | Phase 2 | Frontend |
| InputCollector | Phase 2 | Frontend |
| InputSketchBuilder | Phase 3 | Frontend |
| CanvasSteganography | Phase 2 | Frontend |
| CheckpointManager | Phase 1 | Frontend |
| SessionManager | Phase 1 | Frontend |

### Backend (New Endpoints + Processors)
| Component | Phase | Owner |
|-----------|-------|-------|
| Database schema | Phase 0 | Backend |
| Redis structures | Phase 0 | Backend |
| `/score/session/start` | Phase 1 | Backend |
| `/score/session/checkpoint` | Phase 1 | Backend |
| `/score/session/end` | Phase 4 | Backend |
| BehavioralClassifier | Phase 3 | Backend |
| Monitoring dashboard | Phase 5 | DevOps |

### Timeline Summary

| Week | Phase | Focus |
|------|-------|-------|
| 1 | Phase 0 | Infrastructure |
| 2 | Phase 1 | Server-paced checkpoints |
| 3-4 | Phase 2 | Input & canvas binding |
| 5 | Phase 3 | Behavioral fingerprinting |
| 6 | Phase 4 | Enforcement & policies |
| 7 | Phase 5 | Testing & monitoring |
| 8 | Phase 6 | Rollout |

---

**End of Implementation Plan**
