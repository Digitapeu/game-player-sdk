# WAM SDK Security Implementation Plan (Final)

**Version:** 1.0  
**Date:** January 14, 2026  
**Status:** Ready for Implementation

---

## Executive Summary

This document consolidates all security specifications into a single, actionable implementation plan for the WAM Game SDK. The implementation produces a **single minified/mangled JavaScript file** (`main.min.js`) that:

1. Maintains **100% backward compatibility** with existing games
2. Adds **internal security modules** that respond to GameBox (parent) requests
3. Provides **risk signals** (input sketch, canvas sampling) for backend validation

### Critical Architecture Principle

```
┌─────────────────────────────────────────────────────────────────────┐
│                    GAME IFRAME (UNTRUSTED)                          │
│                                                                     │
│    ┌─────────────────────────────────────────────────────────────┐  │
│    │              SDK (main.min.js) - THIS PROJECT               │  │
│    │                                                             │  │
│    │   PUBLIC API (UNCHANGED):                                   │  │
│    │   - digitapSDK('init', hasScore, hasHighScore)              │  │
│    │   - digitapSDK('setProgress', state, score, level)          │  │
│    │   - digitapSDK('setLevelUp', level)                         │  │
│    │   - digitapSDK('setPlayerFailed', state)                    │  │
│    │   - digitapSDK('setCallback', fn, callback)                 │  │
│    │                                                             │  │
│    │   INTERNAL SECURITY (NEW):                                  │  │
│    │   - InputCapture → captures user input events               │  │
│    │   - CanvasHandler → samples canvas, embeds watermarks       │  │
│    │   - SketchBuilder → builds 64-byte behavioral fingerprint   │  │
│    │   - MetadataCollector → collects session metadata           │  │
│    │   - SecurityBridge → responds to parent postMessage         │  │
│    └─────────────────────────────────────────────────────────────┘  │
│                                    │                                │
│                          postMessage│                                │
└────────────────────────────────────┼────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│               GAMEBOX (PARENT - win.wam.app) - TRUSTED              │
│                                                                     │
│   - Owns DPoP key (non-extractable CryptoKey)                       │
│   - Computes rolling hash from SDK events                           │
│   - Schedules checkpoints (every 5s DPoP, every 30s Passkey)        │
│   - Signs checkpoint digests with DPoP key                          │
│   - Communicates with backend (start/checkpoint/submit)             │
│   - Requests risk signals from SDK via _digitapSecurity controller  │
└─────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        BACKEND (api.wam.app)                        │
│                                                                     │
│   POST /score/session/start      → Initialize session, get config   │
│   POST /score/session/checkpoint → Time-gated window validation     │
│   POST /score/submit             → Final score with security fields │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Insight:** The SDK runs in an untrusted iframe. All cryptographic operations (DPoP signing, rolling hash computation) happen in the **parent container (GameBox)** which owns the device-bound keys. The SDK merely provides **risk signals** when requested.

---

## 1. Public API (FROZEN - DO NOT CHANGE)

```typescript
// These signatures MUST remain exactly as they are
window.digitapSDK('init', hasScore: boolean, hasHighScore: boolean);
window.digitapSDK('setCallback', fn: string, callback: Function);
window.digitapSDK('setProgress', state: string, score: number, level: number);
window.digitapSDK('setLevelUp', level: number);
window.digitapSDK('setPlayerFailed', state?: string);
```

### Existing postMessage Protocol (UNCHANGED)

```typescript
// SDK → Parent (controller: '_digitapGame')
{ controller: '_digitapGame', type: 'SDK_SETTINGS', ui: [...], ready: true }
{ controller: '_digitapGame', type: 'SDK_PLAYER_SCORE_UPDATE', state, score, level, continueScore }
{ controller: '_digitapGame', type: 'SDK_PLAYER_LEVEL_UP', level, ... }
{ controller: '_digitapGame', type: 'SDK_PLAYER_FAILED', state, ... }

// Parent → SDK (controller: '_digitapApp')
{ controller: '_digitapApp', type: 'SDK_START_GAME' }
{ controller: '_digitapApp', type: 'SDK_PAUSE_GAME' }
{ controller: '_digitapApp', type: 'SDK_START_GAME_FROM_ZERO' }
{ controller: '_digitapApp', type: 'SDK_CONTINUE_WITH_CURRENT_SCORE' }
```

---

## 2. New Security Protocol (ADDITIVE)

A new postMessage channel using `controller: '_digitapSecurity'` allows GameBox to request risk signals from the SDK.

### 2.1 Request/Response Messages

| Request (Parent → SDK) | Response (SDK → Parent) | Description |
|------------------------|-------------------------|-------------|
| `SDK_INPUT_EVENTS_REQUEST` | `SDK_INPUT_EVENTS_RESPONSE` | Get raw input events + digest |
| `SDK_INPUT_SKETCH_REQUEST` | `SDK_INPUT_SKETCH_RESPONSE` | Get 64-byte behavioral fingerprint |
| `SDK_CANVAS_SAMPLE_REQUEST` | `SDK_CANVAS_SAMPLE_RESPONSE` | Sample canvas at seed-derived points |
| `SDK_CANVAS_EMBED_REQUEST` | `SDK_CANVAS_EMBED_RESPONSE` | Embed watermark data in canvas |
| `SDK_META_REQUEST` | `SDK_META_RESPONSE` | Get session metadata |

### 2.2 Message Formats

```typescript
// Request example (Parent → SDK)
{
  controller: '_digitapSecurity',
  type: 'SDK_CANVAS_SAMPLE_REQUEST',
  seed: '0xabc123...'  // Deterministic sampling seed
}

// Response example (SDK → Parent)
{
  controller: '_digitapSecurity',
  type: 'SDK_CANVAS_SAMPLE_RESPONSE',
  canvasHash: '0xdef456...',
  sample: '0x...'  // Raw sample bytes
}
```

---

## 3. Internal Modules

### 3.1 InputCapture

Captures all user input events passively and provides:
- Raw events array with normalized coordinates (0-1)
- SHA-256 digest of events for integrity verification
- Hold detection (>300ms threshold)

```typescript
interface InputEvent {
  type: 'tap' | 'swipe' | 'hold' | 'release';
  x: number;       // 0-1 normalized
  y: number;       // 0-1 normalized
  dt: number;      // Delta time from previous event (ms)
  pointerId: number;
}
```

### 3.2 CanvasHandler

Handles canvas operations:
- **Sampling:** Deterministic pixel sampling based on seed
- **Watermarking:** LSB steganography in canvas corner regions

```typescript
interface CanvasSample {
  canvasHash: string;  // SHA-256 of sample points
  sample: string;      // Raw RGBA values hex-encoded
}
```

### 3.3 SketchBuilder

Builds a 64-byte behavioral fingerprint for bot detection:

```
Bytes 0-7:   Tap interval histogram (8 buckets)
Bytes 8-15:  Touch zone distribution (8 zones: 4x2 grid)
Bytes 16-23: Velocity histogram (8 buckets)
Bytes 24-47: Reserved for future use
Bytes 48-55: Entropy measures
Bytes 56-63: Metadata (event counts)
```

### 3.4 MetadataCollector

Collects session metadata:

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

### 3.5 SecurityBridge

Coordinates all security modules and handles the `_digitapSecurity` postMessage protocol.

---

## 4. Build Configuration

### 4.1 Output Requirements

- **Single file:** `dist/main.min.js`
- **Minified:** All whitespace/comments removed
- **Mangled:** All private properties and local variables obfuscated
- **No source maps in production:** Remove `devtool: 'source-map'` for prod builds
- **Tree-shaken:** Dead code eliminated

### 4.2 webpack.config.js

```javascript
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => ({
  entry: './src/index.ts',
  devtool: argv.mode === 'development' ? 'source-map' : false,
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: 'main.min.js',
    path: path.resolve(__dirname, 'dist'),
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          mangle: {
            properties: {
              regex: /^_/,  // Mangle properties starting with _
            },
          },
          compress: {
            drop_console: true,
            drop_debugger: true,
            pure_funcs: ['console.log', 'console.debug', 'console.info'],
          },
          format: {
            comments: false,
          },
        },
        extractComments: false,
      }),
    ],
  },
});
```

---

## 5. File Structure

```
src/
├── index.ts                    # Main entry point (existing + security init)
├── streamer.ts                 # Existing WebRTC streamer
├── types/
│   └── index.ts                # TypeScript interfaces
└── security/
    ├── SecurityBridge.ts       # Main coordinator
    ├── InputCapture.ts         # User input capture
    ├── CanvasHandler.ts        # Canvas sampling & watermarking
    ├── SketchBuilder.ts        # 64-byte behavioral fingerprint
    ├── MetadataCollector.ts    # Session metadata
    └── utils.ts                # SHA-256, encoding utilities
```

---

## 6. Implementation Phases

### Phase 1: Infrastructure (Now)
- [x] Analyze specifications
- [ ] Update webpack.config.js with TerserPlugin
- [ ] Create type definitions
- [ ] Create utility functions (SHA-256, encoding)

### Phase 2: Security Modules (Now)
- [ ] Implement InputCapture
- [ ] Implement CanvasHandler
- [ ] Implement SketchBuilder
- [ ] Implement MetadataCollector
- [ ] Implement SecurityBridge

### Phase 3: Integration (Now)
- [ ] Integrate SecurityBridge into main SDK
- [ ] Ensure backward compatibility
- [ ] Build and test minified output

### Phase 4: Validation (Later - GameBox Team)
- [ ] GameBox integration with security protocol
- [ ] Backend endpoint integration
- [ ] Shadow mode testing
- [ ] Production rollout

---

## 7. Backward Compatibility Guarantees

1. **Public API unchanged:** All existing game integrations continue to work
2. **postMessage events unchanged:** Existing `_digitapGame`/`_digitapApp` messages work as before
3. **Graceful degradation:** If security modules fail, game continues to function
4. **Additive only:** New `_digitapSecurity` channel doesn't interfere with existing flow

---

## 8. Security Considerations

### What the SDK Provides (Risk Signals)
- Input event patterns (for bot detection)
- Canvas samples (for visual verification)
- Behavioral fingerprint (for anomaly detection)
- Session metadata (for replay normalization)

### What the SDK Does NOT Do
- No DPoP signing (parent owns keys)
- No rolling hash computation (parent computes from received events)
- No checkpoint scheduling (parent orchestrates)
- No backend communication (parent handles all API calls)

The SDK is **untrusted by design**. All trust anchors (device keys, passkeys) remain in the parent container.

---

## 9. Acceptance Criteria

- [ ] `npm run build` produces single `dist/main.min.js`
- [ ] Output is minified (no readable variable names)
- [ ] Output is mangled (private properties obfuscated)
- [ ] Existing games work without changes
- [ ] SecurityBridge responds to all `_digitapSecurity` message types
- [ ] Input events normalized to 0-1 coordinates
- [ ] 64-byte sketch produces deterministic output
- [ ] Canvas sampling is deterministic given same seed

---

**End of Implementation Plan**
