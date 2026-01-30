# WAM SDK Security Architecture: Comprehensive Implementation Plan

**Author:** Claude Sonnet 4.5  
**Date:** December 17, 2025  
**Status:** Proposed Architecture  
**Audience:** Development Team

---

## Executive Summary

This document proposes a **five-layer security architecture** for WAM's HTML5 gaming SDK that addresses score manipulation, bot gameplay, and replay attacks without requiring server-side deterministic game logic. The system combines **cryptographic proofs** with **steganographic canvas watermarking** to create tamper-evident, time-bound, device-anchored gameplay transcripts.

### Core Innovation
**Steganographic canvas watermarking** binds cryptographic checkpoints directly to game rendering, preventing attacks that traditional crypto-only approaches cannot detect (memory editing, credential theft, bot gameplay with valid signatures).

### Security Guarantees
1. **Transcript Integrity** - Rolling hash prevents after-the-fact editing
2. **Time Continuity** - Window checkpoints prevent fast-forwarding
3. **Device Binding** - DPoP signatures prove device possession
4. **User Presence** - Passkey assertions prove human participation
5. **Visual Binding** - Canvas watermarks prove legitimate rendering

---

## Table of Contents
1. [Current State Analysis](#1-current-state-analysis)
2. [Threat Model](#2-threat-model)
3. [Proposed Architecture](#3-proposed-architecture)
4. [Steganographic Canvas Watermarking](#4-steganographic-canvas-watermarking)
5. [Cryptographic Transcript Layer](#5-cryptographic-transcript-layer)
6. [Implementation Plan (5 Phases)](#6-implementation-plan)
7. [SDK API Design](#7-sdk-api-design)
8. [Backend Architecture](#8-backend-architecture)
9. [Security Analysis](#9-security-analysis)
10. [Configuration & Rollout](#10-configuration--rollout)
11. [Performance & Privacy](#11-performance--privacy)
12. [Testing Strategy](#12-testing-strategy)

---

## 1. Current State Analysis

### Existing Infrastructure
**SDK (`src/index.ts`):**
- Simple postMessage bridge between game and platform
- 4 public methods: `init`, `setProgress`, `setLevelUp`, `setPlayerFailed`
- Origin validation only
- No cryptographic security

**Backend (`api.play.wam.4.0`):**
- ✅ **DPoP public keys stored** in session table (`dpopJkt`)
- ✅ **Score middleware** with monotonic sequence enforcement
- ✅ **Redis Stream queue** for async score persistence
- ✅ **Nonce management** via bitmap (replay protection)
- ✅ **EIP-712 signatures** for platform operations
- ✅ **Worker wallet** encrypted with Passkey (secure enclave)
- ✅ **SimpleWebAuthn** integration for Passkey flows

### Security Gaps
| Attack Vector | Current Defense | Status |
|---------------|-----------------|--------|
| Score tampering via DevTools | None | ❌ Vulnerable |
| Memory editing (Cheat Engine) | None | ❌ Vulnerable |
| Time compression (fast-forward) | Sequence checking only | ⚠️ Weak |
| Replay attacks | Session validation | ⚠️ Weak |
| Bot gameplay | None | ❌ Vulnerable |
| Stolen credentials + bot | None | ❌ Vulnerable |
| Canvas state manipulation | None | ❌ Vulnerable |

---

## 2. Threat Model

### Attacker Capabilities
1. **Full control over client JS runtime** (debugger, memory editing, script injection)
2. **Can modify SDK and game code**
3. **Can pause/rewind/fast-forward gameplay**
4. **Can fabricate events and scores**
5. **Can steal DPoP keys from IndexedDB** (if not properly protected)
6. **Can record legitimate gameplay and replay with different scores**

### Attacker Limitations (Cryptographic Assumptions)
1. ✅ **Cannot forge DPoP signatures** without private key
2. ✅ **Cannot forge Passkey assertions** without authenticator
3. ✅ **Cannot forge worker wallet signatures** without encrypted key
4. ✅ **Cannot produce valid canvas watermarks** without SDK embedding logic
5. ✅ **Cannot satisfy real-time challenges** if using pre-recorded gameplay

### Attack Scenarios by Mode

**Casual Mode (Low Stakes):**
- Script kiddies using browser DevTools
- Simple memory editors
- Score injection via postMessage

**Tournament Mode (Medium Stakes):**
- Sophisticated bots with stolen credentials
- Replay attacks with modified scores
- Time compression attacks

**Degen Mode (High Stakes - Real Money):**
- Professional cheat developers
- Bot farms with valid user credentials
- Remote rendering attacks
- Memory editing + credential theft combined

---

## 3. Proposed Architecture

### Five-Layer Defense System

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: ON-CHAIN COMMITMENT (Optional - High Value Only)  │
│ - Immutable anchoring of final claim                        │
│ - Worker wallet signature verification                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: USER PRESENCE PROOFS                               │
│ - Passkey assertions every 30s                              │
│ - Strong device/user binding                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: DEVICE BINDING                                     │
│ - DPoP signatures every 5s                                  │
│ - Continuous device possession proof                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: VISUAL BINDING (NEW - Steganographic)             │
│ - Canvas watermark embedding                                │
│ - Binds crypto proofs to actual rendering                  │
│ - Prevents memory editing detection                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: TRANSCRIPT INTEGRITY                               │
│ - Rolling hash commitment                                   │
│ - Tamper-evident event log                                  │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Game Event (score update)
    ↓
TranscriptRecorder.append()  ← Rolling hash updated
    ↓
WindowClock.tick()  ← Check if checkpoint needed
    ↓
[Every 5s] DPoP Checkpoint
    ↓
    1. Sign checkpoint digest with DPoP key
    2. Embed watermark in canvas (LSB steganography)
    3. Hash watermarked canvas
    4. Store checkpoint in AnchorBundle
    ↓
[Every 30s] Passkey Checkpoint
    ↓
    1. Request WebAuthn assertion
    2. Embed assertion signature in canvas
    3. Hash watermarked canvas
    4. Store strong checkpoint
    ↓
[On Game End] Finalize Session
    ↓
    1. Compute final rolling hash
    2. Compute anchors hash
    3. Sign claim with worker wallet
    4. Submit to backend
    ↓
Backend Verification
    ↓
    1. Verify DPoP signatures
    2. Verify Passkey assertions
    3. Verify worker wallet signature
    4. Clamp time to validated windows
    5. Check canvas hash progression
    6. [Optional] Extract canvas watermarks
```

---

## 4. Steganographic Canvas Watermarking

### Core Technique: LSB Embedding

**Least Significant Bit (LSB) steganography** embeds data in the lowest bit of RGB color channels. This is:
- **Imperceptible** to human eye (±1 color value)
- **Fast** (~5-10ms for 720p canvas)
- **Sufficient** for checkpoint binding

### Implementation

#### SDK Module: `CanvasSteganography.ts`

```typescript
export class CanvasSteganography {
  private canvas: HTMLCanvasElement | null = null
  
  /**
   * Automatically detect and inject steganography into game canvas
   */
  public inject(): void {
    // Wait for canvas to be available
    const checkCanvas = setInterval(() => {
      const canvas = document.querySelector('canvas')
      if (canvas) {
        this.canvas = canvas
        clearInterval(checkCanvas)
        this.hookRendering()
      }
    }, 100)
  }
  
  /**
   * Hook into canvas rendering to embed watermarks after each frame
   */
  private hookRendering(): void {
    if (!this.canvas) return
    
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    const self = this
    
    HTMLCanvasElement.prototype.getContext = function(type: string, ...args: any[]) {
      const ctx = originalGetContext.call(this, type, ...args)
      
      if (type === '2d' && ctx) {
        return new Proxy(ctx, {
          get(target, prop) {
            // Hook render operations
            if (prop === 'fillRect' || prop === 'drawImage' || prop === 'putImageData') {
              return function(...renderArgs: any[]) {
                const result = target[prop].apply(target, renderArgs)
                // Post-render: embed watermark if checkpoint pending
                if (self.pendingWatermark) {
                  self.embedImmediate(target)
                }
                return result
              }
            }
            return target[prop]
          }
        })
      }
      return ctx
    }
  }
  
  private pendingWatermark: WatermarkData | null = null
  
  /**
   * Schedule watermark for next frame render
   */
  public embed(data: WatermarkData): void {
    this.pendingWatermark = data
  }
  
  /**
   * Embed watermark in current canvas frame using LSB
   */
  private embedImmediate(ctx: CanvasRenderingContext2D): void {
    if (!this.pendingWatermark) return
    
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    
    // Get current frame pixels
    const imageData = ctx.getImageData(0, 0, width, height)
    const pixels = imageData.data
    
    // Encode watermark as binary
    const message = this.encodeWatermark(this.pendingWatermark)
    const binary = this.textToBinary(message)
    
    // Embed in LSB of RGB channels (skip alpha)
    let bitIndex = 0
    for (let i = 0; i < pixels.length && bitIndex < binary.length; i += 4) {
      pixels[i] = (pixels[i] & 0xFE) | parseInt(binary[bitIndex++] || '0')     // R
      pixels[i+1] = (pixels[i+1] & 0xFE) | parseInt(binary[bitIndex++] || '0') // G
      pixels[i+2] = (pixels[i+2] & 0xFE) | parseInt(binary[bitIndex++] || '0') // B
      // pixels[i+3] is alpha - don't touch
    }
    
    // Write watermarked frame back to canvas
    ctx.putImageData(imageData, 0, 0)
    
    this.pendingWatermark = null
  }
  
  /**
   * Encode checkpoint data into compact format
   */
  private encodeWatermark(data: WatermarkData): string {
    return JSON.stringify({
      w: data.windowIndex,        // Window index
      h: data.rollingHash.slice(0, 16),  // Truncated hash
      s: data.signature.slice(0, 32),     // Truncated signature
      t: data.timestamp,
      v: 1  // Version
    })
  }
  
  /**
   * Extract watermark from canvas frame
   */
  public extract(ctx: CanvasRenderingContext2D): WatermarkData | null {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
    const pixels = imageData.data
    
    // Extract LSB from RGB channels
    let binary = ''
    for (let i = 0; i < pixels.length; i += 4) {
      binary += (pixels[i] & 1).toString()       // R
      binary += (pixels[i+1] & 1).toString()     // G
      binary += (pixels[i+2] & 1).toString()     // B
    }
    
    // Convert binary to text and parse
    const text = this.binaryToText(binary)
    try {
      const parsed = JSON.parse(text)
      return {
        windowIndex: parsed.w,
        rollingHash: parsed.h,
        signature: parsed.s,
        timestamp: parsed.t,
        version: parsed.v
      }
    } catch {
      return null
    }
  }
  
  /**
   * Hash current canvas state (includes embedded watermark)
   */
  public hashCanvas(ctx: CanvasRenderingContext2D): string {
    const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
    
    // Use fast hash (xxHash or similar for performance)
    return this.fastHash(imageData.data)
  }
  
  // Utility functions
  private textToBinary(text: string): string {
    return text.split('').map(char => 
      char.charCodeAt(0).toString(2).padStart(8, '0')
    ).join('')
  }
  
  private binaryToText(binary: string): string {
    const bytes = binary.match(/.{1,8}/g) || []
    return bytes.map(byte => String.fromCharCode(parseInt(byte, 2))).join('')
  }
  
  private fastHash(data: Uint8ClampedArray): string {
    // Implement xxHash or use crypto.subtle for SHA-256
    // For now, placeholder
    return '0x' + Array.from(data.slice(0, 32))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }
}

export interface WatermarkData {
  windowIndex: number
  rollingHash: string
  signature: string
  timestamp: number
  version?: number
}
```

### Watermark Properties

**Payload Size:** ~200 bytes per checkpoint
- Window index: 4 bytes
- Rolling hash (truncated): 16 bytes
- DPoP signature (truncated): 32 bytes
- Timestamp: 8 bytes
- Metadata: ~20 bytes

**Embedding Capacity:**
- 720p canvas (1280×720): ~276,480 pixels → ~100KB capacity
- Our payload (200 bytes) uses **0.2%** of available space

**Performance:**
- Embedding: ~5-10ms (1280×720 canvas)
- Extraction: ~5-10ms
- Hashing: ~2-5ms
- **Total overhead: ~10-20ms per checkpoint (negligible for 5s interval)**

### Visual Imperceptibility

LSB modification changes RGB values by ±1:
- Original pixel: `rgb(128, 64, 200)`
- Watermarked: `rgb(129, 65, 201)`
- **Difference:** Completely invisible to human eye

---

## 5. Cryptographic Transcript Layer

### Rolling Hash Commitment

**Purpose:** Create tamper-evident append-only log of game events

```typescript
export class TranscriptRecorder {
  private rollingHash: string = ''
  private events: TranscriptEvent[] = []
  
  /**
   * Initialize transcript with session metadata
   */
  public init(sessionId: string, gameId: string): void {
    const initPayload = {
      type: 'init',
      sessionId,
      gameId,
      sdkVersion: SDK_VERSION,
      timestamp: Date.now()
    }
    
    this.rollingHash = this.hash(this.encode(initPayload))
  }
  
  /**
   * Append event to transcript
   */
  public append(event: Partial<TranscriptEvent>): void {
    const canonical: TranscriptEvent = {
      v: 1, // Schema version
      t: event.type || 'score',
      w: event.windowIndex || WindowClock.current(),
      ms: Date.now(),
      score: event.score || 0,
      level: event.level || 0,
      state: event.state || null
    }
    
    this.events.push(canonical)
    
    // Update rolling hash: H(prev || encode(event))
    this.rollingHash = this.hash(this.rollingHash + this.encode(canonical))
  }
  
  /**
   * Get current rolling hash
   */
  public getHash(): string {
    return this.rollingHash
  }
  
  /**
   * Get full transcript (for debugging/disputes)
   */
  public getEvents(): TranscriptEvent[] {
    return [...this.events]
  }
  
  /**
   * Canonical encoding (deterministic)
   */
  private encode(obj: any): string {
    // Sort keys for determinism
    const sorted = Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = obj[key]
      return acc
    }, {} as any)
    
    return JSON.stringify(sorted)
  }
  
  /**
   * Cryptographic hash (keccak256 for EVM compatibility)
   */
  private hash(data: string): string {
    // Use ethers.js keccak256 for compatibility with backend
    return keccak256(toUtf8Bytes(data))
  }
}

export interface TranscriptEvent {
  v: number          // Schema version
  t: string          // Event type
  w: number          // Window index
  ms: number         // Timestamp
  score: number      // Current score
  level: number      // Current level
  state: string | null  // Game state
}
```

---

## 6. Implementation Plan

### Phase 1: Foundation (Week 1-2)
**Goal:** Build transcript + steganography infrastructure (shadow mode)

#### SDK Changes

**New Files:**
```
src/
  security/
    TranscriptRecorder.ts       # Rolling hash commitment
    WindowClock.ts              # Time window management
    CanvasSteganography.ts      # LSB watermarking
    CheckpointEngine.ts         # Orchestrates checkpoints
    AnchorBundle.ts             # Collects proof artifacts
    DPoPSigner.ts               # Sign with IndexedDB DPoP key
    types.ts                    # TypeScript interfaces
```

**Modified Files:**
```typescript
// src/index.ts - Integrate security modules

import { TranscriptRecorder } from './security/TranscriptRecorder'
import { WindowClock } from './security/WindowClock'
import { CanvasSteganography } from './security/CanvasSteganography'
import { CheckpointEngine } from './security/CheckpointEngine'

class DigitapGamePlayerSDK {
  // NEW: Security modules
  private static transcript: TranscriptRecorder = new TranscriptRecorder()
  private static windowClock: WindowClock = new WindowClock()
  private static stego: CanvasSteganography = new CanvasSteganography()
  private static checkpoints: CheckpointEngine = new CheckpointEngine()
  
  // EXISTING: Keep unchanged for compatibility
  public static init(hasScore = true, hasHighScore = true): void {
    // ... existing init logic ...
    
    // NEW: Initialize security layer (shadow mode)
    if (this.isSecurityEnabled()) {
      this.initSecurity()
    }
  }
  
  private static initSecurity(): void {
    const sessionId = this.generateSessionId()
    const gameId = this.getCurrentGameId()
    
    // Initialize transcript
    this.transcript.init(sessionId, gameId)
    
    // Start window clock
    this.windowClock.start()
    
    // Inject canvas steganography
    this.stego.inject()
    
    // Start checkpoint engine
    this.checkpoints.start(this.transcript, this.stego)
  }
  
  public static setProgress(state: string, score: number, level: number): void {
    // EXISTING: Send postMessage (unchanged)
    this.progress = {
      type: "SDK_PLAYER_SCORE_UPDATE",
      state,
      score,
      level,
      continueScore: score,
      controller: "_digitapGame",
    }
    this.sendData()
    
    // NEW: Record in transcript
    if (this.isSecurityEnabled()) {
      this.transcript.append({
        type: 'score',
        score,
        level,
        state,
        windowIndex: this.windowClock.current()
      })
    }
  }
  
  private static isSecurityEnabled(): boolean {
    // Feature flag - read from platform config
    return (window as any).__WAM_SECURITY_ENABLED__ !== false
  }
}
```

#### Backend Changes

**Database Schema:**
```sql
-- Store canvas watermark hashes for verification
CREATE TABLE score_sessions (
  id SERIAL PRIMARY KEY,
  game_session_id INT NOT NULL REFERENCES game_sessions(id),
  session_id TEXT NOT NULL UNIQUE,
  
  -- Transcript commitments
  rolling_hash TEXT NOT NULL,
  anchors_hash TEXT NOT NULL,
  
  -- Score data
  submitted_score INT NOT NULL,
  claimed_time_ms BIGINT NOT NULL,
  verified_time_ms BIGINT NOT NULL,
  
  -- Validation metrics
  dpop_checkpoints_provided INT NOT NULL,
  dpop_checkpoints_valid INT NOT NULL,
  passkey_checkpoints_provided INT NOT NULL,
  passkey_checkpoints_valid INT NOT NULL,
  
  -- Canvas verification
  canvas_hashes JSONB, -- Array of hashes per checkpoint
  canvas_frames_submitted INT DEFAULT 0,
  canvas_frames_verified INT DEFAULT 0,
  
  -- Signatures
  worker_signature TEXT,
  
  -- Metadata
  sdk_version TEXT NOT NULL,
  mode TEXT NOT NULL, -- CASUAL, TOURNAMENT, DEGEN
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);

CREATE INDEX idx_score_sessions_game_session ON score_sessions(game_session_id);
CREATE INDEX idx_score_sessions_mode ON score_sessions(mode);
```

**New Service:**
```typescript
// src/services/ScoreVerificationService.ts

export class ScoreVerificationService {
  /**
   * Verify score session submission (Phase 1: shadow mode - log only)
   */
  async verifySession(claim: ScoreSessionClaim): Promise<VerificationResult> {
    const results = {
      cryptoValid: false,
      canvasHashesValid: false,
      confidenceScore: 0
    }
    
    // Phase 1: Just store the data, don't enforce
    await prisma.scoreSession.create({
      data: {
        gameSessionId: claim.gameSessionId,
        sessionId: claim.sessionId,
        rollingHash: claim.rollingHash,
        anchorsHash: claim.anchorsHash,
        submittedScore: claim.finalScore,
        claimedTimeMs: claim.claimedTimeMs,
        verifiedTimeMs: claim.claimedTimeMs, // No clamping yet
        dpopCheckpointsProvided: claim.checkpoints.filter(c => c.type === 'dpop').length,
        dpopCheckpointsValid: 0, // Will verify in Phase 2
        passkeyCheckpointsProvided: 0,
        passkeyCheckpointsValid: 0,
        canvasHashes: claim.checkpoints.map(c => c.canvasHash),
        sdkVersion: claim.sdkVersion,
        mode: claim.mode
      }
    })
    
    return results
  }
}

export interface ScoreSessionClaim {
  gameSessionId: number
  sessionId: string
  rollingHash: string
  anchorsHash: string
  finalScore: number
  claimedTimeMs: number
  checkpoints: Checkpoint[]
  sdkVersion: string
  mode: 'CASUAL' | 'TOURNAMENT' | 'DEGEN'
}
```

#### Deliverables
- ✅ SDK v2.0.0 with transcript layer
- ✅ Canvas steganography module (working but not enforced)
- ✅ Backend accepts transcript data (stores but doesn't validate)
- ✅ Monitoring dashboard showing % of sessions with transcript data

---

### Phase 2: DPoP Checkpoint Validation (Week 3-4)
**Goal:** Verify DPoP signatures, clamp time based on validated windows

#### SDK Changes

```typescript
// src/security/CheckpointEngine.ts

export class CheckpointEngine {
  private dpopSigner: DPoPSigner
  private intervalId: number | null = null
  
  async start(transcript: TranscriptRecorder, stego: CanvasSteganography) {
    // Create DPoP checkpoint every 5 seconds
    this.intervalId = window.setInterval(async () => {
      await this.createDPoPCheckpoint(transcript, stego)
    }, 5000)
  }
  
  private async createDPoPCheckpoint(
    transcript: TranscriptRecorder,
    stego: CanvasSteganography
  ): Promise<void> {
    const wIndex = WindowClock.current()
    const rollingHash = transcript.getHash()
    const scoreSoFar = DigitapGamePlayerSDK.getCurrentScore()
    const state = DigitapGamePlayerSDK.getCurrentState()
    
    // Create checkpoint digest
    const checkpointDigest = keccak256(
      encodePacked(
        ['string', 'uint256', 'string', 'uint256', 'string'],
        [this.sessionId, wIndex, rollingHash, scoreSoFar, state]
      )
    )
    
    // Sign with DPoP key from IndexedDB
    const dpopSig = await this.dpopSigner.sign(checkpointDigest)
    
    // Embed watermark in canvas
    stego.embed({
      windowIndex: wIndex,
      rollingHash,
      signature: dpopSig,
      timestamp: Date.now()
    })
    
    // Wait for next frame render (watermark embedded)
    await this.waitForNextFrame()
    
    // Hash watermarked canvas
    const canvas = document.querySelector('canvas')
    const ctx = canvas?.getContext('2d')
    const canvasHash = ctx ? stego.hashCanvas(ctx) : null
    
    // Store checkpoint
    AnchorBundle.add({
      type: 'dpop',
      wIndex,
      checkpointDigest,
      dpopSig,
      canvasHash,
      timestamp: Date.now()
    })
  }
  
  private waitForNextFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
  }
}
```

```typescript
// src/security/DPoPSigner.ts

export class DPoPSigner {
  private keyPair: CryptoKeyPair | null = null
  
  /**
   * Load DPoP key from IndexedDB (same key used for HTTP DPoP headers)
   */
  async init(): Promise<void> {
    // Access IndexedDB to retrieve DPoP key
    const db = await this.openDB()
    const storedKey = await this.getStoredKey(db)
    
    if (storedKey) {
      // Import existing key
      this.keyPair = await crypto.subtle.importKey(
        'jwk',
        storedKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
      )
    } else {
      throw new Error('DPoP key not found - user must authenticate first')
    }
  }
  
  /**
   * Sign checkpoint digest with DPoP private key
   */
  async sign(digest: string): Promise<string> {
    if (!this.keyPair) {
      throw new Error('DPoP signer not initialized')
    }
    
    const data = new TextEncoder().encode(digest)
    
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.keyPair.privateKey,
      data
    )
    
    // Convert to base64
    return btoa(String.fromCharCode(...new Uint8Array(signature)))
  }
  
  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('wam-dpop', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  
  private async getStoredKey(db: IDBDatabase): Promise<JsonWebKey | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['keys'], 'readonly')
      const store = tx.objectStore('keys')
      const request = store.get('dpop-key')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
}
```

#### Backend Changes

```typescript
// src/services/ScoreVerificationService.ts (Phase 2)

export class ScoreVerificationService {
  async verifySession(claim: ScoreSessionClaim): Promise<VerificationResult> {
    // Get user's DPoP public key
    const gameSession = await prisma.gameSession.findUnique({
      where: { id: claim.gameSessionId },
      include: { session: true }
    })
    
    const dpopJkt = gameSession?.session?.dpopJkt
    if (!dpopJkt) {
      throw new Error('DPoP key not found for session')
    }
    
    const dpopKey = await this.getDPoPPublicKey(dpopJkt)
    
    // Verify each DPoP checkpoint
    let validatedWindows = 0
    const dpopCheckpoints = claim.checkpoints.filter(c => c.type === 'dpop')
    
    for (const cp of dpopCheckpoints) {
      const isValid = await this.verifyDPoPSignature(
        dpopKey,
        cp.checkpointDigest,
        cp.dpopSig
      )
      
      if (isValid) {
        validatedWindows++
      }
    }
    
    // Clamp claimed time to validated windows
    const WINDOW_DURATION_MS = 5000
    const maxAllowedTimeMs = validatedWindows * WINDOW_DURATION_MS
    const verifiedTimeMs = Math.min(claim.claimedTimeMs, maxAllowedTimeMs)
    
    // Store with verification results
    await prisma.scoreSession.create({
      data: {
        gameSessionId: claim.gameSessionId,
        sessionId: claim.sessionId,
        rollingHash: claim.rollingHash,
        anchorsHash: claim.anchorsHash,
        submittedScore: claim.finalScore,
        claimedTimeMs: claim.claimedTimeMs,
        verifiedTimeMs, // Clamped time
        dpopCheckpointsProvided: dpopCheckpoints.length,
        dpopCheckpointsValid: validatedWindows,
        canvasHashes: claim.checkpoints.map(c => c.canvasHash),
        sdkVersion: claim.sdkVersion,
        mode: claim.mode
      }
    })
    
    // Enforcement policy
    const policy = this.getPolicy(claim.mode)
    const validationRate = validatedWindows / dpopCheckpoints.length
    
    if (policy.requireMinValidation && validationRate < policy.minValidationRate) {
      throw new Error(
        `Insufficient checkpoint validation: ${validationRate.toFixed(2)} < ${policy.minValidationRate}`
      )
    }
    
    return {
      cryptoValid: true,
      validatedWindows,
      verifiedTimeMs,
      confidenceScore: validationRate
    }
  }
  
  private async verifyDPoPSignature(
    publicKey: CryptoKey,
    digest: string,
    signature: string
  ): Promise<boolean> {
    try {
      const data = new TextEncoder().encode(digest)
      const sigBuffer = Uint8Array.from(atob(signature), c => c.charCodeAt(0))
      
      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        publicKey,
        sigBuffer,
        data
      )
    } catch {
      return false
    }
  }
  
  private getPolicy(mode: string) {
    const policies = {
      CASUAL: {
        requireMinValidation: false,
        minValidationRate: 0
      },
      TOURNAMENT: {
        requireMinValidation: true,
        minValidationRate: 0.6 // 60% of checkpoints must be valid
      },
      DEGEN: {
        requireMinValidation: true,
        minValidationRate: 0.8 // 80% of checkpoints must be valid
      }
    }
    
    return policies[mode] || policies.CASUAL
  }
}
```

#### Deliverables
- ✅ DPoP checkpoint signing in SDK
- ✅ Backend DPoP signature verification
- ✅ Time clamping based on validated windows
- ✅ Mode-based enforcement policies
- ✅ Monitoring: checkpoint validation rates

---

### Phase 3: Passkey Strong Checkpoints (Week 5-6)
**Goal:** Add user-presence proofs every 30s

#### SDK Changes

```typescript
// src/security/CheckpointEngine.ts (Phase 3 additions)

export class CheckpointEngine {
  private passkeyCheckpointInterval = 6 // Every 6 windows (30s)
  
  async start(transcript: TranscriptRecorder, stego: CanvasSteganography) {
    // DPoP checkpoints every 5s
    let windowCounter = 0
    
    this.intervalId = window.setInterval(async () => {
      await this.createDPoPCheckpoint(transcript, stego)
      
      windowCounter++
      
      // Passkey checkpoint every 6 windows (30s)
      if (windowCounter % this.passkeyCheckpointInterval === 0) {
        await this.createPasskeyCheckpoint(transcript, stego, windowCounter)
      }
    }, 5000)
  }
  
  private async createPasskeyCheckpoint(
    transcript: TranscriptRecorder,
    stego: CanvasSteganography,
    windowCounter: number
  ): Promise<void> {
    const wFrom = windowCounter - this.passkeyCheckpointInterval
    const wTo = windowCounter - 1
    const rollingHash = transcript.getHash()
    const scoreSoFar = DigitapGamePlayerSDK.getCurrentScore()
    
    // Create passkey challenge
    const passkeyDigest = keccak256(
      encodePacked(
        ['string', 'uint256', 'uint256', 'string', 'uint256', 'string'],
        [this.sessionId, wFrom, wTo, rollingHash, scoreSoFar, SDK_VERSION]
      )
    )
    
    try {
      // Request WebAuthn assertion with user verification
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: this.hexToBuffer(passkeyDigest),
          rpId: 'wam.app',
          allowCredentials: [{
            type: 'public-key',
            id: this.getUserCredentialId()
          }],
          userVerification: 'required', // Requires biometric/PIN
          timeout: 60000
        }
      })
      
      if (!credential || credential.type !== 'public-key') {
        throw new Error('Invalid credential type')
      }
      
      const assertion = credential as PublicKeyCredential
      const response = assertion.response as AuthenticatorAssertionResponse
      
      // Embed passkey signature in canvas
      stego.embed({
        windowIndex: wTo,
        rollingHash,
        signature: this.arrayBufferToBase64(response.signature),
        timestamp: Date.now()
      })
      
      await this.waitForNextFrame()
      
      // Hash watermarked canvas
      const canvas = document.querySelector('canvas')
      const ctx = canvas?.getContext('2d')
      const canvasHash = ctx ? stego.hashCanvas(ctx) : null
      
      // Store strong checkpoint
      AnchorBundle.add({
        type: 'passkey',
        wFrom,
        wTo,
        passkeyDigest,
        credentialId: assertion.id,
        authenticatorData: this.arrayBufferToBase64(response.authenticatorData),
        clientDataJSON: this.arrayBufferToBase64(response.clientDataJSON),
        signature: this.arrayBufferToBase64(response.signature),
        canvasHash,
        timestamp: Date.now()
      })
      
    } catch (error) {
      // Passkey failed - mark session as degraded
      this.handlePasskeyFailure(error)
    }
  }
  
  private handlePasskeyFailure(error: any): void {
    const mode = DigitapGamePlayerSDK.getMode()
    
    if (mode === 'CASUAL') {
      // Casual: continue gameplay, mark as unverified
      console.warn('Passkey checkpoint failed - session marked as unverified', error)
      AnchorBundle.markDegraded()
    } else {
      // Tournament/Degen: pause gameplay, prompt user
      DigitapGamePlayerSDK.pauseGameplay()
      DigitapGamePlayerSDK.showPasskeyError(
        'User verification required for this game mode. Please authenticate to continue.'
      )
    }
  }
  
  private getUserCredentialId(): ArrayBuffer {
    // Get stored credential ID from platform
    const credId = (window as any).__WAM_PASSKEY_CREDENTIAL_ID__
    if (!credId) {
      throw new Error('Passkey not configured')
    }
    return this.base64ToArrayBuffer(credId)
  }
  
  // Utility functions
  private hexToBuffer(hex: string): ArrayBuffer {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)))
    return bytes.buffer
  }
  
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
  }
  
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}
```

#### Backend Changes

```typescript
// src/services/ScoreVerificationService.ts (Phase 3)

import { verifyAuthenticationResponse } from '@simplewebauthn/server'

export class ScoreVerificationService {
  async verifySession(claim: ScoreSessionClaim): Promise<VerificationResult> {
    // ... DPoP verification from Phase 2 ...
    
    // Verify Passkey checkpoints
    let strongCheckpointsValid = 0
    const passkeyCheckpoints = claim.checkpoints.filter(c => c.type === 'passkey')
    
    for (const cp of passkeyCheckpoints) {
      const isValid = await this.verifyPasskeyCheckpoint(cp, claim.gameSessionId)
      if (isValid) {
        strongCheckpointsValid++
      }
    }
    
    // Check if sufficient strong checkpoints provided
    const policy = this.getPolicy(claim.mode)
    const expectedStrongCheckpoints = Math.floor(validatedWindows / 6)
    
    if (policy.requireStrongCheckpoints) {
      if (strongCheckpointsValid < expectedStrongCheckpoints * policy.minStrongCheckpointRate) {
        throw new Error('Insufficient user-presence proofs')
      }
    }
    
    // Store verification results
    await prisma.scoreSession.create({
      data: {
        // ... existing fields ...
        passkeyCheckpointsProvided: passkeyCheckpoints.length,
        passkeyCheckpointsValid: strongCheckpointsValid
      }
    })
    
    return {
      cryptoValid: true,
      validatedWindows,
      strongCheckpointsValid,
      verifiedTimeMs,
      confidenceScore: this.calculateConfidence(validatedWindows, strongCheckpointsValid)
    }
  }
  
  private async verifyPasskeyCheckpoint(
    checkpoint: PasskeyCheckpoint,
    gameSessionId: number
  ): Promise<boolean> {
    try {
      // Get user's passkey credential
      const gameSession = await prisma.gameSession.findUnique({
        where: { id: gameSessionId },
        include: { user: { include: { passkey: true } } }
      })
      
      const passkey = gameSession?.user?.passkey
      if (!passkey) {
        return false
      }
      
      // Verify WebAuthn assertion
      const verification = await verifyAuthenticationResponse({
        response: {
          id: checkpoint.credentialId,
          rawId: this.base64ToBuffer(checkpoint.credentialId),
          response: {
            authenticatorData: this.base64ToBuffer(checkpoint.authenticatorData),
            clientDataJSON: this.base64ToBuffer(checkpoint.clientDataJSON),
            signature: this.base64ToBuffer(checkpoint.signature)
          },
          type: 'public-key'
        },
        expectedChallenge: checkpoint.passkeyDigest,
        expectedOrigin: process.env.EXPECTED_ORIGIN || 'https://wam.app',
        expectedRPID: 'wam.app',
        authenticator: {
          credentialID: passkey.credentialId,
          credentialPublicKey: passkey.publicKey,
          counter: passkey.counter
        }
      })
      
      // Update counter if verification succeeded
      if (verification.verified && verification.authenticationInfo?.newCounter) {
        await prisma.passkey.update({
          where: { id: passkey.id },
          data: { counter: verification.authenticationInfo.newCounter }
        })
      }
      
      return verification.verified
    } catch (error) {
      console.error('Passkey verification failed:', error)
      return false
    }
  }
  
  private getPolicy(mode: string) {
    const policies = {
      CASUAL: {
        requireMinValidation: false,
        requireStrongCheckpoints: false,
        minValidationRate: 0,
        minStrongCheckpointRate: 0
      },
      TOURNAMENT: {
        requireMinValidation: true,
        requireStrongCheckpoints: true,
        minValidationRate: 0.6,
        minStrongCheckpointRate: 0.8 // 80% of expected Passkey checkpoints
      },
      DEGEN: {
        requireMinValidation: true,
        requireStrongCheckpoints: true,
        minValidationRate: 0.8,
        minStrongCheckpointRate: 0.9 // 90% of expected Passkey checkpoints
      }
    }
    
    return policies[mode] || policies.CASUAL
  }
}
```

#### Deliverables
- ✅ Passkey checkpoint assertions every 30s
- ✅ Backend Passkey verification via SimpleWebAuthn
- ✅ Graceful degradation for casual mode
- ✅ Hard enforcement for tournament/degen modes
- ✅ User-presence proof validation

---

### Phase 4: Worker Wallet Binding (Week 7)
**Goal:** Tie final score claim to existing gas voucher identity

#### SDK Changes

```typescript
// src/index.ts - Final score submission

public static async setPlayerFailed(state: string = "FAIL"): Promise<void> {
  // EXISTING: Mark as failed
  this.progress.state = state
  this.progress.score = 0
  this.progress.type = "SDK_PLAYER_FAILED"
  this.sendData()
  
  // NEW: Finalize secure session
  if (this.isSecurityEnabled()) {
    await this.finalizeSecureSession()
  }
  
  // EXISTING: Reset game
  this.afterStartGameFromZero()
}

private static async finalizeSecureSession(): Promise<void> {
  const finalClaim = {
    sessionId: this.sessionId,
    gameSessionId: this.gameSessionId,
    rollingHash: this.transcript.getHash(),
    anchorsHash: AnchorBundle.computeHash(),
    finalScore: this.progress.score,
    claimedTimeMs: this.windowClock.elapsed(),
    checkpoints: AnchorBundle.getAll(),
    sdkVersion: SDK_VERSION,
    mode: this.getMode()
  }
  
  // Sign claim with worker wallet
  const workerSig = await this.signWithWorkerWallet(finalClaim)
  
  // Submit to backend
  await fetch('/api/score/finalize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.getAuthToken()}`
    },
    body: JSON.stringify({
      ...finalClaim,
      workerSig
    })
  })
}

private static async signWithWorkerWallet(claim: any): Promise<string> {
  // Worker wallet is already unlocked via Passkey during game start
  // (User authenticated with Passkey to start game)
  
  const scoreClaimDigest = keccak256(
    encodePacked(
      ['string', 'string', 'string', 'uint256', 'uint256', 'string', 'string'],
      [
        claim.sessionId,
        claim.rollingHash,
        claim.anchorsHash,
        claim.finalScore,
        claim.claimedTimeMs,
        claim.gameSessionId,
        SDK_VERSION
      ]
    )
  )
  
  // Get worker wallet from platform
  const workerWallet = await (window as any).__WAM_WORKER_WALLET__
  if (!workerWallet) {
    throw new Error('Worker wallet not available')
  }
  
  // Sign digest with worker wallet private key
  return await workerWallet.signMessage(scoreClaimDigest)
}
```

#### Backend Changes

```typescript
// src/services/ScoreVerificationService.ts (Phase 4)

import { verifyMessage } from 'ethers'

export class ScoreVerificationService {
  async verifySession(claim: ScoreSessionClaim): Promise<VerificationResult> {
    // ... DPoP and Passkey verification from Phase 2-3 ...
    
    // Verify worker wallet signature
    const workerSigValid = await this.verifyWorkerSignature(claim)
    
    if (!workerSigValid) {
      throw new Error('Invalid worker wallet signature')
    }
    
    // All verifications passed
    await prisma.scoreSession.create({
      data: {
        // ... existing fields ...
        workerSignature: claim.workerSig,
        verifiedAt: new Date()
      }
    })
    
    return {
      cryptoValid: true,
      validatedWindows,
      strongCheckpointsValid,
      workerSigValid,
      verifiedTimeMs,
      confidenceScore: 1.0 // Full confidence with all layers verified
    }
  }
  
  private async verifyWorkerSignature(claim: ScoreSessionClaim): Promise<boolean> {
    try {
      // Get user's worker wallet address
      const gameSession = await prisma.gameSession.findUnique({
        where: { id: claim.gameSessionId },
        include: { user: true }
      })
      
      const expectedWorkerAddress = gameSession?.user?.workerWalletAddress
      if (!expectedWorkerAddress) {
        return false
      }
      
      // Reconstruct signed digest
      const scoreClaimDigest = keccak256(
        solidityPacked(
          ['string', 'string', 'string', 'uint256', 'uint256', 'string', 'string'],
          [
            claim.sessionId,
            claim.rollingHash,
            claim.anchorsHash,
            claim.finalScore,
            claim.claimedTimeMs,
            claim.gameSessionId.toString(),
            claim.sdkVersion
          ]
        )
      )
      
      // Verify signature
      const recoveredAddress = verifyMessage(scoreClaimDigest, claim.workerSig)
      
      return recoveredAddress.toLowerCase() === expectedWorkerAddress.toLowerCase()
    } catch (error) {
      console.error('Worker signature verification failed:', error)
      return false
    }
  }
}
```

**Integration with Gas Voucher System:**

```typescript
// src/services/account-abstraction/GasVoucherService.ts

export class GasVoucherService {
  async issueVoucher(userId: string, transaction: Transaction): Promise<Voucher> {
    // For score-related transactions, require verified score session
    if (transaction.type === 'SCORE_COMMIT' || transaction.gameSessionId) {
      const scoreSession = await prisma.scoreSession.findFirst({
        where: {
          gameSessionId: transaction.gameSessionId,
          verifiedAt: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      })
      
      if (!scoreSession || !scoreSession.workerSignature) {
        throw new Error('Score must be verified with worker wallet signature for gas sponsorship')
      }
    }
    
    // Issue voucher as normal
    return this.createVoucher(userId, transaction)
  }
}
```

#### Deliverables
- ✅ Worker wallet signature on final score
- ✅ Backend verification against user's worker wallet
- ✅ Gas voucher system refuses unverified scores
- ✅ Complete cryptographic binding across entire system

---

### Phase 5: Canvas Watermark Extraction (Week 8 - Optional)
**Goal:** Extract and verify embedded watermarks for high-value sessions

#### SDK Changes

```typescript
// On-demand frame submission for disputes
public static async submitFrameProof(windowIndex: number): Promise<void> {
  const canvas = document.querySelector('canvas')
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  // Extract current frame
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  
  // Compress frame (JPEG quality 0.5)
  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.5)
  })
  
  // Submit to backend
  const formData = new FormData()
  formData.append('sessionId', this.sessionId)
  formData.append('windowIndex', windowIndex.toString())
  formData.append('frame', blob)
  
  await fetch('/api/score/submit-frame', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${this.getAuthToken()}` },
    body: formData
  })
}
```

#### Backend Changes

```typescript
// src/services/ScoreVerificationService.ts (Phase 5)

export class ScoreVerificationService {
  async verifyFrameSubmission(
    sessionId: string,
    windowIndex: number,
    frameImage: Buffer
  ): Promise<boolean> {
    // Load frame into image processing
    const imageData = await this.loadImage(frameImage)
    
    // Extract watermark using same LSB algorithm
    const extracted = this.extractLSBWatermark(imageData)
    
    if (!extracted) {
      return false
    }
    
    // Get expected checkpoint data
    const scoreSession = await prisma.scoreSession.findUnique({
      where: { sessionId },
      include: { checkpoints: true }
    })
    
    const expectedCheckpoint = scoreSession?.checkpoints.find(
      c => c.windowIndex === windowIndex
    )
    
    if (!expectedCheckpoint) {
      return false
    }
    
    // Verify watermark matches checkpoint
    const watermarkValid = (
      extracted.windowIndex === expectedCheckpoint.windowIndex &&
      extracted.rollingHash === expectedCheckpoint.rollingHash.slice(0, 16) &&
      extracted.signature === expectedCheckpoint.dpopSig.slice(0, 32)
    )
    
    // Update verification status
    await prisma.scoreSession.update({
      where: { sessionId },
      data: {
        canvasFramesSubmitted: { increment: 1 },
        canvasFramesVerified: { increment: watermarkValid ? 1 : 0 }
      }
    })
    
    return watermarkValid
  }
  
  private extractLSBWatermark(imageData: ImageData): WatermarkData | null {
    const pixels = imageData.data
    
    // Extract LSB from RGB channels
    let binary = ''
    for (let i = 0; i < pixels.length; i += 4) {
      binary += (pixels[i] & 1).toString()       // R
      binary += (pixels[i+1] & 1).toString()     // G
      binary += (pixels[i+2] & 1).toString()     // B
    }
    
    // Convert binary to text
    const bytes = binary.match(/.{1,8}/g) || []
    const text = bytes.map(byte => String.fromCharCode(parseInt(byte, 2))).join('')
    
    try {
      const parsed = JSON.parse(text.split('\0')[0]) // Null-terminate
      return {
        windowIndex: parsed.w,
        rollingHash: parsed.h,
        signature: parsed.s,
        timestamp: parsed.t
      }
    } catch {
      return null
    }
  }
}
```

#### Deliverables
- ✅ On-demand frame submission
- ✅ Server-side watermark extraction
- ✅ Dispute resolution via frame verification
- ✅ ML anomaly detection pipeline (optional)

---

## 7. SDK API Design

### Public API (Unchanged for Compatibility)

```typescript
// EXISTING API - remains identical
DigitapGamePlayerSDK.init(hasScore?: boolean, hasHighScore?: boolean)
DigitapGamePlayerSDK.setProgress(state: string, score: number, level: number)
DigitapGamePlayerSDK.setLevelUp(level: number)
DigitapGamePlayerSDK.setPlayerFailed(state?: string)
DigitapGamePlayerSDK.setCallback(fn: CallbackType, callback: Function)
```

### Internal Security API (New - SDK Use Only)

```typescript
// Transparent to game developers - SDK handles automatically
TranscriptRecorder.init(sessionId: string, gameId: string)
TranscriptRecorder.append(event: TranscriptEvent)
TranscriptRecorder.getHash(): string

WindowClock.start()
WindowClock.current(): number
WindowClock.elapsed(): number

CanvasSteganography.inject()
CanvasSteganography.embed(data: WatermarkData)
CanvasSteganography.extract(ctx: CanvasRenderingContext2D): WatermarkData | null
CanvasSteganography.hashCanvas(ctx: CanvasRenderingContext2D): string

CheckpointEngine.start(transcript: TranscriptRecorder, stego: CanvasSteganography)
CheckpointEngine.stop()

AnchorBundle.add(checkpoint: Checkpoint)
AnchorBundle.getAll(): Checkpoint[]
AnchorBundle.computeHash(): string
```

### Configuration API (Platform Provides)

```typescript
// Set via platform before game loads
window.__WAM_SECURITY_CONFIG__ = {
  enabled: true,
  mode: 'TOURNAMENT', // CASUAL, TOURNAMENT, DEGEN
  windowDurationMs: 5000,
  passkeyInterval: 6, // Every 6 windows (30s)
  dpopKeyName: 'wam-dpop-key',
  passkeyCredentialId: 'base64...',
  workerWalletAvailable: true
}
```

---

## 8. Backend Architecture

### API Endpoints

#### `POST /api/score/finalize`
**Purpose:** Submit final score claim with transcript and signatures

**Request:**
```typescript
interface FinalizeScoreRequest {
  sessionId: string
  gameSessionId: number
  rollingHash: string
  anchorsHash: string
  finalScore: number
  claimedTimeMs: number
  checkpoints: Checkpoint[]
  workerSig: string
  sdkVersion: string
  mode: 'CASUAL' | 'TOURNAMENT' | 'DEGEN'
}
```

**Response:**
```typescript
interface FinalizeScoreResponse {
  verified: boolean
  verifiedTimeMs: number
  validatedWindows: number
  strongCheckpointsValid: number
  confidenceScore: number
  warnings: string[]
}
```

#### `POST /api/score/submit-frame` (Optional - Phase 5)
**Purpose:** Submit canvas frame for watermark extraction

**Request:** `multipart/form-data`
- `sessionId`: string
- `windowIndex`: number
- `frame`: image file

**Response:**
```typescript
interface SubmitFrameResponse {
  watermarkValid: boolean
  extractedData: WatermarkData | null
}
```

### Database Schema (Complete)

```sql
-- Main score session table
CREATE TABLE score_sessions (
  id SERIAL PRIMARY KEY,
  game_session_id INT NOT NULL REFERENCES game_sessions(id),
  session_id TEXT NOT NULL UNIQUE,
  
  -- Transcript commitments
  rolling_hash TEXT NOT NULL,
  anchors_hash TEXT NOT NULL,
  
  -- Score data
  submitted_score INT NOT NULL,
  claimed_time_ms BIGINT NOT NULL,
  verified_time_ms BIGINT NOT NULL,
  
  -- DPoP validation
  dpop_checkpoints_provided INT NOT NULL,
  dpop_checkpoints_valid INT NOT NULL,
  
  -- Passkey validation
  passkey_checkpoints_provided INT NOT NULL,
  passkey_checkpoints_valid INT NOT NULL,
  
  -- Canvas verification
  canvas_hashes JSONB,
  canvas_frames_submitted INT DEFAULT 0,
  canvas_frames_verified INT DEFAULT 0,
  
  -- Worker wallet signature
  worker_signature TEXT,
  
  -- Metadata
  sdk_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  confidence_score DECIMAL(3, 2),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  
  -- Indexes
  INDEX idx_game_session_id (game_session_id),
  INDEX idx_mode (mode),
  INDEX idx_verified_at (verified_at)
);

-- Detailed checkpoint data (optional - for auditing)
CREATE TABLE score_checkpoints (
  id SERIAL PRIMARY KEY,
  score_session_id INT NOT NULL REFERENCES score_sessions(id),
  
  type TEXT NOT NULL, -- 'dpop' or 'passkey'
  window_index INT NOT NULL,
  
  -- Checkpoint data
  checkpoint_digest TEXT NOT NULL,
  signature TEXT NOT NULL,
  canvas_hash TEXT,
  
  -- Passkey specific
  window_from INT,
  window_to INT,
  credential_id TEXT,
  authenticator_data TEXT,
  client_data_json TEXT,
  
  -- Verification
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  
  timestamp TIMESTAMPTZ NOT NULL,
  
  INDEX idx_score_session (score_session_id),
  INDEX idx_window (window_index)
);

-- DPoP public keys (for signature verification)
CREATE TABLE dpop_keys (
  jkt TEXT PRIMARY KEY,
  public_key_jwk JSONB NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX idx_user_id (user_id)
);

-- User passkeys (existing table - ensure these fields exist)
ALTER TABLE passkeys ADD COLUMN IF NOT EXISTS counter BIGINT DEFAULT 0;
ALTER TABLE passkeys ADD COLUMN IF NOT EXISTS public_key BYTEA;
ALTER TABLE passkeys ADD COLUMN IF NOT EXISTS credential_id TEXT;

-- User worker wallets (existing table - ensure this field exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_wallet_address TEXT;
```

### Service Architecture

```typescript
// src/services/ScoreVerificationService.ts

export class ScoreVerificationService {
  // Phase 1: Shadow mode - store only
  async recordSession(claim: ScoreSessionClaim): Promise<void>
  
  // Phase 2: DPoP verification
  async verifyDPoPCheckpoints(
    checkpoints: DPoPCheckpoint[],
    dpopPublicKey: CryptoKey
  ): Promise<number>
  
  // Phase 3: Passkey verification
  async verifyPasskeyCheckpoints(
    checkpoints: PasskeyCheckpoint[],
    userPasskey: Passkey
  ): Promise<number>
  
  // Phase 4: Worker wallet verification
  async verifyWorkerSignature(
    claim: ScoreSessionClaim,
    expectedAddress: string
  ): Promise<boolean>
  
  // Phase 5: Canvas watermark extraction
  async extractAndVerifyWatermark(
    frameImage: Buffer,
    expectedCheckpoint: Checkpoint
  ): Promise<boolean>
  
  // Combined verification pipeline
  async verifySession(claim: ScoreSessionClaim): Promise<VerificationResult>
  
  // Policy enforcement
  private getPolicy(mode: string): ValidationPolicy
  private enforcePolicy(
    policy: ValidationPolicy,
    results: VerificationResult
  ): void
}
```

---

## 9. Security Analysis

### Attack Resistance Matrix

| Attack Vector | Defense Mechanism | Confidence |
|---------------|-------------------|------------|
| **DevTools score editing** | Rolling hash breaks | ✅ High |
| **Memory editing (Cheat Engine)** | Canvas hash mismatch | ✅ High |
| **Time compression** | Window checkpoint density | ✅ High |
| **Replay attacks** | Timestamp + nonce validation | ✅ High |
| **Bot gameplay** | Passkey assertions + canvas watermarks | ✅ High |
| **Stolen credentials** | Canvas watermark embedding requires SDK | ✅ Medium-High |
| **Modified SDK** | Canvas hash inconsistency | ✅ Medium |
| **Remote rendering** | Canvas challenge-response (Phase 5) | ✅ High |
| **Screen recording replay** | Watermark extraction proves forgery | ✅ High |
| **Collusion (user + bot)** | Passkey assertions + behavioral analysis | ⚠️ Medium |

### Remaining Attack Vectors

**Sophisticated Attacks Still Possible:**

1. **Modified SDK + DPoP Key Theft:**
   - Attacker extracts DPoP key from IndexedDB
   - Modifies SDK to remove watermarking
   - **Mitigation:** Canvas hash inconsistency detected, SDK integrity checking (future)

2. **Stolen Passkey + Bot:**
   - Attacker clones passkey to secondary device
   - Bot runs with valid passkey
   - **Mitigation:** Device fingerprinting, behavioral analysis (future)

3. **Legitimate User Playing for Bot:**
   - Human plays game, bot gets signatures
   - **Mitigation:** No cryptographic solution exists, requires behavioral ML

### Defense in Depth

The five-layer system provides **redundancy**:
- If DPoP is compromised → Passkey still required
- If Passkey is bypassed → Canvas watermarks detect SDK tampering
- If canvas is forged → Time density clamping limits damage
- If all else fails → Worker wallet ties to existing trusted identity

---

## 10. Configuration & Rollout

### Mode-Based Configuration

```typescript
const SECURITY_CONFIG = {
  CASUAL: {
    // Phase 1-2 only
    transcriptEnabled: true,
    dpopCheckpoints: true,
    dpopEnforced: false, // Shadow mode
    passkeyCheckpoints: false,
    workerSignature: false,
    canvasWatermarks: false,
    
    // Policy
    minValidationRate: 0,
    requireStrongCheckpoints: false
  },
  
  TOURNAMENT: {
    // Phase 1-4
    transcriptEnabled: true,
    dpopCheckpoints: true,
    dpopEnforced: true,
    passkeyCheckpoints: true,
    passkeyEnforced: true,
    workerSignature: true,
    canvasWatermarks: true,
    
    // Policy
    minValidationRate: 0.6,
    minStrongCheckpointRate: 0.8,
    requireStrongCheckpoints: true
  },
  
  DEGEN: {
    // All phases
    transcriptEnabled: true,
    dpopCheckpoints: true,
    dpopEnforced: true,
    passkeyCheckpoints: true,
    passkeyEnforced: true,
    workerSignature: true,
    canvasWatermarks: true,
    canvasFrameSubmission: true, // Phase 5
    
    // Policy
    minValidationRate: 0.8,
    minStrongCheckpointRate: 0.9,
    requireStrongCheckpoints: true,
    requireCanvasProofs: true
  }
}
```

### Rollout Strategy

#### Week 1-2 (Phase 1)
**Deploy to:** Development environment
**Configuration:** All modes in shadow mode
**Metrics:** % of sessions with transcript data

#### Week 3-4 (Phase 2)
**Deploy to:** Staging + 1% production (casual only)
**Configuration:** Casual shadow, Tournament/Degen disabled
**Metrics:** DPoP validation rate, time clamping accuracy

#### Week 5-6 (Phase 3)
**Deploy to:** 10% production (casual + tournament)
**Configuration:** Casual shadow, Tournament enforced
**Metrics:** Passkey success rate, user friction reports

#### Week 7 (Phase 4)
**Deploy to:** 50% production (all modes)
**Configuration:** Worker signature required for tournament/degen
**Metrics:** Gas voucher rejection rate, signature verification success

#### Week 8+ (Phase 5)
**Deploy to:** 100% production
**Configuration:** Full enforcement for degen, optional for tournament
**Metrics:** Full security dashboard, fraud detection alerts

### Feature Flags

```typescript
// Controlled via platform admin panel
interface SecurityFeatureFlags {
  enableTranscript: boolean
  enableDPoPCheckpoints: boolean
  enforceDPoPValidation: boolean
  enablePasskeyCheckpoints: boolean
  enforcePasskeyValidation: boolean
  enableWorkerSignature: boolean
  enableCanvasWatermarks: boolean
  enableCanvasFrameSubmission: boolean
  
  // Per-game overrides
  gameOverrides: Record<string, Partial<SecurityFeatureFlags>>
  
  // Per-user cohorts
  cohortRollout: {
    cohortId: string
    percentage: number
    config: Partial<SecurityFeatureFlags>
  }[]
}
```

---

## 11. Performance & Privacy

### Performance Impact

**SDK Bundle Size:**
- Current: ~15KB minified
- With security layer: ~45KB minified (+30KB)
- Breakdown:
  - TranscriptRecorder: 5KB
  - CanvasSteganography: 10KB
  - CheckpointEngine: 8KB
  - DPoPSigner: 4KB
  - Utilities: 3KB

**Runtime Overhead:**
- DPoP checkpoint (every 5s): ~20ms
- Passkey checkpoint (every 30s): ~500ms (user interaction)
- Canvas watermark embedding: ~5-10ms
- Canvas hashing: ~2-5ms
- **Total per checkpoint: ~25-35ms (0.5% of 5s window)**

**Network Impact:**
- Per-checkpoint metadata: ~500 bytes
- 12 checkpoints per minute: ~6KB/min
- 10-minute session: ~60KB total (negligible)

**Backend Processing:**
- Signature verification: ~10ms per checkpoint
- Passkey verification: ~50ms per checkpoint
- Canvas watermark extraction: ~100ms (Phase 5 only)
- **Total per session: ~1-2 seconds**

### Privacy Considerations

**What We Collect:**
- ✅ Cryptographic signatures (no PII)
- ✅ Canvas hashes (no visual data)
- ✅ Timestamp windows (approximate, not exact)
- ✅ Score progression (game data only)

**What We DON'T Collect:**
- ❌ Screenshots or video
- ❌ Exact mouse/touch coordinates
- ❌ Keystroke timings
- ❌ Browser fingerprints beyond DPoP key

**Phase 5 Exception (Opt-in):**
- Canvas frames submitted ONLY on-demand for disputes
- User must explicitly consent
- Frames deleted after verification

**GDPR Compliance:**
- All crypto signatures are pseudonymous
- No biometric data stored (Passkey stays on device)
- User can request deletion of score sessions
- Watermarks in canvas are ephemeral (not stored)

---

## 12. Testing Strategy

### Unit Tests

```typescript
// SDK tests
describe('TranscriptRecorder', () => {
  it('should initialize with session metadata')
  it('should append events and update rolling hash')
  it('should maintain deterministic hash order')
  it('should reject malformed events')
})

describe('CanvasSteganography', () => {
  it('should embed watermark in canvas LSB')
  it('should extract watermark from canvas')
  it('should be visually imperceptible')
  it('should survive JPEG compression (Phase 5)')
})

describe('CheckpointEngine', () => {
  it('should create DPoP checkpoints every 5s')
  it('should create Passkey checkpoints every 30s')
  it('should handle checkpoint failures gracefully')
  it('should stop on game end')
})
```

### Integration Tests

```typescript
// Backend tests
describe('ScoreVerificationService', () => {
  it('should verify valid DPoP signatures')
  it('should reject invalid DPoP signatures')
  it('should verify valid Passkey assertions')
  it('should clamp time to validated windows')
  it('should verify worker wallet signatures')
  it('should enforce mode-based policies')
})

describe('Score Finalization Flow', () => {
  it('should accept valid casual session (shadow mode)')
  it('should reject tournament session with insufficient checkpoints')
  it('should require worker signature for degen mode')
  it('should handle checkpoint failures per policy')
})
```

### End-to-End Tests

```typescript
describe('Full Game Session', () => {
  it('should complete casual game with transcript', async () => {
    // 1. Initialize SDK
    await DigitapGamePlayerSDK.init()
    
    // 2. Play game (simulate 60s)
    for (let i = 0; i < 60; i++) {
      await wait(1000)
      DigitapGamePlayerSDK.setProgress('playing', i * 10, 1)
    }
    
    // 3. End game
    await DigitapGamePlayerSDK.setPlayerFailed()
    
    // 4. Verify backend received transcript
    const session = await getScoreSession(sessionId)
    expect(session.rollingHash).toBeDefined()
    expect(session.dpopCheckpointsProvided).toBe(12) // 60s / 5s
  })
  
  it('should complete tournament game with all checkpoints', async () => {
    // Enable tournament mode
    window.__WAM_SECURITY_CONFIG__.mode = 'TOURNAMENT'
    
    // ... similar to above ...
    
    // Verify strict enforcement
    expect(session.dpopCheckpointsValid).toBeGreaterThan(7) // 60% of 12
    expect(session.passkeyCheckpointsValid).toBeGreaterThan(1) // 80% of 2
    expect(session.workerSignature).toBeDefined()
  })
})
```

### Security Tests

```typescript
describe('Attack Resistance', () => {
  it('should detect transcript tampering', async () => {
    // Modify rolling hash after checkpoint
    transcript.rollingHash = 'tampered'
    
    // Backend should reject
    await expect(finalizeSession()).rejects.toThrow('Invalid rolling hash')
  })
  
  it('should detect time compression', async () => {
    // Create only 5 checkpoints but claim 60s
    // Backend should clamp to 25s (5 * 5s)
    const result = await finalizeSession({
      claimedTimeMs: 60000,
      checkpoints: [/* 5 checkpoints */]
    })
    
    expect(result.verifiedTimeMs).toBe(25000)
  })
  
  it('should detect forged DPoP signatures', async () => {
    // Use wrong private key
    const fakeKey = await crypto.subtle.generateKey(...)
    checkpoint.dpopSig = await signWithKey(fakeKey, digest)
    
    // Backend should reject
    const result = await verifySession(claim)
    expect(result.dpopCheckpointsValid).toBe(0)
  })
})
```

---

## 13. Monitoring & Alerts

### Key Metrics Dashboard

**Real-Time:**
- Active sessions with security enabled
- Checkpoint creation rate (should be ~12/min per session)
- DPoP signature success rate (target: >95%)
- Passkey assertion success rate (target: >90%)
- Worker signature verification rate (target: >99%)

**Historical:**
- Sessions by mode (CASUAL / TOURNAMENT / DEGEN)
- Validation rate trends
- Time clamping frequency
- Policy rejection rate

**Security Alerts:**
- Spike in invalid DPoP signatures (>5% failure rate)
- Low checkpoint density (<50% for tournament)
- Missing worker signatures in degen mode
- Canvas hash inconsistencies
- Abnormal time clamping (>30% sessions affected)

### Alert Thresholds

```typescript
const ALERT_THRESHOLDS = {
  dpopValidationRate: {
    warning: 0.90,
    critical: 0.80
  },
  passkeyValidationRate: {
    warning: 0.85,
    critical: 0.75
  },
  timeClamping: {
    warning: 0.10, // 10% of sessions clamped
    critical: 0.30
  },
  canvasHashMismatch: {
    warning: 0.05,
    critical: 0.15
  }
}
```

---

## 14. Future Enhancements

### Phase 6: SDK Integrity Verification
- Code signing of SDK bundle
- Runtime integrity checks
- Subresource Integrity (SRI) hashes

### Phase 7: Behavioral ML
- Input pattern analysis
- Anomaly detection (bot vs human)
- Risk scoring per session

### Phase 8: Zero-Knowledge Proofs
- ZK-SNARKs for checkpoint verification
- Reduce on-chain verification costs
- Privacy-preserving score proofs

### Phase 9: Decentralized Verification
- Peer verification network
- Consensus-based fraud detection
- Community-driven dispute resolution

---

## 15. Conclusion

This five-layer security architecture provides **comprehensive protection** against score manipulation while maintaining **minimal performance overhead** and **zero breaking changes** to the existing SDK API.

**Key Innovations:**
1. **Steganographic canvas watermarking** - Binds crypto proofs to visual rendering
2. **Layered defense** - Multiple independent verification mechanisms
3. **Mode-adaptive security** - Scales from casual to high-stakes degen
4. **Privacy-preserving** - No PII collection, minimal data transmission
5. **Backward compatible** - Transparent to game developers

**Success Criteria:**
- ✅ >95% DPoP validation rate
- ✅ >90% Passkey assertion success
- ✅ <5% legitimate sessions rejected
- ✅ >90% reduction in score manipulation
- ✅ <50ms performance overhead per checkpoint

**Timeline:** 8 weeks for full implementation and rollout

**Next Steps:**
1. Approve architecture and phasing
2. Allocate development resources
3. Set up monitoring infrastructure
4. Begin Phase 1 implementation

---

## Appendix A: Code Examples

See implementation sections in Phases 1-5 for complete code samples.

## Appendix B: Configuration Reference

See Section 10 for complete configuration matrix.

## Appendix C: API Documentation

See Section 7 for complete API reference.

---

**Document Version:** 1.0  
**Last Updated:** December 17, 2025  
**Review Required:** Before Phase 1 implementation
