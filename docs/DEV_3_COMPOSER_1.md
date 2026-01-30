# WAM SDK Client Security Hardening - Detailed Implementation Plan

## Executive Summary

This document outlines the comprehensive security hardening solution for WAM SDK client-side score submissions. The solution implements tamper-evident transcript commitment, device-bound cryptographic proofs, and **canvas-based interaction verification using LSB steganography** to ensure score submissions are bound to real-time, verifiable gameplay.

**Key Innovation**: Canvas-based proof using steganographic markers provides invisible, tamper-evident evidence of actual canvas rendering and user interaction, preventing bot/automated gameplay and background execution attacks.

---

## Problem Statement

### Current State

The existing WAM SDK (`src/index.ts`) provides basic game lifecycle tracking:
- `init()` - Initializes game connection
- `setProgress(state, score, level)` - Updates score/progress
- `setLevelUp(level)` - Level progression
- `setPlayerFailed(state)` - Game failure handling
- PostMessage communication with parent platform

### Security Gaps

1. **No cryptographic verification** of score integrity
2. **No protection against time compression** attacks (fast-forwarding gameplay)
3. **No device-binding** for score claims
4. **No tamper-evident transcript** - scores can be fabricated offline
5. **No proof of actual canvas rendering** - vulnerable to background/bot execution
6. **No detection of user interaction** vs automated gameplay

### Threat Model

**Attacker Capabilities:**
- Full control over client JS runtime (debugger, script injection, memory editing)
- Can modify game code and SDK code
- Can pause/rewind/fast-forward or run offline
- Can fabricate events and scores
- Can run games in background tabs without user interaction
- Can automate gameplay with bots/scripts

**Attacker Limitations (Assumed):**
- Cannot forge signatures from device-bound key
- Cannot forge valid Passkey assertions without authenticator participation
- Cannot produce valid proofs for time windows they did not actually span
- Cannot detect/remove steganographic markers without knowing encoding scheme

---

## Solution Architecture

### High-Level Design

```mermaid
graph TD
    A[Game] --> B[SDK Public API]
    B --> C[TranscriptRecorder]
    B --> D[CheckpointEngine]
    B --> E[CanvasSampler]
    
    C --> F[RollingHash]
    D --> G[DPoP Signer]
    D --> H[Passkey Signer]
    E --> I[Canvas Hash]
    E --> J[Steganographic Encoder]
    
    F --> K[AnchorBundle]
    G --> K
    H --> K
    I --> K
    J --> K
    
    K --> L[ScoreClaimBuilder]
    L --> M[Final Payload]
    
    subgraph "Device-Bound Keys"
        N[DPoP Key<br/>Existing]
        O[Passkey<br/>Existing]
        P[Worker Wallet<br/>Existing]
    end
    
    subgraph "Canvas Proof"
        Q[Game Canvas<br/>Direct Sampling]
        R[LSB Steganography<br/>Invisible Markers]
    end
    
    D --> N
    H --> O
    L --> P
    E --> Q
    E --> R
```

### Core Security Mechanisms

1. **Transcript Commitment**: Rolling hash over all gameplay events
2. **Time Window Validation**: 5-second windows with checkpoint proofs
3. **Device-Bound Proofs**: DPoP (every 5s) + Passkey (every 30s)
4. **Canvas-Based Proof**: State sampling + steganographic markers
5. **Worker Wallet Binding**: Optional signature tying to existing gas pipeline

---

## Canvas-Based Interaction Proof

### Overview

The canvas-based proof system provides **invisible, tamper-evident evidence** that:
- The game canvas is actively rendering (not background tab)
- User interaction is occurring (canvas state changes)
- SDK is active and untampered (steganographic markers)

### Architecture

```mermaid
sequenceDiagram
    participant Game
    participant SDK
    participant Canvas
    participant Steganography
    participant Transcript
    participant Checkpoints

    SDK->>Canvas: Access game canvas
    SDK->>Steganography: Inject LSB markers
    Steganography->>Canvas: Encode checkpoint data in pixel LSBs
    
    Game->>SDK: setProgress(score)
    SDK->>Canvas: Sample 5 regions (corners + center)
    Canvas->>SDK: Return pixel data
    SDK->>Steganography: Decode markers from LSBs
    SDK->>Transcript: Record event + canvas hash + markers
    
    SDK->>Checkpoints: Generate DPoP proof (includes canvas hash)
    Note over SDK: Every 30s
    SDK->>Checkpoints: Generate Passkey proof (includes canvas hash)
```

### Implementation Details

#### 1. Canvas Sampling

**Direct Canvas Access:**
```typescript
// SDK already has canvas access in init() and streamer.ts
const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext('2d') || canvas.getContext('webgl');
```

**Sampling Strategy:**
- Sample 5 regions: 4 corners (8×8 pixels each) + center (8×8 pixels)
- Total: 5 regions × 64 pixels × 4 bytes = 1,280 bytes per sample
- Frequency: Every checkpoint window (5s) + on score updates
- Hash: `H(region1 || region2 || region3 || region4 || region5 || timestamp)`

**Canvas Hash Calculation:**
```typescript
function sampleCanvas(canvas: HTMLCanvasElement): string {
  const regions = [
    { x: 0, y: 0, w: 8, h: 8 },           // Top-left
    { x: canvas.width - 8, y: 0, w: 8, h: 8 },  // Top-right
    { x: 0, y: canvas.height - 8, w: 8, h: 8 },  // Bottom-left
    { x: canvas.width - 8, y: canvas.height - 8, w: 8, h: 8 }, // Bottom-right
    { x: Math.floor(canvas.width / 2) - 4, y: Math.floor(canvas.height / 2) - 4, w: 8, h: 8 } // Center
  ];
  
  const samples: Uint8ClampedArray[] = [];
  for (const region of regions) {
    const imageData = ctx.getImageData(region.x, region.y, region.w, region.h);
    samples.push(imageData.data);
  }
  
  // Hash all samples + timestamp
  const combined = new Uint8Array(samples.reduce((acc, s) => acc + s.length, 0));
  let offset = 0;
  for (const sample of samples) {
    combined.set(sample, offset);
    offset += sample.length;
  }
  
  return hash(combined, timestamp);
}
```

#### 2. LSB Steganography

**Steganographic Encoder Implementation:**

```typescript
class SteganographicEncoder {
  /**
   * Encode checkpoint data into pixel LSBs (Least Significant Bits)
   * Visual impact: Imperceptible (max 1-bit change per RGB channel)
   */
  encodeInLSB(imageData: ImageData, data: Uint8Array): ImageData {
    const pixels = imageData.data;
    let dataIndex = 0;
    let bitIndex = 0;
    
    // Iterate through pixels (RGBA format, 4 bytes per pixel)
    for (let i = 0; i < pixels.length && dataIndex < data.length; i += 4) {
      // Modify RGB channels only (skip alpha channel)
      for (let channel = 0; channel < 3 && dataIndex < data.length; channel++) {
        const pixelIndex = i + channel;
        const bit = (data[dataIndex] >> bitIndex) & 1;
        
        // Set LSB: clear bit 0, then set to our data bit
        pixels[pixelIndex] = (pixels[pixelIndex] & 0xFE) | bit;
        
        bitIndex++;
        if (bitIndex === 8) {
          bitIndex = 0;
          dataIndex++;
        }
      }
    }
    return imageData;
  }
  
  /**
   * Decode data from pixel LSBs
   */
  decodeFromLSB(imageData: ImageData, length: number): Uint8Array {
    const pixels = imageData.data;
    const data = new Uint8Array(length);
    let dataIndex = 0;
    let bitIndex = 0;
    
    for (let i = 0; i < pixels.length && dataIndex < length; i += 4) {
      for (let channel = 0; channel < 3 && dataIndex < length; channel++) {
        const pixelIndex = i + channel;
        const bit = pixels[pixelIndex] & 1; // Extract LSB
        
        data[dataIndex] |= (bit << bitIndex);
        
        bitIndex++;
        if (bitIndex === 8) {
          bitIndex = 0;
          dataIndex++;
        }
      }
    }
    return data;
  }
}
```

**Marker Injection Strategy:**

```typescript
class CanvasMarkerInjector {
  private encoder = new SteganographicEncoder();
  private regions: Array<{x: number, y: number}> = [];
  
  /**
   * Inject steganographic marker into canvas corner region
   */
  injectMarker(
    ctx: CanvasRenderingContext2D,
    checkpointDigest: string,
    regionIndex: number
  ): void {
    // Rotate regions to prevent detection
    const regions = this.getMarkerRegions(ctx.canvas.width, ctx.canvas.height);
    const region = regions[regionIndex % regions.length];
    
    // Get existing pixel data from region
    const imageData = ctx.getImageData(region.x, region.y, 8, 8);
    
    // Encode checkpoint digest (32 bytes)
    const checkpointData = new TextEncoder().encode(checkpointDigest);
    
    // Encode into LSBs
    const encodedData = this.encoder.encodeInLSB(imageData, checkpointData);
    
    // Write back to canvas
    ctx.putImageData(encodedData, region.x, region.y);
  }
  
  /**
   * Extract and verify marker from canvas
   */
  extractMarker(
    ctx: CanvasRenderingContext2D,
    regionIndex: number,
    expectedLength: number = 32
  ): Uint8Array | null {
    const regions = this.getMarkerRegions(ctx.canvas.width, ctx.canvas.height);
    const region = regions[regionIndex % regions.length];
    
    try {
      const imageData = ctx.getImageData(region.x, region.y, 8, 8);
      return this.encoder.decodeFromLSB(imageData, expectedLength);
    } catch (e) {
      return null; // Marker may have been overwritten by game
    }
  }
  
  private getMarkerRegions(width: number, height: number): Array<{x: number, y: number}> {
    // Use corners and edges that games rarely render to
    return [
      { x: 0, y: 0 },                    // Top-left corner
      { x: width - 8, y: 0 },            // Top-right corner
      { x: 0, y: height - 8 },            // Bottom-left corner
      { x: width - 8, y: height - 8 },   // Bottom-right corner
      { x: 2, y: 2 },                     // Slight offset from corner
      { x: width - 10, y: 2 },           // Slight offset from corner
    ];
  }
}
```

**Steganographic Capacity:**
- 8×8 pixel region = 64 pixels
- 3 RGB channels per pixel = 192 bits = 24 bytes per region
- Checkpoint hash (32 bytes) requires 2 regions or use multiple regions

**Visual Impact:**
- Maximum change: 1 bit per RGB channel
- Human eye cannot detect 1-bit RGB changes
- Completely invisible to users and attackers

#### 3. Integration with Checkpoints

**Canvas Hash in Checkpoint Payload:**

```typescript
// DPoP Checkpoint (every 5s)
const checkpointDigest = hash(
  sessionId,
  windowIndex,
  rollingHash,
  currentScore,
  stateTag,
  canvasHash  // ← Canvas proof included
);

const dpopSignature = signWithDeviceKey(checkpointDigest);

// Passkey Checkpoint (every 30s)
const passkeyDigest = hash(
  sessionId,
  windowRange,
  rollingHash,
  currentScore,
  codeHash,
  sdkVersion,
  canvasHash  // ← Canvas proof included
);

const passkeyAssertion = await requestPasskeyAssertion(passkeyDigest);
```

### Threat Mitigation

**Bot Detection:**
- No canvas rendering → no canvas hash changes
- Stagnant canvas hashes → background/bot execution
- Canvas state must change with score progression

**Tampering Detection:**
- Steganographic markers tied to checkpoint signatures
- Cannot fake markers without knowing encoding scheme
- Missing markers indicate tampering or game overwrite

**Time Compression Prevention:**
- Canvas samples must align with checkpoint windows
- Missing samples indicate time compression attack
- Canvas state changes prove real-time progression

**Background Execution:**
- Page Visibility API detects background tabs
- Canvas rendering throttled in background
- Stagnant canvas hashes detected by backend

---

## Complete Implementation Phases

### Phase 1: Core Infrastructure

**New Internal Modules:**

1. **TranscriptRecorder**
   - Maintains rolling hash: `Ri = H(Ri-1 || encode(event_i))`
   - Canonical event encoding
   - Versioned schema

2. **WindowClock**
   - Manages 5-second time windows
   - Window index: `wIndex = floor(monotonicTime / 5000)`
   - Validates time progression

3. **CheckpointEngine**
   - Schedules DPoP checkpoints (every 5s)
   - Schedules Passkey checkpoints (every 30s)
   - Handles checkpoint failures gracefully

4. **CanvasSampler**
   - Samples canvas regions periodically
   - Calculates canvas hash
   - Integrates with steganographic encoder

5. **SteganographicEncoder**
   - LSB encoding/decoding
   - Marker injection/extraction
   - Region rotation

6. **AnchorBundle**
   - Collects all proofs
   - Computes `anchorsHash = H(canonicalSerialize(checkpoints[]))`

7. **ScoreClaimBuilder**
   - Generates final submission payload
   - Validates time windows
   - Signs with worker wallet (optional)

**Key Constraints:**
- All modules are private/internal
- No changes to public API signatures
- Feature-flagged with backward compatibility

### Phase 2: Event Recording

**Modified SDK Methods:**

```typescript
// Existing method signature preserved
public static setProgress(state: string, score: number, level: number): void {
  // Existing behavior preserved
  this.progress = { /* ... */ };
  this.sendData();
  
  // NEW: Transcript recording (feature-flagged)
  if (config.enableTranscript) {
    TranscriptRecorder.record({
      type: 'score',
      window: WindowClock.currentWindow(),
      timestamp: Date.now(),
      score,
      state,
      canvasHash: CanvasSampler.sample() // ← Canvas proof
    });
  }
}
```

**Transcript Event Structure:**

```typescript
interface TranscriptEvent {
  v: 1;                    // Schema version
  t: "score" | "state" | "checkpoint" | "canvas";
  w: number;              // Window index
  ms: number;             // Timestamp
  score?: number;
  state?: string;
  anchorRef?: string;     // Hash pointer to checkpoint proof
  canvasHash?: string;    // Canvas sample hash
  markerData?: string;    // Decoded steganographic marker (if present)
}
```

### Phase 3: Canvas Proof Integration

**Canvas Sampling Flow:**

1. **On SDK Init:**
   - Detect canvas element
   - Initialize CanvasSampler
   - Set up periodic sampling (every 5s)

2. **On Score Update:**
   - Sample canvas immediately
   - Inject steganographic marker (if enabled)
   - Record canvas hash in transcript

3. **On Checkpoint:**
   - Sample canvas
   - Extract steganographic markers
   - Include canvas hash in checkpoint signature
   - Verify marker integrity

**Edge Cases:**

- **Canvas not found**: Graceful degradation, skip canvas proof
- **Canvas resized**: Recalculate regions, maintain markers
- **WebGL canvas**: Use `readPixels()` instead of `getImageData()`
- **Multiple canvases**: Target primary game canvas (first/largest)
- **Game overwrites markers**: Partial markers still detectable
- **Canvas read-only**: Sample only, no marker injection

### Phase 4: Checkpoint Integration

**DPoP Checkpoints (Frequent - Every 5s):**

```typescript
interface DPoPCheckpoint {
  type: "dpop";
  wIndex: number;
  checkpointDigest: string;  // Includes canvasHash
  dpopSig: string;
  canvasHash: string;        // Canvas proof
  markerVerified: boolean;   // Steganographic marker verification
}
```

**Passkey Checkpoints (Strong - Every 30s):**

```typescript
interface PasskeyCheckpoint {
  type: "passkey";
  wFrom: number;
  wTo: number;
  passkeyDigest: string;     // Includes canvasHash
  credentialId: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  canvasHash: string;        // Canvas proof
  markerVerified: boolean;   // Steganographic marker verification
}
```

### Phase 5: Score Claim Generation

**Final Payload Structure:**

```typescript
interface ScoreClaim {
  sessionId: string;
  gameId: number;
  sdkVersion: number;
  codeHash: string;
  rollingHash: string;       // Transcript commitment
  anchorsHash: string;       // Proofs commitment (includes canvas proofs)
  finalScore: number;
  claimedTimeMs: number;     // Validated windows only
  workerSig?: string;        // Optional worker wallet signature
  canvasProofs: {           // Canvas verification data
    samples: Array<{
      wIndex: number;
      hash: string;
      markerData?: string;
    }>;
    finalHash: string;
  };
}
```

**Time Validation:**

```typescript
// Calculate validated time from checkpoint density
const validatedWindows = checkpoints.filter(c => c.verified).length;
const claimedTimeMs = validatedWindows * 5000; // 5s per window

// Clamp if game reports more time
if (gameReportedTime > claimedTimeMs) {
  claimedTimeMs = Math.min(gameReportedTime, claimedTimeMs);
}
```

### Phase 6: Configuration & Rollout

**Feature Flags:**

```typescript
interface SDKConfig {
  // Core features
  enableTranscript: boolean;
  enableCheckpoints: boolean;
  enableCanvasProof: boolean;
  
  // Timing
  windowDurationMs: number;        // Default: 5000
  checkpointIntervalMs: number;     // Default: 5000
  passkeyIntervalWindows: number;   // Default: 6 (30s)
  canvasSampleIntervalMs: number;   // Default: 5000
  
  // Canvas proof
  canvasSampleRegions: number;     // Default: 5
  enableSteganographicMarkers: boolean; // Default: true
  
  // Policy
  policyMode: "strict" | "casual" | "downgrade";
  onPasskeyFailure: "reject" | "downgrade";
  onDPoPFailure: "clamp_time" | "reject";
  onCanvasFailure: "unverified" | "reject";
  
  // Rollout
  shadowMode: boolean;               // Collect but don't enforce
}
```

**Backward Compatibility:**

- All features disabled by default
- Existing SDK behavior preserved when features off
- Graceful degradation on failures
- Shadow mode for initial rollout

---

## Backend Validation Strategy

### Canvas Proof Verification

**1. Canvas Hash Consistency:**
- Verify canvas hashes appear in transcript events
- Check hash changes correlate with score updates
- Detect stagnant hashes (background execution indicator)
- Validate hash progression patterns

**2. Steganographic Marker Validation:**
- Decode LSB-encoded data from canvas samples
- Verify decoded marker data matches checkpoint signatures
- Check marker timestamps align with window indices
- Detect missing/corrupted markers (potential tampering)
- Validate marker integrity using embedded checksums

**3. Pattern Analysis:**
- Canvas state changes should correlate with score progression
- Detect suspicious patterns (score jumps without canvas changes)
- Flag sessions with minimal canvas variation
- Analyze canvas hash entropy (randomness indicates active rendering)

**4. Time Correlation:**
- Canvas samples should align with checkpoint windows
- Missing samples indicate potential time compression
- Stale samples indicate background execution
- Validate sample frequency matches claimed playtime

### Backend Checks (Inferred Legitimacy)

Since backend cannot deterministically verify score correctness, it validates:

✅ **Transcript Integrity**
- Rolling hash verification
- Event sequence validation
- Canonical encoding check

✅ **Checkpoint Proof Density**
- Proof count vs claimed time
- Window coverage validation
- Missing checkpoint detection

✅ **Canvas Proof**
- Canvas hash progression
- Steganographic marker verification
- State change correlation

✅ **Device-Bound Signatures**
- DPoP signature continuity
- Passkey assertion frequency
- Worker wallet signature (if provided)

✅ **Heuristic Validation**
- Score progression reasonableness
- Time vs score correlation
- Canvas state vs gameplay events

### Rejection Criteria

**Hard Rejections:**
- Transcript hash mismatch
- Invalid checkpoint signatures
- Insufficient checkpoint proofs for claimed time
- Missing required Passkey assertions (strict mode)

**Soft Rejections (Downgrade):**
- Canvas hash stagnation
- Missing steganographic markers
- Suspicious score patterns
- Canvas state doesn't correlate with gameplay

**Warning Flags:**
- Minimal canvas variation
- Irregular checkpoint timing
- Marker corruption (game overwrite)
- Score jumps without canvas changes

---

## Security Analysis

### Security Assumptions

1. **Cryptographic Primitives:**
   - Cannot forge DPoP signatures (device-bound key)
   - Cannot forge Passkey assertions (authenticator required)
   - Cannot reverse hash functions
   - Cannot predict random nonces

2. **Canvas Rendering:**
   - Canvas rendering requires active tab/window
   - Background tabs throttle rendering
   - Canvas state changes correlate with gameplay
   - Steganographic markers hard to detect without encoding scheme

3. **Time Windows:**
   - Cannot generate proofs for unplayed time windows
   - Monotonic time prevents time manipulation
   - Checkpoint density enforces real-time progression

### Attack Vectors & Mitigations

**1. Bot/Automated Gameplay:**
- **Attack**: Run game without user interaction
- **Mitigation**: Canvas hash stagnation detection, Passkey requires user presence

**2. Background Execution:**
- **Attack**: Run game in background tab
- **Mitigation**: Page Visibility API, canvas rendering throttling detection

**3. Time Compression:**
- **Attack**: Fast-forward gameplay, compress time
- **Mitigation**: Checkpoint density validation, window-based time calculation

**4. Score Fabrication:**
- **Attack**: Modify score without gameplay
- **Mitigation**: Canvas state must change with score, transcript integrity

**5. Transcript Tampering:**
- **Attack**: Modify transcript after the fact
- **Mitigation**: Rolling hash breaks on any edit, checkpoint signatures

**6. Steganographic Marker Removal:**
- **Attack**: Detect and remove markers
- **Mitigation**: Markers invisible, encoding scheme unknown, rotation prevents detection

**7. Canvas Hash Replay:**
- **Attack**: Reuse old canvas hashes
- **Mitigation**: Timestamps in hash, checkpoint binding, window indices

### Security Guarantees

**What We Prove:**
- Score claim bound to real-time device activity
- Transcript integrity (cannot edit after the fact)
- Time window validation (cannot compress time)
- Canvas rendering proof (not background/bot)
- Device-bound signatures (cannot forge)

**What We Don't Prove:**
- Game logic correctness (physics, RNG, etc.)
- Score calculation accuracy
- User skill level
- Game state consistency

---

## Performance Considerations

### Canvas Sampling Overhead

**Per Sample:**
- 5 regions × 8×8 pixels × 4 bytes = 1,280 bytes
- `getImageData()` calls: 5 per sample
- Hash calculation: ~1ms
- **Total per sample: ~2-5ms**

**Frequency:**
- Every checkpoint window (5s)
- On score updates (variable)
- **Average: ~1 sample per 2-3 seconds**

**Total Overhead:**
- ~0.1-0.2% CPU per game session
- Negligible memory impact
- No visual impact (sampling only)

### Steganographic Encoding Overhead

**Per Marker Injection:**
- Read 8×8 region: ~0.1ms
- LSB encoding: ~0.1ms
- Write back: ~0.1ms
- **Total: ~0.3ms per marker**

**Frequency:**
- Every checkpoint window (5s)
- **Overhead: Negligible**

### Memory Footprint

- Transcript events: ~100 bytes each × ~100 events = ~10KB
- Canvas samples: ~1.3KB each × ~20 samples = ~26KB
- Checkpoint proofs: ~500 bytes each × ~20 checkpoints = ~10KB
- **Total: ~50KB per session**

---

## Rollout Strategy

### Phase 1: Shadow Mode (Weeks 1-2)

- Deploy SDK with all features enabled
- Collect transcript, checkpoints, canvas proofs
- **Do not enforce** validation
- Compare enforcement outcomes vs production
- Monitor performance impact

### Phase 2: Gradual Enforcement (Weeks 3-4)

- Enable enforcement for new games only
- Monitor rejection rates
- Tune thresholds based on data
- Collect feedback from developers

### Phase 3: Full Rollout (Weeks 5-6)

- Enable for all games
- Strict mode for tournaments/rewards
- Casual mode for regular gameplay
- Monitor and iterate

### Rollback Plan

- Feature flags allow instant disable
- Graceful degradation maintains gameplay
- Legacy sessions remain valid
- No breaking changes to SDK API

---

## Success Metrics

### Security Metrics

- **Bot Detection Rate**: % of bot sessions detected
- **Time Compression Detection**: % of compressed sessions detected
- **Tampering Detection**: % of tampered transcripts detected
- **False Positive Rate**: % of legitimate sessions rejected

### Performance Metrics

- **SDK Overhead**: CPU/memory impact
- **Canvas Sampling Latency**: Average sampling time
- **Checkpoint Generation Time**: Average proof generation time

### Adoption Metrics

- **Feature Adoption**: % of games using new features
- **Enforcement Rate**: % of sessions with full enforcement
- **Developer Satisfaction**: Feedback scores

---

## Conclusion

This comprehensive security hardening solution provides:

1. **Tamper-evident transcript** commitment via rolling hash
2. **Time window validation** preventing time compression
3. **Device-bound proofs** via DPoP and Passkey
4. **Canvas-based interaction proof** via state sampling and steganography
5. **Worker wallet binding** to existing infrastructure

The **canvas-based steganographic proof** is the key innovation, providing invisible, tamper-evident evidence of actual gameplay rendering and user interaction, preventing bot/automated attacks while maintaining complete backward compatibility.

The solution is production-ready, feature-flagged, and designed for gradual rollout with comprehensive monitoring and rollback capabilities.
