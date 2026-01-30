# WAM SDK Security Hardening - Implementation Plan

**Version:** 2.0  
**Date:** January 7, 2025  
**Status:** Ready for Implementation

---

## Final Deliverable

A **single minified/obfuscated JavaScript file** (`main.min.js`) that:

1. Exposes the **unchanged public API**: `init()`, `setProgress()`, `setLevelUp()`, `setPlayerFailed()`
2. Internally adds security modules that communicate with GameBox via `postMessage`
3. Works transparently with all existing games (drop-in replacement)

---

## Table of Contents

1. [Constraints](#1-constraints)
2. [Architecture](#2-architecture)
3. [SDK Internal Modules](#3-sdk-internal-modules)
4. [postMessage Protocol](#4-postmessage-protocol)
5. [API Contracts](#5-api-contracts)
6. [Data Types](#6-data-types)
7. [Build & Bundle](#7-build--bundle)
8. [Testing](#8-testing)
9. [Implementation Phases](#9-implementation-phases)

---

## 1. Constraints

| Constraint | Description |
|------------|-------------|
| **Public API frozen** | `init`, `setProgress`, `setLevelUp`, `setPlayerFailed` signatures unchanged |
| **Third-party games** | Cannot modify game code |
| **Cross-platform** | Web, iOS WebView, Android WebView, Telegram Mini App |
| **Single file output** | One `main.min.js` with obfuscation/mangling |
| **Transparent upgrade** | Existing games work without changes |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GAME IFRAME                                   │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    SDK (main.min.js)                              │  │
│  │                                                                   │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │              PUBLIC API (UNCHANGED)                         │  │  │
│  │  │   window.game.init(config)                                  │  │  │
│  │  │   window.game.setProgress(score)                            │  │  │
│  │  │   window.game.setLevelUp(level)                             │  │  │
│  │  │   window.game.setPlayerFailed(score)                        │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  │                              │                                    │  │
│  │  ┌───────────────────────────┴──────────────────────────────────┐ │  │
│  │  │                 INTERNAL SECURITY MODULES (NEW)              │ │  │
│  │  │                                                              │ │  │
│  │  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │ │  │
│  │  │  │ InputCapture │ │CanvasHandler │ │ MetadataCollector    │  │ │  │
│  │  │  │              │ │              │ │                      │  │ │  │
│  │  │  │ • capture()  │ │ • sample()   │ │ • collect()          │  │ │  │
│  │  │  │ • normalize()│ │ • embed()    │ │ • screen, dpr, etc   │  │ │  │
│  │  │  │ • getEvents()│ │ • extract()  │ │                      │  │ │  │
│  │  │  └──────────────┘ └──────────────┘ └──────────────────────┘  │ │  │
│  │  │                                                              │ │  │
│  │  │  ┌──────────────┐ ┌──────────────────────────────────────┐   │ │  │
│  │  │  │SketchBuilder │ │ SecurityBridge (postMessage handler) │   │ │  │
│  │  │  │              │ │                                      │   │ │  │
│  │  │  │ • build()    │ │ • Responds to GameBox requests       │   │ │  │
│  │  │  │ • 64 bytes   │ │ • controller: '_digitapSecurity'     │   │ │  │
│  │  │  └──────────────┘ └──────────────────────────────────────┘   │ │  │
│  │  └──────────────────────────────────────────────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                     │                                   │
│                          postMessage│                                   │
└─────────────────────────────────────┼───────────────────────────────────┘
                                      │
                                      ▼
                              GAMEBOX (Parent)
                    (Orchestrates security, calls backend)
```

---

## 3. SDK Internal Modules

### 3.1 SecurityBridge

The main coordinator that listens for `postMessage` requests from GameBox.

```typescript
// src/security/SecurityBridge.ts

class SecurityBridge {
  private inputCapture: InputCapture;
  private canvasHandler: CanvasHandler;
  private sketchBuilder: SketchBuilder;
  private metadataCollector: MetadataCollector;

  init(): void {
    this.inputCapture = new InputCapture();
    this.canvasHandler = new CanvasHandler();
    this.sketchBuilder = new SketchBuilder();
    this.metadataCollector = new MetadataCollector();
    
    this.inputCapture.start();
    this.canvasHandler.findCanvas();
    this.listenForRequests();
  }

  private listenForRequests(): void {
    window.addEventListener('message', (event) => {
      if (event.data?.controller !== '_digitapSecurity') return;
      
      switch (event.data.type) {
        case 'SDK_INPUT_EVENTS_REQUEST':
          this.handleInputEvents(event);
          break;
        case 'SDK_INPUT_SKETCH_REQUEST':
          this.handleInputSketch(event);
          break;
        case 'SDK_CANVAS_SAMPLE_REQUEST':
          this.handleCanvasSample(event);
          break;
        case 'SDK_CANVAS_EMBED_REQUEST':
          this.handleCanvasEmbed(event);
          break;
        case 'SDK_META_REQUEST':
          this.handleMeta(event);
          break;
      }
    });
  }

  private respond(event: MessageEvent, type: string, data: any): void {
    (event.source as Window).postMessage({
      controller: '_digitapSecurity',
      type,
      ...data
    }, event.origin);
  }

  private handleInputEvents(event: MessageEvent): void {
    const { events, digest } = this.inputCapture.flush();
    this.respond(event, 'SDK_INPUT_EVENTS_RESPONSE', { events, digest });
  }

  private handleInputSketch(event: MessageEvent): void {
    const sketch = this.sketchBuilder.build();
    this.respond(event, 'SDK_INPUT_SKETCH_RESPONSE', { sketch });
  }

  private handleCanvasSample(event: MessageEvent): void {
    const { canvasHash, sample } = this.canvasHandler.sample(event.data.seed);
    this.respond(event, 'SDK_CANVAS_SAMPLE_RESPONSE', { canvasHash, sample });
  }

  private handleCanvasEmbed(event: MessageEvent): void {
    const success = this.canvasHandler.embed(event.data.data);
    this.respond(event, 'SDK_CANVAS_EMBED_RESPONSE', { success });
  }

  private handleMeta(event: MessageEvent): void {
    const meta = this.metadataCollector.collect();
    this.respond(event, 'SDK_META_RESPONSE', { meta });
  }
}
```

### 3.2 InputCapture

Captures all user input, normalizes to backend format, tracks holds.

```typescript
// src/security/InputCapture.ts

class InputCapture {
  private buffer: RawInputEvent[] = [];
  private lastEventTime = 0;
  private activePointers = new Map<number, { startTime: number; x: number; y: number }>();
  private holdCheckInterval: number | null = null;
  
  private static HOLD_THRESHOLD_MS = 300;

  start(): void {
    const events = ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mousemove', 'mouseup'];
    events.forEach(type => {
      window.addEventListener(type, (e) => this.capture(e), { passive: true });
    });
    
    // Periodic hold detection
    this.holdCheckInterval = window.setInterval(() => this.checkHolds(), 100);
  }

  private capture(e: Event): void {
    const now = performance.now();
    const dt = this.lastEventTime > 0 ? now - this.lastEventTime : 0;
    this.lastEventTime = now;

    const raw: RawInputEvent = {
      type: e.type,
      ts: now,
      dt,
      pointerId: 0
    };

    // Extract coordinates
    if ('clientX' in e) {
      raw.x = (e as MouseEvent).clientX;
      raw.y = (e as MouseEvent).clientY;
    }
    if ('touches' in e && (e as TouchEvent).touches.length > 0) {
      const touch = (e as TouchEvent).touches[0];
      raw.x = touch.clientX;
      raw.y = touch.clientY;
      raw.pointerId = touch.identifier;
    }
    if ('pointerId' in e) {
      raw.pointerId = (e as PointerEvent).pointerId;
    }

    // Track active pointers for hold detection
    if (e.type === 'touchstart' || e.type === 'mousedown') {
      this.activePointers.set(raw.pointerId, { startTime: now, x: raw.x!, y: raw.y! });
    } else if (e.type === 'touchend' || e.type === 'mouseup') {
      this.activePointers.delete(raw.pointerId);
    }

    this.buffer.push(raw);
  }

  private checkHolds(): void {
    const now = performance.now();
    for (const [pointerId, pointer] of this.activePointers) {
      if (now - pointer.startTime > InputCapture.HOLD_THRESHOLD_MS) {
        this.buffer.push({
          type: 'hold',
          ts: now,
          dt: now - this.lastEventTime,
          x: pointer.x,
          y: pointer.y,
          pointerId
        });
        pointer.startTime = now; // Prevent duplicate holds
      }
    }
  }

  flush(): { events: InputEvent[]; digest: string } {
    const events = this.normalize(this.buffer);
    const digest = keccak256(toUtf8Bytes(JSON.stringify(events)));
    this.buffer = [];
    return { events, digest };
  }

  private normalize(raw: RawInputEvent[]): InputEvent[] {
    const w = window.innerWidth;
    const h = window.innerHeight;
    
    return raw.map(e => ({
      type: this.mapType(e.type),
      x: e.x !== undefined ? e.x / w : 0,  // Normalize to 0-1
      y: e.y !== undefined ? e.y / h : 0,
      dt: Math.round(e.dt),
      pointerId: e.pointerId ?? 0
    }));
  }

  private mapType(domType: string): 'tap' | 'swipe' | 'hold' | 'release' {
    switch (domType) {
      case 'touchstart':
      case 'mousedown':
        return 'tap';
      case 'touchmove':
      case 'mousemove':
        return 'swipe';
      case 'touchend':
      case 'mouseup':
        return 'release';
      case 'hold':
        return 'hold';
      default:
        return 'tap';
    }
  }
}
```

### 3.3 CanvasHandler

Samples canvas pixels and embeds/extracts watermarks.

```typescript
// src/security/CanvasHandler.ts

class CanvasHandler {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private findInterval: number | null = null;

  findCanvas(): void {
    this.findInterval = window.setInterval(() => {
      this.canvas = document.querySelector('canvas');
      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d');
        if (this.findInterval) clearInterval(this.findInterval);
      }
    }, 100);
  }

  sample(seed: string): { canvasHash: string; sample: string } {
    if (!this.ctx || !this.canvas) {
      return { canvasHash: '0x', sample: '' };
    }

    const SAMPLE_POINTS = 8;
    const samples = new Uint8Array(SAMPLE_POINTS * 4);
    const w = this.canvas.width;
    const h = this.canvas.height;

    for (let i = 0; i < SAMPLE_POINTS; i++) {
      const pointSeed = keccak256(toUtf8Bytes(seed + i.toString()));
      const x = parseInt(pointSeed.slice(2, 10), 16) % w;
      const y = parseInt(pointSeed.slice(10, 18), 16) % h;
      
      const block = this.ctx.getImageData(x, y, 2, 2).data;
      const avg = this.averageBlock(block);
      
      samples[i * 4 + 0] = avg.r >> 4;
      samples[i * 4 + 1] = avg.g >> 4;
      samples[i * 4 + 2] = avg.b >> 4;
      samples[i * 4 + 3] = avg.a >> 4;
    }

    return {
      canvasHash: keccak256(samples),
      sample: bytesToHex(samples)
    };
  }

  embed(data: string): boolean {
    if (!this.ctx) return false;

    const REGION = { x: 0, y: 0, w: 64, h: 8 };
    const watermarkData = hexToBytes(keccak256(toUtf8Bytes(data)).slice(2, 34));
    
    const imageData = this.ctx.getImageData(REGION.x, REGION.y, REGION.w, REGION.h);
    const pixels = imageData.data;

    for (let i = 0; i < watermarkData.length * 8 && i < pixels.length / 4; i++) {
      const bit = (watermarkData[Math.floor(i / 8)] >> (7 - (i % 8))) & 1;
      const pixelIdx = i * 4 + 2;
      pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
    }

    this.ctx.putImageData(imageData, REGION.x, REGION.y);
    return true;
  }

  private averageBlock(block: Uint8ClampedArray) {
    let r = 0, g = 0, b = 0, a = 0;
    const pixels = block.length / 4;
    for (let i = 0; i < block.length; i += 4) {
      r += block[i]; g += block[i+1]; b += block[i+2]; a += block[i+3];
    }
    return {
      r: Math.floor(r/pixels),
      g: Math.floor(g/pixels),
      b: Math.floor(b/pixels),
      a: Math.floor(a/pixels)
    };
  }
}
```

### 3.4 SketchBuilder

Builds a 64-byte behavioral fingerprint for bot detection.

```typescript
// src/security/SketchBuilder.ts

class SketchBuilder {
  private tapIntervals: number[] = [];
  private lastTapTime = 0;
  private touchZones = new Uint8Array(8);
  private velocities: number[] = [];

  recordEvent(e: Event): void {
    const now = performance.now();

    if (e.type === 'touchstart' || e.type === 'mousedown') {
      if (this.lastTapTime > 0) {
        this.tapIntervals.push(now - this.lastTapTime);
      }
      this.lastTapTime = now;
      
      // Record zone (8 zones: 4 columns × 2 rows)
      let x = 0, y = 0;
      if ('clientX' in e) { x = (e as MouseEvent).clientX; y = (e as MouseEvent).clientY; }
      if ('touches' in e && (e as TouchEvent).touches.length > 0) {
        x = (e as TouchEvent).touches[0].clientX;
        y = (e as TouchEvent).touches[0].clientY;
      }
      
      const zone = Math.min(
        Math.floor(x / (window.innerWidth / 4)) +
        Math.floor(y / (window.innerHeight / 2)) * 4,
        7
      );
      this.touchZones[zone]++;
    }

    if (e.type === 'touchmove' || e.type === 'mousemove') {
      if ('movementX' in e) {
        const velocity = Math.sqrt(
          Math.pow((e as MouseEvent).movementX, 2) +
          Math.pow((e as MouseEvent).movementY, 2)
        );
        this.velocities.push(velocity);
      }
    }
  }

  build(): string {
    const sketch = new Uint8Array(64);

    // Bytes 0-7: Tap interval histogram
    sketch.set(this.normalizeHist(this.histogram(this.tapIntervals, [50, 100, 150, 200, 250, 300, 350])), 0);
    
    // Bytes 8-15: Touch zone distribution
    sketch.set(this.normalizeHist(this.touchZones), 8);
    
    // Bytes 16-23: Velocity histogram
    sketch.set(this.normalizeHist(this.histogram(this.velocities, [10, 25, 50, 100, 200, 400, 800])), 16);
    
    // Bytes 24-47: Reserved
    
    // Bytes 48-55: Entropy measures
    sketch[48] = Math.floor(this.entropy(this.tapIntervals) * 255);
    sketch[49] = Math.floor(this.entropy(Array.from(this.touchZones)) * 255);
    
    // Bytes 56-63: Metadata
    sketch[56] = Math.min(this.tapIntervals.length, 255);
    sketch[57] = Math.min(this.velocities.length, 255);

    return bytesToHex(sketch);
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

  private normalizeHist(hist: Uint8Array): Uint8Array {
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    return new Uint8Array(hist.map(v => Math.floor((v / total) * 255)));
  }

  private entropy(values: number[]): number {
    if (values.length === 0) return 0;
    const counts = new Map<number, number>();
    for (const v of values) {
      const bucket = Math.floor(v / 50);
      counts.set(bucket, (counts.get(bucket) || 0) + 1);
    }
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / values.length;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    return Math.min(entropy / 3, 1);
  }
}
```

### 3.5 MetadataCollector

Collects session metadata for trajectory replay.

```typescript
// src/security/MetadataCollector.ts

class MetadataCollector {
  collect(): SessionMeta {
    return {
      screenW: screen.width,
      screenH: screen.height,
      dpr: Math.round(window.devicePixelRatio * 10) / 10,
      orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
      platform: this.detectPlatform(),
      touchCapable: 'ontouchstart' in window || navigator.maxTouchPoints > 0
    };
  }

  private detectPlatform(): 'ios' | 'android' | 'web' | 'desktop' {
    const ua = navigator.userAgent.toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/android/.test(ua)) return 'android';
    if (/mobile|tablet/.test(ua)) return 'web';
    return 'desktop';
  }
}
```

---

## 4. postMessage Protocol

All messages use `controller: '_digitapSecurity'` to namespace the protocol.

### Request → Response

| Request Type | Response Type | Description |
|--------------|---------------|-------------|
| `SDK_INPUT_EVENTS_REQUEST` | `SDK_INPUT_EVENTS_RESPONSE` | Get raw input events + digest |
| `SDK_INPUT_SKETCH_REQUEST` | `SDK_INPUT_SKETCH_RESPONSE` | Get 64-byte behavioral sketch |
| `SDK_CANVAS_SAMPLE_REQUEST` | `SDK_CANVAS_SAMPLE_RESPONSE` | Sample canvas at seed-derived points |
| `SDK_CANVAS_EMBED_REQUEST` | `SDK_CANVAS_EMBED_RESPONSE` | Embed watermark in canvas |
| `SDK_META_REQUEST` | `SDK_META_RESPONSE` | Get session metadata |

### Message Format

```typescript
// GameBox → SDK (Request)
{
  controller: '_digitapSecurity',
  type: 'SDK_INPUT_EVENTS_REQUEST',
  // ... request-specific data
}

// SDK → GameBox (Response)
{
  controller: '_digitapSecurity',
  type: 'SDK_INPUT_EVENTS_RESPONSE',
  events: InputEvent[],
  digest: string
}
```

### Response Payloads

```typescript
// SDK_INPUT_EVENTS_RESPONSE
{
  events: InputEvent[];  // Normalized events
  digest: string;        // keccak256 hash of events
}

// SDK_INPUT_SKETCH_RESPONSE
{
  sketch: string;  // 64 bytes hex (0x + 128 chars)
}

// SDK_CANVAS_SAMPLE_RESPONSE
{
  canvasHash: string;  // keccak256 of samples
  sample: string;      // Raw sample bytes hex
}

// SDK_CANVAS_EMBED_RESPONSE
{
  success: boolean;
}

// SDK_META_RESPONSE
{
  meta: SessionMeta;
}
```

---

## 5. API Contracts

These are the request/response interfaces the SDK/GameBox sends to the backend.

### 5.1 Start Session

**Request:**
```typescript
interface StartSessionRequest {
  gameId: number;
  gameSessionId: number;
  mode: 'CASUAL' | 'TOURNAMENT' | 'DEGEN';
  sdkVersion: string;
  dpopJkt: string;
  meta: SessionMeta;
}
```

**Response:**
```typescript
interface StartSessionResponse {
  sessionId: string;
  windowMs: number;
  startAtServerMs: number;
  minValidatedWindows: number;
  config: {
    requireWorkerSig: boolean;
    maxScoreDeltaPerWindow: number | null;
  };
  skill: {
    rating: number;
    confidence: number;
    persona: 'CASUAL' | 'GRINDER' | 'SNIPER' | 'WHALE';
    plays: number;
  };
}
```

### 5.2 Checkpoint

**Request:**
```typescript
interface CheckpointRequest {
  sessionId: string;
  wIndex: number;
  rollingHash: string;
  score: number;
  inputDigest: string;
  inputs: InputEvent[];
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

// Or if too early (HTTP 425):
interface CheckpointRetry {
  accepted: false;
  retryAfterMs: number;
}
```

### 5.3 End Session

**Request:**
```typescript
interface EndSessionRequest {
  sessionId: string;
  finalScore: number;
  rollingHash: string;
  inputSketch: string;
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
  skillRank: number | null;
}
```

---

## 6. Data Types

```typescript
// Input event in backend format (normalized)
interface InputEvent {
  type: 'tap' | 'swipe' | 'hold' | 'release';
  x: number;       // 0-1 normalized (screen width)
  y: number;       // 0-1 normalized (screen height)
  dt: number;      // Delta time from previous input (ms)
  pointerId?: number;
}

// Raw DOM event (internal)
interface RawInputEvent {
  type: string;
  x?: number;
  y?: number;
  ts: number;
  dt: number;
  pointerId: number;
}

// Session metadata
interface SessionMeta {
  screenW: number;
  screenH: number;
  dpr: number;
  orientation: 'portrait' | 'landscape';
  platform: 'ios' | 'android' | 'web' | 'desktop';
  touchCapable: boolean;
  rngSeed?: number;
}
```

---

## 7. Build & Bundle

### webpack.config.js

```javascript
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  entry: './src/index.ts',
  output: {
    filename: 'main.min.js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      name: 'game',
      type: 'window',
      export: 'default'
    }
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          mangle: {
            properties: {
              regex: /^_/  // Mangle private properties
            }
          },
          compress: {
            drop_console: true,
            drop_debugger: true
          }
        }
      })
    ]
  }
};
```

### Entry Point

```typescript
// src/index.ts

import { SecurityBridge } from './security/SecurityBridge';

const securityBridge = new SecurityBridge();

// Public API (UNCHANGED)
export default {
  init(config: GameConfig): void {
    // Existing init logic...
    
    // Initialize security modules (transparent to game)
    securityBridge.init();
  },

  setProgress(score: number): void {
    // Existing logic...
  },

  setLevelUp(level: number): void {
    // Existing logic...
  },

  setPlayerFailed(score: number): void {
    // Existing logic...
  }
};
```

### Build Command

```bash
npm run build
# Output: dist/main.min.js
```

---

## 8. Testing

### Unit Tests

```typescript
describe('InputCapture', () => {
  it('should normalize coordinates to 0-1 range');
  it('should map DOM events to backend types');
  it('should detect hold after 300ms threshold');
  it('should calculate correct delta time');
  it('should track pointerId for multi-touch');
});

describe('CanvasHandler', () => {
  it('should sample deterministically from seed');
  it('should embed watermark in LSB of blue channel');
  it('should handle missing canvas gracefully');
});

describe('SketchBuilder', () => {
  it('should produce exactly 64 bytes');
  it('should capture tap interval distribution');
  it('should capture touch zone distribution');
  it('should calculate entropy correctly');
});

describe('SecurityBridge', () => {
  it('should respond to SDK_INPUT_EVENTS_REQUEST');
  it('should respond to SDK_META_REQUEST');
  it('should ignore non-security messages');
});
```

### Integration Tests

```typescript
describe('postMessage Protocol', () => {
  it('should complete request/response cycle');
  it('should flush input buffer after events request');
});
```

---

## 9. Implementation Phases

| Phase | Week | Deliverable |
|-------|------|-------------|
| 1 | 1 | `InputCapture` + `MetadataCollector` |
| 2 | 2 | `CanvasHandler` (sample, embed) |
| 3 | 3 | `SketchBuilder` (64-byte fingerprint) |
| 4 | 4 | `SecurityBridge` + postMessage protocol |
| 5 | 5 | Integration with existing SDK entry point |
| 6 | 6 | Build optimization + obfuscation |
| 7 | 7 | Testing + QA |
| 8 | 8 | Release |

### Acceptance Criteria

- [ ] Public API unchanged (`init`, `setProgress`, `setLevelUp`, `setPlayerFailed`)
- [ ] All postMessage handlers respond correctly
- [ ] Input events normalized to 0-1 coordinates
- [ ] Hold events inferred after 300ms
- [ ] 64-byte sketch builds correctly
- [ ] Canvas sampling deterministic from seed
- [ ] Single minified output file
- [ ] Existing games work without changes

---

**End of Implementation Plan**
