# WAM Game Player SDK - Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Communication Protocol](#communication-protocol)
4. [Module Reference](#module-reference)
5. [Backward Compatibility (v1.0.0 API)](#backward-compatibility-v100-api)
6. [Cryptographic Design](#cryptographic-design)
7. [Checkpoint Protocol](#checkpoint-protocol)
8. [Security Features](#security-features)
9. [Build System](#build-system)
10. [Data Structures](#data-structures)

---

## Overview

The WAM Game Player SDK is a JavaScript/TypeScript library that integrates HTML5 games with the WAM gaming platform. It runs inside an iframe containing the game and communicates with the parent GameBox container via the `postMessage` API.

### Key Responsibilities

1. **Game Integration** - Bridge between HTML5 games and the WAM platform
2. **Score Reporting** - Send game progress, scores, and level changes to GameBox
3. **Security Module** - Anti-cheat measures including input capture, canvas fingerprinting, and behavioral analysis
4. **Cryptographic Integrity** - keccak256 hashing and rolling hash chains for tamper detection
5. **Streaming Support** - WebRTC streaming for tournament spectating

### Design Principles

- **Non-intrusive**: SDK must never crash or interfere with game functionality
- **Passive capture**: All security modules operate in the background
- **Silent failures**: Errors are caught and logged, never thrown
- **Strict message filtering**: Only accept messages from `window.parent` (GameBox)
- **Ethereum compatibility**: All hashes use keccak256 for backend verification

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              GAMEBOX (Parent)                            │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────────┐   │
│  │ useGameSession  │    │ Game Lifecycle  │    │ WebSocket Server    │   │
│  │ (composable)    │    │ Management      │    │ (score relay)       │   │
│  └────────┬────────┘    └────────┬────────┘    └──────────┬──────────┘   │
│           │                      │                        │              │
│           └──────────────────────┼────────────────────────┘              │
│                                  │                                       │
│                          postMessage API                                 │
│                                  │                                       │
└──────────────────────────────────┼───────────────────────────────────────┘
                                   │
                    ╔══════════════╧══════════════╗
                    ║     SDK (in iframe)         ║
                    ╠═════════════════════════════╣
                    ║  ┌───────────────────────┐  ║
                    ║  │  DigitapGamePlayerSDK │  ║
                    ║  │  - processQueue()     │  ║
                    ║  │  - init()             │  ║
                    ║  │  - setProgress()      │  ║
                    ║  │  - setLevelUp()       │  ║
                    ║  │  - setPlayerFailed()  │  ║
                    ║  └───────────┬───────────┘  ║
                    ║              │              ║
                    ║  ┌───────────┴───────────┐  ║
                    ║  │    SecurityBridge     │  ║
                    ║  │  ┌─────────────────┐  │  ║
                    ║  │  │  InputCapture   │  │  ║
                    ║  │  │  CanvasHandler  │  │  ║
                    ║  │  │  SketchBuilder  │  │  ║
                    ║  │  │  MetadataCollect│  │  ║
                    ║  │  │  RollingHash    │  │  ║
                    ║  │  └─────────────────┘  │  ║
                    ║  └───────────────────────┘  ║
                    ╚═════════════════════════════╝
                                   │
                    ┌──────────────┴──────────────┐
                    │      HTML5 GAME             │
                    │   (canvas, game logic)      │
                    └─────────────────────────────┘
```

### Initialization Sequence

```
1. Browser loads iframe with game + SDK script
                    │
2. SDK script executes immediately
   ├── Attach global message listener
   ├── Initialize SecurityBridge
   │   ├── Start InputCapture (event listeners)
   │   ├── Start CanvasHandler (canvas polling)
   │   └── Send SDK_SECURITY_READY beacon
   │
   └── Start Connection Handshake (with retry)
       ├── Send SDK_LOADED beacon to parent
       └── Retry every 500ms (max 10 attempts)
                    │
3. GameBox receives SDK_LOADED / SDK_SECURITY_READY
   └── Send SDK_SESSION_INIT with sessionId
                    │
4. SDK receives SDK_SESSION_INIT
   ├── Compute H₀ = keccak256(sessionId || screenW || screenH || ts)
   ├── Send SDK_SESSION_INIT_ACK with initialHash, meta
   ├── Set _isConnected = true
   └── Clear retry interval
                    │
5. Game code calls digitapSDK('init', ...)
   ├── Send SDK_SETTINGS to parent
   └── GameBox ready to request checkpoints
```

### Connection Retry Mechanism

The SDK implements a retry mechanism to handle race conditions where the SDK loads before GameBox is ready:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `_MAX_INIT_RETRIES` | 10 | Maximum connection attempts |
| `_INIT_RETRY_DELAY_MS` | 500ms | Delay between retries |
| **Total timeout** | 5 seconds | After which SDK continues without session |

```
SDK_LOADED beacon sent
        │
        ├─► GameBox responds with SDK_SESSION_INIT
        │       └─► _isConnected = true, stop retrying
        │
        └─► No response after 500ms
                └─► Retry (up to 10 times)
                        └─► After 10 fails: warn & continue
```

The SDK remains functional even if GameBox doesn't respond - score reporting and callbacks still work, but security checkpoints won't be available until a session is established.

---

## Communication Protocol

### Controllers

The SDK uses **controllers** to namespace message channels:

| Controller | Direction | Purpose |
|------------|-----------|---------|
| `_digitapGame` | SDK → GameBox | Game state messages (scores, levels, progress) |
| `_digitapApp` | GameBox → SDK | Game commands (start, pause, continue) |
| `_digitapSecurity` | Bidirectional | Security module requests/responses + checkpoints |

### Message Structure

All messages follow this base structure:

```typescript
{
  controller: '_digitapGame' | '_digitapApp' | '_digitapSecurity',
  type: string,       // Message type identifier
  ts?: number,        // Optional timestamp
  ...payload          // Additional fields (flat, not nested)
}
```

### Message Flow Diagram

```
GameBox                                        SDK
   │                                            │
   │──────── SDK_SESSION_INIT ─────────────────>│ (initialize rolling hash)
   │<──────── SDK_SESSION_INIT_ACK ─────────────│ (initialHash, meta)
   │                                            │
   │──────── SDK_START_GAME ───────────────────>│ (controller: _digitapApp)
   │                                            │
   │<──────── SDK_PLAYER_SCORE_UPDATE ─────────>│ (controller: _digitapGame)
   │                                            │
   │──────── SDK_CHECKPOINT_REQUEST ───────────>│ (seed, nonceW, score)
   │<──────── SDK_CHECKPOINT_RESPONSE ──────────│ (inputDigest, canvasHash, rollingHash)
   │──────── SDK_CHECKPOINT_ACK ───────────────>│ (nonceW for next window)
   │                                            │
```

### Game Protocol Messages

#### SDK → GameBox (`_digitapGame`)

| Type (v2+) | Legacy Type (v1.0.0) | Description | Payload |
|------------|----------------------|-------------|---------|
| `SDK_SETTINGS` | `settings` | SDK initialized | `{ ui: [...], ready: true }` |
| `SDK_PLAYER_SCORE_UPDATE` | `progress` | Score changed | `{ state, score, level, continueScore, stateHash }` |
| `SDK_PLAYER_LEVEL_UP` | - | Level increased | `{ level, stateHash }` |
| `SDK_PLAYER_FAILED` | - | Player died/failed | `{ state, score: 0, stateHash, continueScore }` |
| `SDK_LOADED` | - | Script loaded (beacon) | `{ ts }` |

> **Note:** When using the legacy `_digitapUser` API, both NEW and OLD message types are sent for maximum compatibility.

#### GameBox → SDK (`_digitapApp`)

| Type (v2+) | Legacy Type (v1.0.0) | Description | Payload |
|------------|----------------------|-------------|---------|
| `SDK_START_GAME` | `startGame` | Start game | - |
| `SDK_PAUSE_GAME` | - | Pause game | - |
| `SDK_START_GAME_FROM_ZERO` | `startGameFromZero` | Restart from zero | - |
| `SDK_CONTINUE_WITH_CURRENT_SCORE` | `continueWithCurrentScore` | Continue after death | - |

> **Backward Compatibility:** The SDK accepts both NEW (`SDK_*`) and OLD (camelCase) message types for compatibility with older GameBox versions.

### Security Protocol Messages

#### Session & Checkpoint Protocol

| Type | Direction | Description | Payload |
|------|-----------|-------------|---------|
| `SDK_SECURITY_READY` | SDK → GB | Security module ready | `{ ts }` |
| `SDK_SESSION_INIT` | GB → SDK | Initialize session | `{ sessionId }` |
| `SDK_SESSION_INIT_ACK` | SDK → GB | Confirm with initial hash | `{ sessionId, initialHash, meta }` |
| `SDK_CHECKPOINT_REQUEST` | GB → SDK | Request security data | `{ seed, nonceW, score }` |
| `SDK_CHECKPOINT_RESPONSE` | SDK → GB | Return all security data | `{ windowIndex, inputDigest, events, canvasHash, sample, rollingHash, sketch }` |
| `SDK_CHECKPOINT_ACK` | GB → SDK | Acknowledge checkpoint | `{ windowIndex, nonceW }` |

#### Basic Security Messages

| Type | Direction | Description | Payload |
|------|-----------|-------------|---------|
| `SDK_INPUT_EVENTS_REQUEST` | GB → SDK | Request input events | - |
| `SDK_INPUT_EVENTS_RESPONSE` | SDK → GB | Input events + digest | `{ events, digest }` |
| `SDK_INPUT_SKETCH_REQUEST` | GB → SDK | Request behavioral fingerprint | - |
| `SDK_INPUT_SKETCH_RESPONSE` | SDK → GB | 64-byte sketch | `{ sketch }` |
| `SDK_CANVAS_SAMPLE_REQUEST` | GB → SDK | Request canvas sample | `{ seed }` |
| `SDK_CANVAS_SAMPLE_RESPONSE` | SDK → GB | Canvas hash + sample | `{ canvasHash, sample }` |
| `SDK_CANVAS_EMBED_REQUEST` | GB → SDK | Embed watermark | `{ data }` |
| `SDK_CANVAS_EMBED_RESPONSE` | SDK → GB | Embed result | `{ success }` |
| `SDK_META_REQUEST` | GB → SDK | Request metadata | - |
| `SDK_META_RESPONSE` | SDK → GB | Session metadata | `{ meta }` |

### Message Filtering

The SDK implements **strict message filtering** to prevent processing messages from browser extensions (e.g., MetaMask), other iframes, or malicious scripts:

```typescript
// Filter 1: Source must be parent window (GameBox)
if (event.source !== window.parent) return;

// Filter 2: Must have valid structure
if (!data || typeof data !== 'object') return;

// Filter 3: Must have known controller
if (controller !== '_digitapApp' && controller !== '_digitapSecurity') return;

// Filter 4: Must have valid message type (whitelist)
if (!validTypes.includes(data.type)) return;

// Filter 5: Origin validation
if (!allowedOrigins.includes(event.origin)) return;
```

#### Allowed Origins

The SDK accepts messages from these whitelisted origins:

```typescript
// Production
'https://wam.app'
'https://app.wam.app'
'https://wam.eu'
'https://win.wam.app'
'https://play.wam.app'
```

---

## Module Reference

### DigitapGamePlayerSDK

**Location:** `src/index.ts`

The main SDK class that provides the public API for game developers.

#### Public API (Frozen)

```typescript
// Initialize SDK
digitapSDK('init', hasScore?: boolean, hasHighScore?: boolean)

// Register callbacks for game commands
digitapSDK('setCallback', fn: CallbackName, callback: Function)

// Report score/progress
digitapSDK('setProgress', state: string, score: number, level: number)

// Report level up
digitapSDK('setLevelUp', level: number)

// Report player failure/death
digitapSDK('setPlayerFailed', state?: string)
```

---

### SecurityBridge

**Location:** `src/security/SecurityBridge.ts`

The coordinator module that handles all security-related communication with GameBox.

#### Responsibilities

- Listen for security requests from parent
- Dispatch requests to appropriate modules
- Format and send responses
- Origin validation
- **Rolling hash state management**

---

### StateHash (Score Integrity)

Every score update includes a `stateHash` that cryptographically ties the score to the game state:

```typescript
stateHash = keccak256(inputDigest | canvasHash | metaFingerprint | score | timestamp)
```

#### What StateHash Proves

| Component | Source | Evidence |
|-----------|--------|----------|
| `inputDigest` | `InputCapture.flush()` | User interactions that led to this score |
| `canvasHash` | `CanvasHandler.sample()` | Visual game state at score moment |
| `metaFingerprint` | `MetadataCollector.collect()` | Device/environment (screen, platform) |
| `score` | Function parameter | The score value itself |
| `timestamp` | `Date.now()` | When this score was reported |

#### MetaFingerprint Components

The `metaFingerprint` is derived from `SessionMeta`:

```typescript
metaFingerprint = keccak256(screenW | screenH | dpr | platform | touchCapable)
```

| Field | Purpose |
|-------|---------|
| `screenW/H` | Detect screen resolution changes |
| `dpr` | Device pixel ratio (detects emulators) |
| `platform` | iOS/Android/Web/Desktop |
| `touchCapable` | Detect bots pretending to be touch devices |

**Note:** Orientation is NOT included because it can change during gameplay.

#### Flow

```
1. Game calls: digitapSDK('setProgress', state, score, level)
2. SDK computes: stateHash = securityBridge.computeStateHash(score)
   ├── Flush input events → inputDigest
   ├── Sample canvas → canvasHash
   ├── Collect metadata → metaFingerprint
   └── Hash all together
3. SDK sends: SDK_PLAYER_SCORE_UPDATE { score, stateHash, ... }
4. GameBox receives and includes stateHash in WebSocket message
5. Backend can verify stateHash matches expected values
```

---

### InputCapture

**Location:** `src/security/InputCapture.ts`

Passively captures all user input events (touch, mouse) without interfering with game functionality.

#### Digest Generation

Events are serialized to canonical JSON and hashed with **keccak256** for integrity verification:

```typescript
const digest = keccak256(canonicalJSON(events));
```

---

### CanvasHandler

**Location:** `src/security/CanvasHandler.ts`

Handles canvas operations for game state verification and watermarking.

#### Canvas Sampling

Uses **keccak256** for deterministic point selection and hash generation:

```typescript
sample(seed: string): CanvasSampleResult {
  const canvasHash = keccak256Bytes(samples);
  // ...
}
```

---

## Backward Compatibility (v1.0.0 API)

The SDK provides full backward compatibility with games written for the original `digitap-sdk-1.0.0.js`. Games using the legacy API work unchanged while automatically gaining all v2+ security features.

### Legacy Global: `_digitapUser`

Games written for SDK v1.0.0 use a global `_digitapUser` object with a different API pattern. The SDK exposes this object automatically.

#### Legacy API vs Modern API

| Legacy API (v1.0.0) | Modern API (v2+) | Notes |
|---------------------|------------------|-------|
| `_digitapUser.init(uiOptions)` | `digitapSDK('init', hasScore, hasHighScore)` | Both work |
| `_digitapUser._afterStartGame = fn` | `digitapSDK('setCallback', 'afterStartGame', fn)` | Override vs register |
| `_digitapUser.progress.score = 100` | N/A | Direct property access |
| `_digitapUser.sendData()` | `digitapSDK('setProgress', state, score, level)` | sendData forwards internally |
| `_digitapUser.extra.multiplier` | N/A | Available for legacy games |

#### Legacy `_digitapUser` Object Structure

```typescript
_digitapUser = {
  gameObject: any,              // Game reference (optional)
  isLoaded: boolean,            // SDK initialization state
  origin: string | null,        // Validated origin
  allowedOrigins: string[],     // Whitelisted domains
  progress: {
    controller: '_digitapGame',
    type: 'progress',
    score: number,
    state: string | null,
    continueScore: number,
    level?: number,
  },
  extra: {
    multiplier: number,         // Default: 1
  },
  
  // Methods
  sendData(gameObject?: any): void,
  init(uiOptions?: string[]): void,
  
  // Hookable callbacks (games OVERRIDE these)
  _afterStartGameFromZero(): void,
  _afterContinueWithCurrentScore(): void,
  _afterStartGame(): void,
}
```

### How Legacy Games Work

#### 1. Initialization

```javascript
// Legacy game code (unchanged)
_digitapUser.init(['sound', 'background']);
```

Internally, this:
1. Sends `type: 'settings'` message (OLD protocol)
2. Sends `type: 'SDK_SETTINGS'` message (NEW protocol)
3. Initializes the modern SDK event listeners

#### 2. Callback Registration

```javascript
// Legacy game code (unchanged)
_digitapUser._afterStartGame = function() {
    startMyGame();
};

_digitapUser._afterStartGameFromZero = function() {
    resetMyGame();
    _digitapUser.progress.score = 0;
};

_digitapUser._afterContinueWithCurrentScore = function() {
    continueMyGame(_digitapUser.progress.continueScore);
};
```

When GameBox sends `SDK_START_GAME` (or legacy `startGame`):
1. Modern SDK receives the message
2. Calls `DigitapGamePlayerSDK.afterStartGame()`
3. Which forwards to `_digitapUser._afterStartGame()`

#### 3. Score Reporting

```javascript
// Legacy game code (unchanged)
_digitapUser.progress.score = 100;
_digitapUser.progress.state = 'PLAYING';
_digitapUser.sendData();
```

When `sendData()` is called:
1. Reads `progress.score`, `progress.state`, `progress.level`
2. Calls modern `setProgress()` internally
3. **Computes stateHash** with all security features
4. Sends message to GameBox with cryptographic evidence

### Message Protocol Compatibility

The SDK handles both OLD and NEW message types:

```
GameBox → SDK (both accepted):
├── SDK_START_GAME          ─┬─→ afterStartGame()
└── startGame               ─┘

├── SDK_START_GAME_FROM_ZERO ─┬─→ afterStartGameFromZero()
└── startGameFromZero        ─┘

├── SDK_CONTINUE_WITH_CURRENT_SCORE ─┬─→ afterContinueWithCurrentScore()
└── continueWithCurrentScore         ─┘
```

```
SDK → GameBox (legacy API sends both):
├── type: 'settings'      (OLD)
└── type: 'SDK_SETTINGS'  (NEW)
```

### Security Benefits for Legacy Games

Even when using the legacy `_digitapUser` API, games automatically receive:

| Feature | Description |
|---------|-------------|
| **stateHash** | Every `sendData()` includes cryptographic proof |
| **Input Capture** | All touch/mouse events recorded |
| **Canvas Sampling** | Game state verification |
| **Rolling Hash** | Checkpoint chain integrity |
| **Behavioral Fingerprint** | Anti-bot detection |

### Migration Path

Games can migrate incrementally:

```javascript
// Phase 1: Legacy API (works today)
_digitapUser.init(['sound']);
_digitapUser._afterStartGame = () => startGame();
_digitapUser.progress.score = 100;
_digitapUser.sendData();

// Phase 2: Modern API (recommended for new games)
digitapSDK('init', true, true);
digitapSDK('setCallback', 'afterStartGame', () => startGame());
digitapSDK('setProgress', 'PLAYING', 100, 1);
```

Both APIs can coexist - the SDK handles routing internally.

---

## Cryptographic Design

### Why keccak256?

The SDK uses **keccak256** (via `@noble/hashes`) for all cryptographic operations:

| Aspect | Choice | Rationale |
|--------|--------|-----------|
| Hash algorithm | keccak256 | Ethereum standard - backend uses same |
| Library | @noble/hashes | Audited, pure JS, no WebAssembly |
| Encoding | 0x-prefixed hex | Ethereum convention |
| Verification | Deterministic | Same inputs = same hash on all platforms |

### Hash Functions

**Location:** `src/security/utils.ts`

```typescript
// String → 0x-prefixed hash
function keccak256(message: string): string

// Bytes → 0x-prefixed hash
function keccak256Bytes(data: Uint8Array): string

// Bytes → raw bytes (for chaining)
function keccak256Raw(data: Uint8Array): Uint8Array
```

### Deterministic Random

Used for canvas sampling to ensure GameBox and backend can verify the same points:

```typescript
function deterministicRandom(seed: string, index: number): number {
  const hash = keccak256(seed + index.toString());
  return parseInt(hash.slice(2, 10), 16);
}
```

---

## Checkpoint Protocol

The checkpoint protocol creates a cryptographic chain of security evidence that prevents manipulation.

### Rolling Hash Chain

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Rolling Hash Chain                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  H₀ = keccak256(sessionId || screenW || screenH || ts)                  │
│                              │                                          │
│                              ▼                                          │
│  H₁ = keccak256(H₀ || nonceW₀ || inputDigest₁ || canvasHash₁ || score₁) │
│                              │                                          │
│                              ▼                                          │
│  H₂ = keccak256(H₁ || nonceW₁ || inputDigest₂ || canvasHash₂ || score₂) │
│                              │                                          │
│                              ▼                                          │
│                            ...                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Rolling Hash Formula

```
H[w] = keccak256(H[w-1] | nonceW[w-1] | inputDigest[w] | canvasHash[w] | score[w])
```

Where:
- `H[w-1]` = Previous rolling hash (or initial hash for w=1)
- `nonceW[w-1]` = Server-provided nonce from previous checkpoint ACK
- `inputDigest[w]` = keccak256 of input events in this window
- `canvasHash[w]` = keccak256 of canvas samples
- `score[w]` = Current score

### What This Prevents

| Attack | How Rolling Hash Prevents |
|--------|--------------------------|
| **Window omission** | Skipping a window breaks the chain - H[w+1] won't match |
| **Replay attacks** | Server nonce is unique per window |
| **Score manipulation** | Score is included in hash - tampering detected |
| **Event fabrication** | inputDigest ties events to specific window |
| **Canvas spoofing** | canvasHash verifies game state |

### Checkpoint Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. GameBox → SDK: SDK_SESSION_INIT { sessionId }                        │
│                                                                         │
│ 2. SDK computes initial hash:                                           │
│    H₀ = keccak256(sessionId || screenW || screenH || ts)                │
│                                                                         │
│ 3. SDK → GameBox: SDK_SESSION_INIT_ACK { initialHash, meta }            │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ DURING GAMEPLAY (every N seconds or on score change)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 4. GameBox → SDK: SDK_CHECKPOINT_REQUEST { seed, nonceW, score }        │
│                                                                         │
│ 5. SDK collects:                                                        │
│    • Flush input events → inputDigest                                   │
│    • Sample canvas at seed points → canvasHash                          │
│    • Build behavioral sketch → sketch                                   │
│    • Compute: H[w] = keccak256(H[w-1] || nonceW || ... )                │
│                                                                         │
│ 6. SDK → GameBox: SDK_CHECKPOINT_RESPONSE {                             │
│      windowIndex, inputDigest, events, canvasHash, sample,              │
│      rollingHash, sketch                                                │
│    }                                                                    │
│                                                                         │
│ 7. GameBox → Backend: Forward checkpoint data                           │
│                                                                         │
│ 8. Backend validates and returns new nonceW                             │
│                                                                         │
│ 9. GameBox → SDK: SDK_CHECKPOINT_ACK { windowIndex, nonceW }            │
│    (SDK stores nonceW for next rolling hash)                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Implementation

**Location:** `src/security/utils.ts`

```typescript
/**
 * Compute rolling hash for checkpoint chain.
 */
export function computeRollingHash(
  prevHash: string,
  nonceW: string,
  inputDigest: string,
  canvasHash: string,
  score: number
): string {
  const preimage = [
    prevHash || '0x',
    nonceW,
    inputDigest,
    canvasHash,
    score.toString()
  ].join('|');
  
  return keccak256(preimage);
}
```

---

## Security Features

### Anti-Tampering

1. **Domain Locking**: SDK only runs on allowed domains (enforced by obfuscator)
2. **Origin Validation**: Messages only accepted from whitelisted origins
3. **Source Validation**: Messages only accepted from `window.parent`
4. **Console Disabling**: `disableConsoleOutput: true` in production

### Anti-Bot Measures

1. **Input Capture**: Records all touch/mouse events with timing
2. **Behavioral Fingerprint**: 64-byte sketch detects automation patterns
3. **Canvas Fingerprinting**: Samples game state at random points
4. **Canvas Watermarking**: LSB steganography proves live gameplay

### Integrity Verification

1. **keccak256 Hashing**: Ethereum-compatible hashing throughout
2. **Rolling Hash Chain**: Cryptographic chain prevents window omission
3. **Server Nonces**: Prevents replay attacks
4. **Canonical JSON**: Deterministic serialization for consistent hashes

---

## Build System

### Development Build

```bash
npm run dev
```

- Source maps enabled
- Logging enabled
- No obfuscation
- No minification

### Production Build

```bash
npm run build
```

- No source maps
- Logging stripped
- Full obfuscation
- Aggressive minification

### Dependencies

```json
{
  "@noble/hashes": "^1.x"  // keccak256 implementation
}
```

---

## Data Structures

### Rolling Hash State

Internal state maintained by SecurityBridge:

```typescript
interface RollingHashState {
  sessionId: string;      // Current session ID
  currentHash: string;    // Latest rolling hash H[w]
  windowIndex: number;    // Current window number
  lastNonceW: string;     // Nonce from previous checkpoint ACK
}
```

### Checkpoint Response

```typescript
interface CheckpointResponse {
  controller: '_digitapSecurity';
  type: 'SDK_CHECKPOINT_RESPONSE';
  windowIndex: number;      // Which window this is
  inputDigest: string;      // keccak256 of input events
  events: InputEvent[];     // Actual input events
  canvasHash: string;       // keccak256 of canvas samples
  sample: string;           // Raw canvas samples (hex)
  rollingHash: string;      // H[w] for chain verification
  sketch: string;           // 64-byte behavioral fingerprint
}
```

### Input Event Pipeline

```
DOM Event
    │
    ▼
RawInputEvent (internal)
{
  type: 'touchstart' | 'mousemove' | ...
  x: 523 (pixels)
  y: 301 (pixels)
  ts: 1234567.89 (performance.now)
  dt: 16.7 (ms since last)
  pointerId: 0
}
    │
    ▼
InputEvent (normalized for backend)
{
  type: 'tap' | 'swipe' | 'hold' | 'release'
  x: 0.42 (normalized 0-1)
  y: 0.38 (normalized 0-1)
  dt: 17 (rounded ms)
  pointerId: 0
}
    │
    ▼
digest = keccak256(canonicalJSON(events))
```

---

## File Structure

```
sdk/
├── src/
│   ├── index.ts              # Main SDK entry point
│   ├── types/
│   │   └── index.ts          # TypeScript definitions
│   └── security/
│       ├── index.ts          # Module exports
│       ├── SecurityBridge.ts # Protocol coordinator + rolling hash
│       ├── InputCapture.ts   # Event capture
│       ├── CanvasHandler.ts  # Canvas operations
│       ├── SketchBuilder.ts  # Behavioral fingerprint
│       ├── MetadataCollector.ts # Device info
│       ├── logger.ts         # Dev logging
│       └── utils.ts          # Crypto utilities (keccak256)
├── dist/
│   └── main.min.js           # Production bundle
├── docs/
│   └── ARCHITECTURE.md       # This document
├── webpack.config.js         # Build configuration
├── tsconfig.json             # TypeScript config
└── package.json
```

---

## Security Considerations

### What This SDK Protects Against

1. **Score Manipulation**: Rolling hash chain + input verification
2. **Bot Automation**: Behavioral fingerprints detect non-human patterns
3. **Video Replay Attacks**: Canvas watermarks prove live gameplay
4. **Window Omission**: Breaking the rolling hash chain is detected
5. **Replay Attacks**: Server nonces make each window unique
6. **Domain Spoofing**: Domain locking prevents SDK on unauthorized sites

### What This SDK Does NOT Protect Against

1. **Memory Editing**: Client-side cheats that modify game memory
2. **Modified Game Code**: Altered game logic running in the iframe
3. **Network Interception**: MITM attacks on score submissions

These require server-side validation and are handled by the GameBox/backend.

---

## Version History

| Version | Changes |
|---------|---------|
| 3.2.0 | Added connection retry mechanism (10 retries, 500ms interval, 5s timeout) |
| 3.1.0 | Added backward compatibility layer for `_digitapUser` (v1.0.0 API), dual protocol support |
| 3.0.0 | Added keccak256, rolling hash chain, checkpoint protocol |
| 2.0.0 | Added SecurityBridge module, behavioral fingerprinting, canvas verification |
| 1.0.0 | Original game SDK with `_digitapUser` global and basic score reporting |

### Compatibility Matrix

| SDK Version | `_digitapUser` API | `digitapSDK()` API | Security Features |
|-------------|--------------------|--------------------|-------------------|
| 1.0.0 | ✅ Native | ❌ | Basic |
| 2.0.0 | ❌ | ✅ Native | Input + Canvas |
| 3.0.0 | ❌ | ✅ Native | Full (keccak256, rolling hash) |
| 3.1.0+ | ✅ Shim | ✅ Native | Full (all features) |

---

*Last updated: January 2026*
