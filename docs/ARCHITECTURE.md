# WAM Game Player SDK - Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Build Artifacts](#build-artifacts)
4. [Communication Protocol](#communication-protocol)
5. [SDK Shim Modules](#sdk-shim-modules)
6. [Security Worker Modules](#security-worker-modules)
7. [Backward Compatibility (v1.0.0 API)](#backward-compatibility-v100-api)
8. [Checkpoint Protocol](#checkpoint-protocol)
9. [Security Model](#security-model)
10. [Build System](#build-system)
11. [Data Structures](#data-structures)

---

## Overview

The WAM Game Player SDK is a JavaScript/TypeScript library that integrates HTML5 games with the WAM gaming platform. It produces **two build artifacts**:

1. **SDK Shim** (`main.min.4.js`) - Runs inside the game iframe. Ultra-thin, zero crypto dependencies. Captures raw input events and canvas pixels, forwards them to GameBox via `postMessage`.

2. **Security Worker** (`security-worker.min.js`) - Runs in a dedicated Web Worker thread spawned by GameBox. Handles all cryptographic operations: keccak256 hashing, rolling hash chain, input digest, canvas hash, behavioral sketch building.

### Why Two Artifacts

| Problem | Root Cause | Solution |
|---------|-----------|----------|
| Security code was bypassable | All crypto ran in same JS context as the game (iframe main thread) | Crypto runs in a Worker thread owned by GameBox - game iframe cannot access it |
| Android performance killed | keccak256 + canvas sampling blocked the game's rendering thread | All computation runs on a separate OS thread - zero frame impact |
| Rolling hash disabled (returned `0x0`) | Too expensive for mobile | Worker computes it off-thread, re-enabled |
| Input digest disabled (returned `0x0`) | Blocking main thread | Worker computes it off-thread, re-enabled |

### Design Principles

- **Non-intrusive**: SDK shim must never crash or interfere with game functionality
- **Passive capture**: Input capture runs with `{ passive: true }` event listeners
- **Silent failures**: Errors are caught, never thrown to game code
- **Strict message filtering**: Only accept messages from `window.parent` (GameBox)
- **Zero crypto in iframe**: SDK shim has no `@noble/hashes` dependency at all
- **Separate thread**: All hashing/signing runs in a Web Worker (off main thread)

---

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                  CLIENT                                        │
│                                                                                │
│  ┌──────────────────────────────────────────────────────────────────────────┐  │
│  │                          GAME IFRAME                                     │  │
│  │                                                                          │  │
│  │   ┌────────────────────────────────────────────────────────────────┐     │  │
│  │   │                    SDK (Public API UNCHANGED)                   │     │  │
│  │   │   • init()           • setProgress()                           │     │  │
│  │   │   • setLevelUp()     • setPlayerFailed()                       │     │  │
│  │   └────────────────────────────────────────────────────────────────┘     │  │
│  │                              │                                           │  │
│  │   ┌──────────────────────────┴─────────────────────────────────────┐     │  │
│  │   │              SDK Security Shim (NO CRYPTO)                      │     │  │
│  │   │                                                                 │     │  │
│  │   │   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐   │     │  │
│  │   │   │  InputCapture   │  │  CanvasHandler  │  │ Metadata     │   │     │  │
│  │   │   │  raw {t,x,y,e} │  │  raw Uint8Array │  │ Collector    │   │     │  │
│  │   │   │  tuples         │  │  pixels         │  │              │   │     │  │
│  │   │   └─────────────────┘  └─────────────────┘  └──────────────┘   │     │  │
│  │   │                              │                                  │     │  │
│  │   │          postMessage (raw bytes, _digitapSecurity)              │     │  │
│  │   └──────────────────────────────┼──────────────────────────────────┘     │  │
│  └──────────────────────────────────┼───────────────────────────────────────┘  │
│                                     │                                          │
│                                     ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │                          GAMEBOX (Parent)                                 │ │
│  │                                                                           │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐     │ │
│  │   │                  Security Orchestrator                          │     │ │
│  │   │   Receives raw data from SDK shim via postMessage               │     │ │
│  │   │   Forwards to Worker via Worker.postMessage                     │     │ │
│  │   │   Sends computed results to backend via HTTPS                   │     │ │
│  │   └──────────────────────────────┬──────────────────────────────────┘     │ │
│  │                                  │                                        │ │
│  │   ┌──────────────────────────────┴──────────────────────────────────┐     │ │
│  │   │              SECURITY WORKER (separate OS thread)               │     │ │
│  │   │                                                                 │     │ │
│  │   │   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐   │     │ │
│  │   │   │  Rolling Hash   │  │  SketchBuilder  │  │  keccak256   │   │     │ │
│  │   │   │  Chain Engine   │  │  64-byte        │  │  All crypto  │   │     │ │
│  │   │   │  H[w] = f(...)  │  │  fingerprint    │  │  operations  │   │     │ │
│  │   │   └─────────────────┘  └─────────────────┘  └──────────────┘   │     │ │
│  │   │                                                                 │     │ │
│  │   │   Computes: inputDigest, canvasHash, rollingHash, sketch        │     │ │
│  │   │   Game iframe CANNOT access this thread                         │     │ │
│  │   └─────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                           │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐     │ │
│  │   │                    CRYPTO STORE                                  │     │ │
│  │   │   • DPoP Key (IndexedDB) - for checkpoint signatures            │     │ │
│  │   │   • Worker Wallet (IndexedDB, encrypted with Passkey)           │     │ │
│  │   └──────────────────────────────┬──────────────────────────────────┘     │ │
│  └──────────────────────────────────┼────────────────────────────────────────┘ │
└─────────────────────────────────────┼──────────────────────────────────────────┘
                                      │ HTTPS
                                      ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                                 BACKEND                                       │
│   POST /score/session/start      → Start session, return config               │
│   POST /score/session/checkpoint → Verify DPoP sig, validate hashes           │
│   POST /score/session/end        → Verify worker wallet sig, store            │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Checkpoint Cycle

```
1. GameBox receives server nonce (nonceW) from backend
2. GameBox → SDK shim:  SDK_CHECKPOINT_REQUEST { seed, skipCanvas }
3. SDK shim collects:
   • InputCapture.flush()  → RawEventTuple[]  (raw, no hash)
   • CanvasHandler.sampleRaw(seed) → Uint8Array  (raw pixels, no hash)
4. SDK shim → GameBox:  SDK_CHECKPOINT_RESPONSE { events, pixels, screenW, screenH }
5. GameBox → Worker:    PROCESS_CHECKPOINT { events, pixels, nonceW, score, ... }
6. Worker computes (off main thread):
   • inputDigest  = keccak256(events)
   • canvasHash   = keccak256(pixels)
   • sketch       = SketchBuilder.build()
   • rollingHash  = keccak256(prevHash | nonceW | inputDigest | canvasHash | score)
7. Worker → GameBox:    CHECKPOINT_RESULT { inputDigest, canvasHash, rollingHash, sketch }
8. GameBox signs with DPoP key and sends to backend
```

### Initialization Sequence

```
1. Browser loads iframe with game + SDK script
                    │
2. SDK script executes immediately
   ├── Attach global message listener
   ├── Initialize SecurityBridge (shim mode)
   │   ├── Start InputCapture (passive event listeners)
   │   ├── Start CanvasHandler (canvas polling)
   │   └── Send SDK_SECURITY_READY beacon
   └── Start Connection Handshake (with retry)
       ├── Send SDK_LOADED beacon to parent
       └── Retry every 500ms (max 10 attempts)
                    │
3. GameBox receives SDK_LOADED + SDK_SECURITY_READY
   ├── Spawn Security Worker: new Worker('security-worker.min.js')
   └── Send SDK_SESSION_INIT to SDK
                    │
4. SDK receives SDK_SESSION_INIT
   ├── Collect session metadata
   ├── Send SDK_SESSION_INIT_ACK { meta, ts }
   └── Set _isConnected = true
                    │
5. GameBox → Worker: INIT_SESSION { sessionId, screenW, screenH, ts }
   └── Worker computes H₀ = keccak256(sessionId | screenW | screenH | ts)
                    │
6. Game code calls digitapSDK('init', ...)
   ├── Send SDK_SETTINGS to parent
   └── GameBox ready to request checkpoints
```

### Connection Retry Mechanism

| Parameter | Value | Description |
|-----------|-------|-------------|
| `_MAX_INIT_RETRIES` | 10 | Maximum connection attempts |
| `_INIT_RETRY_DELAY_MS` | 500ms | Delay between retries |
| **Total timeout** | 5 seconds | After which SDK continues without session |

The SDK remains functional even if GameBox doesn't respond - score reporting and callbacks still work, but security checkpoints won't be available until a session is established.

---

## Build Artifacts

| Artifact | File | Size (prod) | Contains | Crypto | Domain Lock |
|----------|------|-------------|----------|--------|-------------|
| SDK Shim | `dist/main.min.4.js` | ~30 KB | Public API, security shim, legacy compat, WebRTC | None | Yes |
| Security Worker | `dist/security-worker.min.js` | ~7 KB | keccak256, rolling hash, sketch builder | All | No |

### Why the Worker Has No Domain Lock

The SDK shim runs in the game iframe on domains like `game.wam.app`. The Worker runs in the GameBox origin (`wam.app`, `app.wam.app`). Domain locking the Worker to game domains would break it.

### Dependency Split

| Dependency | SDK Shim | Security Worker |
|------------|:--------:|:---------------:|
| `@noble/hashes` | - | keccak256 |
| DOM APIs | window, canvas, touch events | - |
| Web Worker API | - | self.onmessage |

---

## Communication Protocol

### Controllers

| Controller | Direction | Purpose |
|------------|-----------|---------|
| `_digitapGame` | SDK → GameBox | Game state (scores, levels, progress) |
| `_digitapApp` | GameBox → SDK | Game commands (start, pause, continue) |
| `_digitapSecurity` | Bidirectional | Security shim requests/responses |

### Message Structure

```typescript
{
  controller: '_digitapGame' | '_digitapApp' | '_digitapSecurity',
  type: string,
  ...payload
}
```

### Game Protocol Messages

#### SDK → GameBox (`_digitapGame`)

| Type (v2+) | Legacy Type (v1.0.0) | Description | Payload |
|------------|----------------------|-------------|---------|
| `SDK_SETTINGS` | `settings` | SDK initialized | `{ ui, ready }` |
| `SDK_PLAYER_SCORE_UPDATE` | `progress` | Score changed | `{ state, score, level, continueScore }` |
| `SDK_PLAYER_LEVEL_UP` | - | Level increased | `{ level }` |
| `SDK_PLAYER_FAILED` | - | Player died | `{ state, score: 0, continueScore }` |
| `SDK_LOADED` | - | Script loaded beacon | `{ ts }` |

#### GameBox → SDK (`_digitapApp`)

| Type (v2+) | Legacy Type (v1.0.0) | Description |
|------------|----------------------|-------------|
| `SDK_START_GAME` | `startGame` | Start game |
| `SDK_PAUSE_GAME` | - | Pause game |
| `SDK_START_GAME_FROM_ZERO` | `startGameFromZero` | Restart from zero |
| `SDK_CONTINUE_WITH_CURRENT_SCORE` | `continueWithCurrentScore` | Continue after death (revive) |

### Security Protocol Messages (SDK Shim ↔ GameBox)

| Type | Direction | Payload |
|------|-----------|---------|
| `SDK_SECURITY_READY` | SDK → GB | `{ ts }` |
| `SDK_SESSION_INIT` | GB → SDK | `{ sessionId }` |
| `SDK_SESSION_INIT_ACK` | SDK → GB | `{ meta, ts }` |
| `SDK_CHECKPOINT_REQUEST` | GB → SDK | `{ seed, skipCanvas }` |
| `SDK_CHECKPOINT_RESPONSE` | SDK → GB | `{ events, pixels, eventCount, screenW, screenH }` |
| `SDK_CHECKPOINT_ACK` | GB → SDK | - |
| `SDK_CANVAS_EMBED_REQUEST` | GB → SDK | `{ data: Uint8Array }` |
| `SDK_CANVAS_EMBED_RESPONSE` | SDK → GB | `{ success }` |
| `SDK_META_REQUEST` | GB → SDK | - |
| `SDK_META_RESPONSE` | SDK → GB | `{ meta }` |

### Worker Protocol Messages (GameBox Main Thread ↔ Worker)

| Type | Direction | Payload |
|------|-----------|---------|
| `INIT_SESSION` | GB → Worker | `{ sessionId, screenW, screenH, ts }` |
| `SESSION_READY` | Worker → GB | `{ initialHash }` |
| `PROCESS_CHECKPOINT` | GB → Worker | `{ windowIndex, nonceW, score, events, pixels, screenW, screenH }` |
| `CHECKPOINT_RESULT` | Worker → GB | `{ windowIndex, inputDigest, canvasHash, rollingHash, sketch, eventCount }` |
| `COMPUTE_FINAL_HASH` | GB → Worker | `{ sessionId, finalScore }` |
| `FINAL_HASH_RESULT` | Worker → GB | `{ finalHash, rollingHash, totalWindows }` |
| `RESET` | GB → Worker | - |
| `ERROR` | Worker → GB | `{ message, context }` |

### Message Filtering

The SDK shim implements strict message filtering:

```typescript
if (event.source !== window.parent) return;               // Must be GameBox
if (!data || typeof data !== 'object') return;             // Must be valid object
if (data.controller !== '_digitapSecurity') return;        // Must be our protocol
if (!VALID_TYPES.includes(data.type)) return;              // Must be known type
```

#### Allowed Origins

```typescript
'https://wam.app'
'https://app.wam.app'
'https://wam.eu'
'https://win.wam.app'
'https://play.wam.app'
```

### Player Death & Revive Flow

```
Game calls: setPlayerFailed('FAIL')
        │
        ├── Captures continueScore = score before zeroing
        ├── Sets: _deathTimestamp = Date.now()  ← Grace period starts
        ├── Sends SDK_PLAYER_FAILED to GameBox
        │
        └── GameBox sends SDK_PAUSE_GAME
                    │
            Within 500ms of death?
            YES: Delay pause (death animation grace period)
            NO:  Pause immediately
                    │
        ┌───────────┴───────────┐
        │                       │
SDK_START_GAME_FROM_ZERO    SDK_CONTINUE_WITH_CURRENT_SCORE
        │                       │
        ├── score = 0           ├── score = continueScore
        ├── level = 0           ├── level preserved
        ├── afterStartGame      └── afterContinueWithCurrentScore()
        │   FromZero()
        └── afterStartGame()
```

---

## SDK Shim Modules

### SecurityBridge (Shim)

**Location:** `src/security/SecurityBridge.ts`

Thin coordinator between game iframe and GameBox parent. No crypto, no rolling state.

| Responsibility | How |
|----------------|-----|
| Listen for GameBox requests | `window.addEventListener('message', ...)` |
| Collect raw input events | `InputCapture.flush()` → `RawEventTuple[]` |
| Collect raw canvas pixels | `CanvasHandler.sampleRaw(seed)` → `Uint8Array` |
| Collect session metadata | `MetadataCollector.collect()` → `SessionMeta` |
| Write watermark bytes | `CanvasHandler.embedWatermark(data)` → `boolean` |
| Forward all raw data to GameBox | `event.source.postMessage(response, origin)` |

**What it does NOT do:**
- No keccak256 hashing
- No rolling hash chain state
- No sketch building
- No input digest computation
- No imports from `@noble/hashes`

### InputCapture

**Location:** `src/security/InputCapture.ts`

Passively captures user input events and returns compact raw tuples.

| Feature | Value |
|---------|-------|
| Events captured | `touchstart`, `touchend`, `mousedown`, `mouseup` |
| Events NOT captured | `touchmove`, `mousemove` (too frequent on mobile) |
| Buffer limit | 5,000 events |
| Listener mode | `{ passive: true }` |
| Output format | `RawEventTuple[]` - `{ t, x, y, e }` |
| Hashing | None (Worker does it) |

```typescript
interface RawEventTuple {
  t: number;  // performance.now() timestamp
  x: number;  // clientX (raw pixels)
  y: number;  // clientY (raw pixels)
  e: number;  // 1 = tap, 0 = release
}
```

### CanvasHandler

**Location:** `src/security/CanvasHandler.ts`

Reads raw pixel data from the game canvas. Returns raw bytes for the Worker to hash.

| Canvas Type | Detection | Sampling Method |
|-------------|-----------|-----------------|
| 2D Canvas | `getContext('2d')` returns context | Direct `getImageData()` |
| WebGL Canvas | `getContext('webgl'/'webgl2')` | Snapshot to offscreen 2D canvas |

**Key methods:**

| Method | Returns | Purpose |
|--------|---------|---------|
| `sampleRaw(seed)` | `Uint8Array \| null` | Raw RGBA bytes at deterministic points |
| `embedWatermark(data)` | `boolean` | Write LSB steganography (2D canvas only) |

Deterministic point selection uses a fast integer PRNG seeded by the server nonce - no keccak256 needed in the shim.

### MetadataCollector

**Location:** `src/security/MetadataCollector.ts`

Collects session metadata for trajectory replay normalization. 44 lines, no crypto.

```typescript
interface SessionMeta {
  screenW: number;
  screenH: number;
  dpr: number;
  orientation: 'portrait' | 'landscape';
  platform: 'ios' | 'android' | 'web' | 'desktop';
  touchCapable: boolean;
}
```

---

## Security Worker Modules

All modules below run inside the Web Worker thread. Game iframe JavaScript cannot access them.

### Worker Entry

**Location:** `src/worker/index.ts`

Handles `self.onmessage` and dispatches to crypto/sketch modules. Maintains rolling hash state:

```typescript
let sessionId: string;
let rollingHash: string;
let windowIndex: number;
const sketch = new SketchBuilder();
```

### Crypto Module

**Location:** `src/worker/crypto.ts`

All cryptographic operations:

| Function | Input | Output |
|----------|-------|--------|
| `keccak256(message)` | string | `0x`-prefixed hex hash |
| `keccak256Bytes(data)` | Uint8Array | `0x`-prefixed hex hash |
| `computeInitialHash(sessionId, screenW, screenH, ts)` | session params | H₀ hash |
| `computeRollingHash(prevHash, nonceW, inputDigest, canvasHash, score)` | window data | H[w] hash |
| `computeFinalHash(sessionId, rollingHash, finalScore)` | session end | final hash |
| `computeInputDigest(events)` | RawEventTuple[] | keccak256 of encoded events |
| `computeCanvasHash(pixels)` | Uint8Array | keccak256 of pixel data |

### Rolling Hash Chain

```
H₀ = keccak256(sessionId | screenW | screenH | ts)
H[w] = keccak256(H[w-1] | nonceW | inputDigest | canvasHash | score)
finalHash = keccak256(sessionId | rollingHash | finalScore)
```

Each window's hash depends on the previous one and a server-issued nonce, preventing:
- Window omission (skipping checkpoints breaks the chain)
- Replay attacks (each nonce is unique)
- Score manipulation (score is bound into the hash)
- Time compression (server gates nonce issuance)

### SketchBuilder

**Location:** `src/worker/SketchBuilder.ts`

Builds a 64-byte behavioral fingerprint for bot detection. Ingests raw event tuples.

#### Layout (64 bytes)

| Bytes | Content | Purpose |
|-------|---------|---------|
| 0-7 | Tap interval histogram | Detect robotic timing |
| 8-15 | Touch zone distribution (4x2 grid) | Detect unrealistic patterns |
| 16-23 | Velocity histogram (between taps) | Detect inhuman movement speed |
| 24-47 | Reserved | Future use |
| 48-55 | Entropy measures | Statistical randomness |
| 56-63 | Metadata (counts) | Volume metrics |

Reset after each checkpoint window to ensure per-window behavioral analysis.

### Worker Message Types

**Location:** `src/worker/types.ts`

Defines the contract between GameBox main thread and Worker thread.

---

## Backward Compatibility (v1.0.0 API)

Games written for the original `digitap-sdk-1.0.0.js` work unchanged. The SDK exposes a global `_digitapUser` object that forwards to the modern SDK internally.

### Legacy API vs Modern API

| Legacy API (v1.0.0) | Modern API (v2+) |
|---------------------|------------------|
| `_digitapUser.init(uiOptions)` | `digitapSDK('init', hasScore, hasHighScore)` |
| `_digitapUser._afterStartGame = fn` | `digitapSDK('setCallback', 'afterStartGame', fn)` |
| `_digitapUser.progress.score = 100; _digitapUser.sendData()` | `digitapSDK('setProgress', 'PLAYING', 100, 1)` |

### Legacy `_digitapUser` Object

```typescript
_digitapUser = {
  gameObject: any,
  isLoaded: boolean,
  origin: string | null,
  allowedOrigins: string[],
  progress: { controller, type, score, state, continueScore, level },
  extra: { multiplier: 1 },
  sendData(gameObject?): void,
  init(uiOptions?): void,
  _afterStartGameFromZero(): void,
  _afterContinueWithCurrentScore(): void,
  _afterStartGame(): void,
}
```

Both APIs can coexist. The SDK handles routing internally.

---

## Checkpoint Protocol

### What Gets Collected (SDK Shim → GameBox)

| Data | Format | Size | Source |
|------|--------|------|--------|
| `events` | `RawEventTuple[]` | ~16 bytes/event | InputCapture |
| `pixels` | `Uint8Array` | 128 bytes (8 points x 16 bytes) | CanvasHandler |
| `screenW`, `screenH` | numbers | 8 bytes | window.innerWidth/Height |

### What Gets Computed (Security Worker)

| Data | Hash | Source |
|------|------|--------|
| `inputDigest` | keccak256(events encoded as float32 array) | crypto.ts |
| `canvasHash` | keccak256(raw pixel bytes) | crypto.ts |
| `rollingHash` | keccak256(prevHash \| nonceW \| inputDigest \| canvasHash \| score) | crypto.ts |
| `sketch` | 64-byte hex fingerprint | SketchBuilder |

### Full Checkpoint Flow

```
GameBox                    SDK Shim                   Security Worker
   │                          │                             │
   │── CHECKPOINT_REQUEST ──>│                             │
   │   { seed, skipCanvas }   │                             │
   │                          │ flush events + sample       │
   │<── CHECKPOINT_RESPONSE ──│ canvas                      │
   │   { events, pixels,      │                             │
   │     screenW, screenH }   │                             │
   │                          │                             │
   │── PROCESS_CHECKPOINT ──────────────────────────────-->│
   │   { events, pixels, nonceW, score, windowIndex }      │
   │                          │                             │
   │                          │              keccak256(...)  │
   │                          │              build sketch    │
   │                          │              update chain    │
   │                          │                             │
   │<── CHECKPOINT_RESULT ─────────────────────────────────│
   │   { inputDigest, canvasHash, rollingHash, sketch }    │
   │                          │                             │
   │── DPoP sign + POST /checkpoint → Backend              │
```

---

## Security Model

### Layered Defense

| Layer | Location | What It Does |
|-------|----------|-------------|
| **Input capture** | SDK Shim (iframe) | Records all touch/mouse events passively |
| **Canvas sampling** | SDK Shim (iframe) | Reads raw pixels at server-seeded points |
| **Rolling hash chain** | Security Worker | Cryptographic chain linking all windows |
| **Behavioral fingerprint** | Security Worker | 64-byte sketch detects bot patterns |
| **Server-paced nonces** | Backend | Time oracle prevents burst generation |
| **DPoP signatures** | GameBox | Device-bound checkpoint authentication |
| **Worker wallet signature** | GameBox | Final score claim signed by device key |
| **Rate limiting** | Backend | Max ticks/second, score deltas |

### Why the Worker Architecture Is Secure

| Attack | Main-Thread SDK (old) | Worker Architecture (new) |
|--------|:--------------------:|:-------------------------:|
| Override security functions in console | Trivial | Impossible (Worker is separate context) |
| Intercept postMessage between shim ↔ GameBox | Possible but raw data only | Raw data only - hashes computed in Worker |
| Fake checkpoint responses | Send any hash values | Can't compute valid rolling hash chain without Worker state |
| Forge signatures | If keys accessible | Keys in GameBox IndexedDB, never enter iframe |

### Anti-Tampering

1. **Domain Locking**: SDK shim locked to `*.wam.app` / `*.digitap.eu` (obfuscator enforced)
2. **Origin Validation**: Messages only accepted from whitelisted origins
3. **Source Validation**: Messages only accepted from `window.parent`
4. **Console Stripping**: All `console.*` calls removed in production
5. **Thread Isolation**: Crypto in Worker - unreachable from game JS context

---

## Build System

### Commands

```bash
npm run dev    # Development build (source maps, logging, no obfuscation)
npm run build  # Production build (minified, obfuscated, stripped)
```

### Production Output

Both artifacts are built in parallel:

| Config | Entry | Output | Target | Obfuscator |
|--------|-------|--------|--------|------------|
| `sdk` | `src/index.ts` | `dist/main.min.4.js` | browser | Yes (domain locked) |
| `worker` | `src/worker/index.ts` | `dist/security-worker.min.js` | webworker | No |

### Terser Options (Both)

```javascript
{
  mangle: { toplevel: true, properties: { regex: /^_/ } },
  compress: {
    drop_console: true,
    drop_debugger: true,
    passes: 3,
    toplevel: true,
  }
}
```

### SDK Shim Obfuscation (Production Only)

- String array encoding (base64)
- Hexadecimal identifier names
- Domain lock to WAM origins
- Console output disabled
- No control flow flattening (size vs. security tradeoff)

### Dependencies

| Package | Used By | Purpose |
|---------|---------|---------|
| `@noble/hashes` | Worker only | keccak256 (Ethereum-compatible) |
| `terser-webpack-plugin` | Build | Minification |
| `webpack-obfuscator` | SDK build only | Obfuscation + domain lock |

---

## Data Structures

### Worker Inbound Messages

```typescript
interface WorkerInitSession {
  type: 'INIT_SESSION';
  sessionId: string;
  screenW: number;
  screenH: number;
  ts: number;
}

interface WorkerProcessCheckpoint {
  type: 'PROCESS_CHECKPOINT';
  windowIndex: number;
  nonceW: string;
  score: number;
  events: RawEventTuple[];
  pixels: Uint8Array | null;
  screenW: number;
  screenH: number;
}

interface WorkerComputeFinalHash {
  type: 'COMPUTE_FINAL_HASH';
  sessionId: string;
  finalScore: number;
}
```

### Worker Outbound Messages

```typescript
interface WorkerSessionReady {
  type: 'SESSION_READY';
  initialHash: string;
}

interface WorkerCheckpointResult {
  type: 'CHECKPOINT_RESULT';
  windowIndex: number;
  inputDigest: string;
  canvasHash: string;
  rollingHash: string;
  sketch: string;
  eventCount: number;
}

interface WorkerFinalHashResult {
  type: 'FINAL_HASH_RESULT';
  finalHash: string;
  rollingHash: string;
  totalWindows: number;
}
```

### GameBox Integration Example

```typescript
// GameBox spawns the worker
const securityWorker = new Worker('/sdk/security-worker.min.js');

// Initialize session
securityWorker.postMessage({
  type: 'INIT_SESSION',
  sessionId: 'abc-123',
  screenW: screen.width,
  screenH: screen.height,
  ts: Date.now()
});

// Handle worker results
securityWorker.onmessage = (e) => {
  switch (e.data.type) {
    case 'SESSION_READY':
      console.log('Initial hash:', e.data.initialHash);
      break;

    case 'CHECKPOINT_RESULT':
      // Sign with DPoP key and send to backend
      sendToBackend({
        windowIndex: e.data.windowIndex,
        inputDigest: e.data.inputDigest,
        canvasHash: e.data.canvasHash,
        rollingHash: e.data.rollingHash,
        sketch: e.data.sketch,
      });
      break;

    case 'FINAL_HASH_RESULT':
      // Sign with worker wallet and submit final score
      submitFinalScore({
        finalHash: e.data.finalHash,
        rollingHash: e.data.rollingHash,
        totalWindows: e.data.totalWindows,
      });
      break;
  }
};

// Every 5 seconds: get raw data from SDK, send to worker
function onCheckpointTick(rawData: SDKCheckpointResponse, nonceW: string, score: number) {
  securityWorker.postMessage({
    type: 'PROCESS_CHECKPOINT',
    windowIndex: currentWindow,
    nonceW,
    score,
    events: rawData.events,
    pixels: rawData.pixels,
    screenW: rawData.screenW,
    screenH: rawData.screenH,
  });
}
```

---

## File Structure

```
sdk/
├── src/
│   ├── index.ts                  # Main SDK entry point (public API + legacy compat)
│   ├── streamer.ts               # WebRTC streaming (unchanged)
│   ├── types/
│   │   └── index.ts              # SDK ↔ GameBox protocol types
│   ├── security/                 # SDK SHIM (runs in game iframe, NO CRYPTO)
│   │   ├── index.ts              # Module exports
│   │   ├── SecurityBridge.ts     # Thin postMessage coordinator
│   │   ├── InputCapture.ts       # Raw event capture ({t,x,y,e} tuples)
│   │   ├── CanvasHandler.ts      # Raw pixel reader + watermark writer
│   │   ├── MetadataCollector.ts  # Device/screen metadata
│   │   └── logger.ts             # Dev-only logging (stripped in prod)
│   └── worker/                   # SECURITY WORKER (runs in GameBox thread, ALL CRYPTO)
│       ├── index.ts              # Worker entry point (self.onmessage)
│       ├── crypto.ts             # keccak256, rolling hash, digests
│       ├── SketchBuilder.ts      # 64-byte behavioral fingerprint
│       └── types.ts              # Worker message protocol types
├── dist/
│   ├── main.min.4.js             # SDK shim (obfuscated, domain-locked)
│   └── security-worker.min.js    # Security worker (minified, no domain lock)
├── docs/
│   └── ARCHITECTURE.md           # This document
├── webpack.config.js             # Dual-entry build config
├── tsconfig.json
└── package.json
```

---

## Version History

| Version | Changes |
|---------|---------|
| 4.0.0 | **Worker refactor**: Split into SDK shim + Security Worker. All crypto moved to Web Worker thread. Zero crypto in iframe. Rolling hash, input digest, canvas hash re-enabled (off main thread). Two build artifacts. |
| 3.4.0 | Performance release: Disabled all client-side hashing for mobile performance. Added death grace period. Removed move event capture. |
| 3.3.0 | WebGL canvas support, StateHash throttling, player death flow fix, SketchBuilder per-checkpoint reset |
| 3.2.0 | Connection retry mechanism (10 retries, 500ms interval) |
| 3.1.0 | Backward compatibility layer for `_digitapUser` (v1.0.0 API) |
| 3.0.0 | Added keccak256, rolling hash chain, checkpoint protocol |
| 2.0.0 | Added SecurityBridge, behavioral fingerprinting, canvas verification |
| 1.0.0 | Original game SDK with `_digitapUser` global |

---

*Last updated: February 2026*
