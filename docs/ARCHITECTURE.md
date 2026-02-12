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
4. **Data Collection** - Raw events and metadata for server-side validation
5. **Streaming Support** - WebRTC streaming for tournament spectating

### Design Principles

- **Non-intrusive**: SDK must never crash or interfere with game functionality
- **Passive capture**: All security modules operate in the background
- **Silent failures**: Errors are caught and logged, never thrown
- **Strict message filtering**: Only accept messages from `window.parent` (GameBox)
- **Performance first**: No client-side hashing - backend validates raw data

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
| `SDK_CONTINUE_WITH_CURRENT_SCORE` | `continueWithCurrentScore` | Continue after death (revive) | - |

> **Backward Compatibility:** The SDK accepts both NEW (`SDK_*`) and OLD (camelCase) message types for compatibility with older GameBox versions.

### Player Death & Revive Flow

When a player dies, the SDK does **NOT** auto-reset. It waits for GameBox to decide:

```
Game calls: setPlayerFailed('FAIL')
        │
        ├── SDK captures score before setting to 0
        ├── Sets: continueScore = scoreAtDeath, score = 0
        ├── Sets: _deathTimestamp = Date.now()  ← Grace period starts
        ├── Sends SDK_PLAYER_FAILED to GameBox
        │
        └── GameBox sends SDK_PAUSE_GAME
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       │
   Within 500ms?                │
        │                       │
   YES: Delay pause             NO: Pause immediately
        │                       │
        └───────────┬───────────┘
                    │
        Death animation completes, game paused
                    │
        ┌───────────┴───────────┐
        │                       │
SDK_START_GAME_FROM_ZERO    SDK_CONTINUE_WITH_CURRENT_SCORE
        │                       │
        ├── Cancel pending pause├── Cancel pending pause
        ├── score = 0           ├── score = continueScore (restore)
        ├── level = 0           ├── level preserved
        ├── afterStartGame      └── afterContinueWithCurrentScore()
        │   FromZero()              (game resumes itself in callback)
        └── afterStartGame()
```

#### Death Animation Grace Period

GameBox sends `SDK_PAUSE_GAME` immediately after receiving `SDK_PLAYER_FAILED`, which would freeze the game mid-death-animation. The SDK implements a **500ms grace period**:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `_deathGracePeriodMs` | 500ms | Time for death animation to play |
| `_deathTimestamp` | Set on death | Tracks when death occurred |
| `_pendingPauseTimeout` | setTimeout ID | Allows cancellation on restart/revive |

**Critical:** When restart or revive is received, any pending pause is **cancelled** to prevent race conditions where the delayed pause fires after the game has already restarted.

**Important:** The SDK only calls `afterContinueWithCurrentScore()` on revive - NOT `afterStartGame()`. Games must handle resuming/unpausing inside their `_afterContinueWithCurrentScore` callback. This maintains backward compatibility with legacy games.

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

### StateHash (DISABLED for Performance)

> **Note:** Client-side stateHash computation is **DISABLED** as of v3.4.0 for mobile performance. The SDK returns `'0x0'` for all stateHash values. Server-side validation (rate limits, score deltas, behavioral analysis) provides the actual security.

#### Why Client-Side Hashing Was Removed

| Issue | Impact |
|-------|--------|
| keccak256 computation | 2-5ms per hash blocks main thread |
| Canvas sampling | `getImageData()` causes GPU→CPU sync stalls |
| Mobile WebGL | Severe frame drops on Construct 3 / Phaser games |
| Security theater | Determined attackers can fake all client-side crypto |

#### What Actually Provides Security

| Layer | Location | Protection |
|-------|----------|------------|
| Rate limiting | Server (Lua) | Max ticks/second, min intervals |
| Score delta validation | Server (Lua) | Max score increase per tick |
| Monotonic enforcement | Server (Lua) | Score can't decrease |
| Sequence validation | Server (Lua) | No gaps, no replays |
| Behavioral fingerprint | SDK → Server | 64-byte sketch detects bots |
| Session binding | Server | Auth session must match |

#### Current Flow

```
1. Game calls: digitapSDK('setProgress', state, score, level)
2. SDK sends: SDK_PLAYER_SCORE_UPDATE { score, stateHash: '0x0', ... }
3. Server validates via Lua script (rate limits, deltas, sequences)
4. Behavioral sketch analyzed for bot patterns
```

---

### InputCapture

**Location:** `src/security/InputCapture.ts`

Passively captures all user input events (touch, mouse) without interfering with game functionality.

#### Features

| Feature | Value | Purpose |
|---------|-------|---------|
| `_MAX_BUFFER_SIZE` | 5,000 events | Prevent unbounded memory growth |
| Event cleanup | `removeEventListener` on `stop()` | Prevent memory leaks |
| No move events | `touchmove`/`mousemove` disabled | Reduce event volume on mobile |

#### Output

Events are returned raw - **no client-side hashing** for performance:

```typescript
flush(): { events: InputEvent[]; digest: string } {
  const events = this._normalize(this._buffer);
  this._buffer = [];
  return { events, digest: '0x0' }; // Backend computes hash if needed
}
```

---

### CanvasHandler

**Location:** `src/security/CanvasHandler.ts`

Handles canvas operations for game state verification and watermarking.

#### 2D vs WebGL Canvas Support

The SDK automatically detects canvas type and uses the appropriate sampling method:

| Canvas Type | Detection | Sampling Method |
|-------------|-----------|-----------------|
| 2D Canvas | `getContext('2d')` returns context | Direct `getImageData()` |
| WebGL Canvas | `getContext('webgl'/'webgl2')` | Snapshot to offscreen 2D canvas |

```typescript
// For WebGL canvases (e.g., Construct 3, Phaser with WebGL):
if (this._isWebGL && this._samplerCanvas && this._samplerCtx) {
  // Draw WebGL canvas to 2D canvas, then sample
  this._samplerCtx.drawImage(this._canvas, 0, 0);
  return this._samplerCtx;
}
```

> **Note:** Canvas watermarking (embed/extract) only works on 2D canvases. WebGL canvases don't support embedding.

#### Canvas Sampling

Uses **keccak256** for deterministic point selection and hash generation:

```typescript
sample(seed: string): CanvasSampleResult {
  const canvasHash = keccak256Bytes(samples);
  // ...
}
```

---

### SketchBuilder

**Location:** `src/security/SketchBuilder.ts`

Builds a 64-byte behavioral fingerprint for bot detection from user input patterns.

#### Sketch Layout (64 bytes)

| Bytes | Content | Purpose |
|-------|---------|---------|
| 0-7 | Tap interval histogram | Detect robotic timing |
| 8-15 | Touch zone distribution | Detect unrealistic patterns |
| 16-23 | Velocity histogram | Detect inhuman movement |
| 24-47 | Reserved | Future use |
| 48-55 | Entropy measures | Statistical randomness |
| 56-63 | Metadata (event counts) | Volume metrics |

#### Per-Checkpoint Reset

**Critical:** The SketchBuilder is **reset after each checkpoint** to ensure each window's sketch represents only that window's behavior:

```typescript
// In _handleCheckpointRequest():
const sketch = this._sketchBuilder.build();
this._sketchBuilder.reset(); // Reset for next window
```

Without this reset, sketches would accumulate events from all previous windows, making them useless for detecting anomalies in specific time periods.

#### Velocity Sanity Checks

Velocity calculations include sanity checks to prevent Infinity/NaN:

```typescript
// Only record if dt > 1ms (avoid division by near-zero)
if (dt > 1) {
  const velocity = Math.sqrt(dx * dx + dy * dy) / dt;
  // Cap at reasonable max (10000 px/ms is absurd)
  if (isFinite(velocity) && velocity < 10000) {
    this._velocities.push(velocity);
  }
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
| **Input Capture** | All touch/mouse events recorded for server analysis |
| **Behavioral Fingerprint** | 64-byte sketch for anti-bot detection |
| **Server Validation** | Rate limits, score deltas, sequence checks |

> **Note:** Client-side hashing (stateHash, rolling hash) is disabled for performance. Security comes from server-side validation.

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

### Client-Side Hashing: DISABLED

> **As of v3.4.0:** All client-side keccak256 hashing is **disabled** for performance. The SDK sends raw data and the backend computes hashes if needed.

| What | Before (v3.3) | Now (v3.4+) |
|------|---------------|-------------|
| `inputDigest` | keccak256(events) | `'0x0'` |
| `canvasHash` | keccak256(samples) | `'0x0'` (sampling also disabled) |
| `rollingHash` | keccak256(chain) | `'0x0'` |
| `stateHash` | keccak256(all) | `'0x0'` |

### Why This Is OK

Client-side cryptography is **security theater** against determined attackers:
- Attackers who can modify JS can fake all hashes
- Real security comes from server-side validation
- Mobile performance is more important than fake security

### What Remains

The SDK still uses keccak256 for:
- **Initial session hash** (once per session, not during gameplay)
- **Deterministic random** for canvas sampling points (when enabled)

### Hash Functions (Available but Rarely Used)

**Location:** `src/security/utils.ts`

```typescript
// String → 0x-prefixed hash
function keccak256(message: string): string

// Bytes → 0x-prefixed hash
function keccak256Bytes(data: Uint8Array): string
```

### Canonical JSON

Still available for backend use if needed:

```typescript
function canonicalJSON(obj: unknown): string {
  return JSON.stringify(obj, (_, value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        sorted[key] = value[key];
      }
      return sorted;
    }
    return value;
  });
}
```

---

## Checkpoint Protocol

The checkpoint protocol collects security evidence for server-side validation.

> **Note:** As of v3.4.0, client-side hash computation is **disabled** for performance. The SDK sends raw data and the backend can compute hashes if needed.

### What Gets Collected

| Data | Source | Purpose |
|------|--------|---------|
| `events` | InputCapture | Raw input events for replay/analysis |
| `sketch` | SketchBuilder | 64-byte behavioral fingerprint |
| `windowIndex` | Counter | Track checkpoint sequence |
| `inputDigest` | `'0x0'` | Placeholder (backend computes if needed) |
| `canvasHash` | `'0x0'` | Placeholder (sampling disabled by default) |
| `rollingHash` | `'0x0'` | Placeholder (backend computes if needed) |

### Checkpoint Flow (Simplified)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. GameBox → SDK: SDK_SESSION_INIT { sessionId }                        │
│                                                                         │
│ 2. SDK computes initial hash (once per session, OK for performance):    │
│    H₀ = keccak256(sessionId || screenW || screenH || ts)                │
│                                                                         │
│ 3. SDK → GameBox: SDK_SESSION_INIT_ACK { initialHash, meta }            │
└─────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ DURING GAMEPLAY (every N seconds)                                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ 4. GameBox → SDK: SDK_CHECKPOINT_REQUEST { seed, nonceW, score }        │
│                                                                         │
│ 5. SDK collects (FAST - no hashing):                                    │
│    • Flush input events → events[]                                      │
│    • Build behavioral sketch → sketch                                   │
│    • Reset sketch for next window                                       │
│    • Increment windowIndex                                              │
│                                                                         │
│ 6. SDK → GameBox: SDK_CHECKPOINT_RESPONSE {                             │
│      windowIndex,                                                       │
│      inputDigest: '0x0',  // Backend computes                           │
│      events,              // Raw data                                   │
│      canvasHash: '0x0',   // Sampling disabled                          │
│      sample: '',          // Empty                                      │
│      rollingHash: '0x0',  // Backend computes                           │
│      sketch               // Behavioral fingerprint                     │
│    }                                                                    │
│                                                                         │
│ 7. Backend validates events, sketch, computes hashes if needed          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Backend Can Reconstruct Hashes

If the backend needs to verify hash chains, it has all the raw data:

```typescript
// Backend (Node.js/TypeScript)
import { keccak256 } from 'ethers';

const inputDigest = keccak256(JSON.stringify(events));
const rollingHash = keccak256(
  `${prevHash}|${nonceW}|${inputDigest}|${canvasHash}|${score}`
);
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
3. **Canvas Fingerprinting**: Samples game state at random points (when enabled)
4. **Canvas Watermarking**: LSB steganography proves live gameplay (when enabled)

### Server-Side Validation (PRIMARY)

> **This is where real security happens.** Client-side crypto is disabled for performance.

1. **Rate Limiting**: Max ticks per second, sliding window
2. **Score Delta Validation**: Max score increase per tick
3. **Monotonic Enforcement**: Score can never decrease
4. **Sequence Validation**: No gaps, no replays, strict ordering
5. **Session Binding**: Auth session must match game session
6. **Behavioral Analysis**: Server analyzes sketch for bot patterns

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
  inputDigest: string;      // Always '0x0' (backend computes if needed)
  events: InputEvent[];     // Actual input events (raw data)
  canvasHash: string;       // Always '0x0' (sampling disabled)
  sample: string;           // Empty string
  rollingHash: string;      // Always '0x0' (backend computes if needed)
  sketch: string;           // 64-byte behavioral fingerprint
}
```

### Input Event Pipeline

```
DOM Event (touchstart, touchend, mousedown, mouseup, keydown, keyup)
    │
    ▼
RawInputEvent (internal)
{
  type: 'touchstart' | 'mousedown' | ...
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
Sent to backend as raw array (no client-side hashing)
```

> **Note:** `touchmove` and `mousemove` events are NOT captured to reduce event volume on mobile.

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
| 3.4.0 | **Performance release**: Disabled all client-side hashing (inputDigest, rollingHash, stateHash return '0x0'). Added death animation grace period (500ms). Added pending pause cancellation on restart/revive. Removed touchmove/mousemove capture. Reduced InputCapture buffer to 5000. |
| 3.3.0 | WebGL canvas support (Construct 3), StateHash throttling (500ms), player death flow fix (no auto-reset), revive fix (afterStartGame called), SketchBuilder per-checkpoint reset, InputCapture memory leak fix, canonicalJSON recursive sort |
| 3.2.0 | Added connection retry mechanism (10 retries, 500ms interval, 5s timeout) |
| 3.1.0 | Added backward compatibility layer for `_digitapUser` (v1.0.0 API), dual protocol support |
| 3.0.0 | Added keccak256, rolling hash chain, checkpoint protocol |
| 2.0.0 | Added SecurityBridge module, behavioral fingerprinting, canvas verification |
| 1.0.0 | Original game SDK with `_digitapUser` global and basic score reporting |

### Compatibility Matrix

| SDK Version | `_digitapUser` API | `digitapSDK()` API | Security Model |
|-------------|--------------------|--------------------|----------------|
| 1.0.0 | ✅ Native | ❌ | Basic |
| 2.0.0 | ❌ | ✅ Native | Input + Canvas |
| 3.0.0 | ❌ | ✅ Native | Client-side hashing |
| 3.1.0+ | ✅ Shim | ✅ Native | Client-side hashing |
| 3.4.0+ | ✅ Shim | ✅ Native | **Server-side validation** (no client hashing) |

### v3.4.0 Breaking Changes

The following fields now always return `'0x0'`:
- `inputDigest` in checkpoint responses
- `canvasHash` in checkpoint responses  
- `rollingHash` in checkpoint responses
- `stateHash` in score updates

**Backend impact:** If your backend validates these hashes, you need to either:
1. Compute the hashes server-side from raw data (events, canvas samples)
2. Skip hash validation entirely and rely on rate limiting + behavioral analysis

---

*Last updated: February 2026*
