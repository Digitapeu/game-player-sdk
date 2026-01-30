# WAM SDK Security: Team Analysis & Synthesis Report

**Analysis Date:** December 17, 2025  
**Comparative Analysis of:** GPT-5.2 | Opus 4.5 | Composer 1 | Sonnet 4.5

---

## Executive Summary

This document synthesizes four independent security architecture proposals for WAM SDK score hardening. Each proposal brings unique insights and approaches to solving the same core problem: **secure, verifiable score submissions from untrusted HTML5 game clients**.

### Key Finding

All four proposals converge on **similar core primitives** but differ significantly in **architecture philosophy** and **implementation complexity**. The optimal solution combines the best elements from each approach.

---

## Comparative Overview

| Aspect | GPT-5.2 | Opus 4.5 | Composer 1 | Sonnet 4.5 |
|--------|---------|----------|------------|------------|
| **Philosophy** | Server-paced time gates | Input-bound hashing | Canvas steganography only | Multi-layer defense |
| **Time Validation** | Backend time oracle | Checkpoint density | Backend time oracle | Checkpoint density |
| **Canvas Proof** | Not addressed | Sampling + watermark loop | LSB steganography | Sampling + watermarking |
| **Architecture** | Parent-controlled | SDK-controlled | SDK-controlled | SDK-controlled |
| **Complexity** | Low | High | Medium-High | Very High (5 layers) |
| **Backend Dependency** | High (per-window) | Low (on-demand) | Low (session-end) | Medium (periodic) |
| **Data Transfer** | ~600 bytes | ~500 bytes | ~500 bytes | ~600 bytes |
| **Backward Compat** | Excellent | Good | Excellent | Excellent |

---

## Section 1: Novel Ideas & Innovations

### 1.1 GPT-5.2: Server-Paced Time Oracle

**Novel Concept:**
```
Backend is the authoritative time source. Client cannot validate 
windows faster than real-time because server refuses to advance.
```

**Key Innovation:**
- `/score/session/checkpoint` endpoint enforces `now >= nextWindowAt`
- Server-issued nonces per window prevent pre-computation
- Single-step issue+verify reduces round trips

**Strength:**
- **Strongest time validation** (server is ground truth)
- No client-side timing tricks can bypass

**Weakness:**
- High network dependency (every 5s)
- Latency-sensitive (poor mobile experience)
- Backend scaling challenges

**Verdict:** ✅ **Use for high-stakes modes (Degen)**, ⚠️ **Too heavy for casual**

---

### 1.2 Opus 4.5: Input-Bound Rolling Hash

**Novel Concept:**
```
R_i = H(R_{i-1} || score || inputDigest || canvasSample || watermark)

Hash chain depends on actual user input, making fabrication 
require real interaction.
```

**Key Innovation:**
- Input events hashed into transcript
- Input sketch (64-byte behavioral fingerprint)
- Bot detection via statistical analysis

**Strength:**
- **Strongest bot detection** mechanism
- Input patterns prove human interaction
- 64-byte sketch is bandwidth-efficient

**Weakness:**
- Input recording = privacy concerns (even if hashed)
- Behavioral classification needs ML training
- Input patterns can be spoofed by sophisticated bots

**Verdict:** ✅ **Essential for bot detection**, ⚠️ **Needs privacy safeguards**

---

### 1.3 Opus 4.5: Closed-Loop Canvas Watermarking

**Novel Concept:**
```
Window N:
├── expectedWatermark = truncate(H(R_{N-1}), 16)
├── embedWatermark(canvas, expectedWatermark)
├── [Game renders frame - watermark persists]
├── extractedWatermark = extractWatermark(canvas)
├── R_N = H(R_{N-1} || ... || extractedWatermark)

Circular dependency requires live canvas rendering.
```

**Key Innovation:**
- Watermark at window N depends on R_{N-1}
- R_N depends on extracting that watermark
- **Cannot pre-compute chain without live canvas**

**Strength:**
- **Strongest canvas proof** (closed-loop dependency)
- Mathematically unforgeable
- Defeats pre-rendering attacks

**Weakness:**
- Watermark may be overwritten by game
- Extraction failures break the chain
- More complex than simple sampling

**Verdict:** ✅ **Best canvas proof design**, ⚠️ **Needs robust fallback for overwritten markers**

---

### 1.4 Composer 1: LSB Steganography Implementation

**Novel Concept:**
```typescript
// Encode checkpoint data into canvas corner pixel LSBs
pixels[pixelIdx] = (pixels[pixelIdx] & 0xFE) | bit;
```

**Key Innovation:**
- Detailed LSB encoding/decoding algorithms
- Region rotation strategy (corners + edges)
- Visual imperceptibility analysis

**Strength:**
- **Most production-ready steganography code**
- Complete implementation examples
- Capacity calculations (24 bytes per 8×8 region)

**Weakness:**
- Doesn't leverage closed-loop like Opus
- Markers can be overwritten without detection

**Verdict:** ✅ **Best implementation reference**, ⚠️ **Should adopt Opus's closed-loop**

---

### 1.5 Sonnet 4.5: Five-Layer Defense Architecture

**Novel Concept:**
```
Layer 1: Transcript Integrity (Rolling Hash)
Layer 2: Visual Binding (Canvas Watermarks)
Layer 3: Device Binding (DPoP Signatures)
Layer 4: User Presence (Passkey Assertions)
Layer 5: Identity Binding (Worker Wallet Signatures)
```

**Key Innovation:**
- Defense in depth (redundancy)
- Each layer addresses different attack vector
- Mode-adaptive security (Casual → Degen escalation)

**Strength:**
- **Most comprehensive threat coverage**
- Redundancy prevents single-point failures
- Clear escalation path

**Weakness:**
- **Highest complexity** (may be over-engineered)
- Performance overhead from all layers
- Difficult to debug issues

**Verdict:** ⚠️ **Too complex for initial rollout**, ✅ **Good long-term target**

---

## Section 2: Architecture Comparison

### 2.1 Execution Context: Parent vs SDK

**GPT-5.2 (Parent-Controlled):**
```
Game iframe (untrusted)
    ↓ postMessage
Parent container (trusted-by-policy)
    ↓ owns crypto + networking
Backend
```

**Pros:**
- Crypto keys stay in trusted context
- Game cannot tamper with SDK security
- Clean separation of concerns

**Cons:**
- Requires platform integration changes
- More complex message passing
- Higher latency (extra hop)

**Others (SDK-Controlled):**
```
Game iframe (SDK injected)
    ↓ direct networking
Backend
```

**Pros:**
- Simpler integration
- Lower latency
- Faster to ship

**Cons:**
- Game can tamper with SDK
- Keys accessible to game code
- Requires SDK integrity checks

**Recommendation:** 
- **Phase 1**: SDK-controlled (faster to ship)
- **Phase 2**: Migrate to parent-controlled (better security)

---

### 2.2 Time Validation Approach

**GPT-5.2: Server-Paced (Backend Time Oracle)**

```typescript
// Backend enforces time gate
if (now < nextWindowAt) {
  return { error: 'retryAfterMs', retryAfter: nextWindowAt - now };
}
```

**Pros:**
- Server is authoritative time source
- Client cannot compress time
- Simple to reason about

**Cons:**
- Network-dependent (fails offline)
- Latency adds jitter to windows
- Backend load scales with active sessions

---

**Opus/Sonnet: Client-Paced (Checkpoint Density)**

```typescript
// Client generates checkpoints freely
// Backend validates density after the fact
const validatedWindows = verifiedCheckpoints.length;
const claimedTimeMs = validatedWindows * 5000;
```

**Pros:**
- Works offline (validate later)
- No per-window backend calls
- Scales better

**Cons:**
- Time compression possible within windows
- Requires DPoP key security
- More complex validation logic

---

**Recommendation:**
```
Hybrid Approach:
- Casual mode: Client-paced (best UX)
- Tournament mode: Client-paced with threshold enforcement
- Degen mode: Server-paced (best security)
```

---

### 2.3 Canvas Proof Techniques

**Opus 4.5: Closed-Loop Watermarking**

```
Strengths:
- Mathematically unforgeable
- Circular dependency requires live rendering
- Best theoretical security

Weaknesses:
- Fragile (game overwriting markers breaks chain)
- Complex to debug
- Requires robust error handling
```

**Composer 1: Simple LSB Steganography**

```
Strengths:
- Robust to partial overwrites
- Easier to implement
- Good fallback mechanisms

Weaknesses:
- No closed-loop property
- Markers can be removed without detection
- Weaker security guarantees
```

**Sonnet 4.5: Canvas Sampling + Optional Watermarking**

```
Strengths:
- Dual approach (sampling always works)
- Watermarking adds extra layer
- Graceful degradation

Weaknesses:
- Sampling alone has lower security
- Two techniques = more code
- Not as strong as Opus's closed-loop
```

**Recommendation:**
```
Layered Approach:
1. Canvas sampling (always on, robust baseline)
2. Opus closed-loop watermarking (optional, highest security)
3. Fallback to sampling if watermarks fail
```

---

## Section 3: Implementation Synthesis

### 3.1 Optimal Architecture (Best of All Worlds)

**Core Architecture:**
```
┌─────────────────────────────────────────────────┐
│                   SDK Layer                      │
├─────────────────────────────────────────────────┤
│  TranscriptRecorder (Opus input-bound hash)     │
│  CanvasSampler (Sonnet robust sampling)         │
│  WatermarkEngine (Opus closed-loop)             │
│  CheckpointEngine (GPT server-paced for Degen)  │
│  InputSketch (Opus behavioral fingerprint)      │
└─────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────┐
│              Anchor Layer (Sonnet)              │
├─────────────────────────────────────────────────┤
│  DPoP Checkpoints (every 5s)                    │
│  Passkey Checkpoints (every 30s)                │
│  Worker Wallet Signature (optional)             │
└─────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────┐
│           Validation Layer (Backend)            │
├─────────────────────────────────────────────────┤
│  GPT: Time gate enforcement (Degen only)        │
│  Opus: Behavioral classification               │
│  Composer: Steganography verification           │
│  Sonnet: Multi-layer policy engine              │
└─────────────────────────────────────────────────┘
```

---

### 3.2 Rolling Hash Design (Best Practices)

**Adopt Opus's Input-Bound Approach:**

```typescript
// Strongest hash chain design
R_i = H(
  R_{i-1},              // Previous hash (prevents reordering)
  score_i,              // Current score
  level_i,              // Current level
  inputDigest_i,        // Opus: binds to user input
  canvasSample_i,       // Sonnet: robust baseline
  watermark_i,          // Opus: closed-loop proof
  timestamp_i           // Prevents replay
);
```

**Why This Works:**
- **Input binding** (Opus) → proves human interaction
- **Canvas sampling** (Sonnet) → robust fallback
- **Watermark loop** (Opus) → strongest canvas proof
- **Timestamp** → prevents replay attacks

---

### 3.3 Canvas Proof Implementation

**Layered Strategy:**

```typescript
interface CanvasProof {
  // Layer 1: Always-on sampling (Sonnet approach)
  sample: {
    hash: string;        // H(5 regions)
    regions: number;      // 5 (corners + center)
    timestamp: number;
  };
  
  // Layer 2: Optional watermarking (Opus closed-loop)
  watermark?: {
    embedded: string;    // H(R_{i-1}) truncated
    extracted: string;   // Decoded from canvas
    verified: boolean;   // Match check
  };
  
  // Layer 3: Verification metadata
  meta: {
    canvasAvailable: boolean;
    webGLContext: boolean;
    overwriteDetected: boolean;
  };
}
```

**Fallback Logic:**

```typescript
async function generateCanvasProof(): Promise<CanvasProof> {
  const proof: CanvasProof = {
    sample: await sampleCanvas(),    // Always attempt
    meta: { canvasAvailable: !!canvas }
  };
  
  // Attempt watermarking if enabled
  if (config.enableWatermarking && canvas) {
    try {
      const prevHash = transcript.getHash();
      await embedWatermark(canvas, prevHash);
      
      // Wait for frame render
      await nextFrame();
      
      const extracted = await extractWatermark(canvas);
      const expected = truncate(prevHash, 16);
      
      proof.watermark = {
        embedded: expected,
        extracted: bytesToHex(extracted),
        verified: extracted === expected
      };
    } catch (e) {
      proof.meta.overwriteDetected = true;
      // Fall back to sampling only
    }
  }
  
  return proof;
}
```

---

### 3.4 Input Sketch (Adopt Opus Wholesale)

**Opus's 64-byte behavioral fingerprint is brilliant:**

```typescript
interface InputSketch {
  // Timing (16 bytes)
  tapIntervals: Uint8Array;     // 8 histogram buckets
  holdDurations: Uint8Array;    // 8 histogram buckets
  
  // Spatial (16 bytes)
  touchZones: Uint8Array;       // 8 screen zones
  movementMagnitude: Uint8Array; // 8 distance buckets
  
  // Dynamics (16 bytes)
  velocityProfile: Uint8Array;   // 8 velocity buckets
  accelerationProfile: Uint8Array; // 8 acceleration buckets
  
  // Entropy (16 bytes)
  positionEntropy: Uint8Array;   // 4 bytes
  timingEntropy: Uint8Array;     // 4 bytes
  gestureVariance: Uint8Array;   // 4 bytes
  reserved: Uint8Array;          // 4 bytes future
}
```

**Why Adopt This:**
- ✅ Compact (64 bytes total)
- ✅ Privacy-preserving (no raw coordinates)
- ✅ Bot-detectable (statistical patterns)
- ✅ ML-ready (can train classifier later)

**Integration:**

```typescript
// Add to Sonnet's checkpoint payload
interface Checkpoint {
  // ... existing fields ...
  inputSketch?: string;  // Hex-encoded 64 bytes
}

// Add to final payload
interface ScoreClaim {
  // ... existing fields ...
  inputSketch: string;   // Always include
}
```

---

### 3.5 Time Validation Strategy

**Mode-Adaptive Approach (Synthesis):**

| Mode | Strategy | Source | Reasoning |
|------|----------|--------|-----------|
| **Casual** | Client-paced density | Opus/Sonnet | Best UX, no network dependency |
| **Tournament** | Client-paced + threshold | Opus/Sonnet | Enforce 60% checkpoint density |
| **Degen** | Server-paced time gates | GPT-5.2 | Strongest time proof, worth latency |

**Implementation:**

```typescript
// Casual/Tournament: Client-paced (Opus approach)
const checkpoints = await collectCheckpoints();
const validatedWindows = verifyCheckpoints(checkpoints);
const claimedTimeMs = validatedWindows * 5000;

// Degen: Server-paced (GPT approach)
for (let w = 0; w < expectedWindows; w++) {
  const nonce = await fetch('/score/session/window'); // Time gate
  const checkpoint = await createCheckpoint(nonce);
  await fetch('/score/session/checkpoint', checkpoint); // Verify
}
```

---

## Section 4: What to Improve in Sonnet 4.5

### 4.1 Over-Engineering Concerns

**Sonnet's 5-layer architecture is comprehensive but complex:**

```
Layer 1: Transcript ✅ Essential
Layer 2: Canvas ✅ Essential
Layer 3: DPoP ✅ Essential
Layer 4: Passkey ✅ Good for high-stakes
Layer 5: Worker Wallet ⚠️ Optional (gas voucher tying)
```

**Recommendation:**
- **Keep Layers 1-4** as they address distinct attack vectors
- **Make Layer 5 optional** (only for gas voucher integration)
- **Add Layer from Opus**: Input sketch for bot detection

**Revised Architecture:**

```
Layer 1: Transcript Integrity (Rolling Hash)
Layer 2: Input Binding (Opus's 64-byte sketch) ← NEW
Layer 3: Canvas Proof (Sampling + Opus closed-loop)
Layer 4: Device Binding (DPoP every 5s)
Layer 5: User Presence (Passkey every 30s)
Layer 6: Identity Binding (Worker Wallet - optional)
```

---

### 4.2 Canvas Implementation Improvements

**Current Sonnet Approach (Simple Sampling):**
```typescript
// Good: Robust baseline
const canvasHash = hashCanvas(ctx)
```

**Improved Approach (Opus Closed-Loop):**
```typescript
// Better: Unforgeable circular dependency
const prevHash = transcript.getHash();
await embedWatermark(canvas, prevHash);
await nextFrame();
const extracted = extractWatermark(canvas);
const nextHash = hash(prevHash, score, extracted); // Closed loop!
```

**Why This Matters:**
- Sonnet's sampling can be pre-computed if attacker knows canvas state
- Opus's loop requires **live rendering** in correct sequence
- Extraction failure → chain breaks → tamper detection

---

### 4.3 Backend Integration Simplification

**Sonnet's Approach (Multiple Endpoints):**
```
POST /api/score/finalize         # Session end
POST /api/score/submit-frame     # Optional frame submission
```

**GPT's Approach (Unified Flow):**
```
POST /score/session/start        # Session init
POST /score/session/checkpoint   # Per-window validation
POST /score/submit              # Final submission (existing)
```

**Recommendation:**
```
Adopt GPT's unified flow for clarity:

1. POST /score/session/start → sessionId
2. [Client plays, generates checkpoints]
3. POST /score/session/checkpoint (Degen only)
4. POST /score/submit (augmented with sessionId)
```

---

### 4.4 Performance Optimization

**Sonnet's Overhead (All Layers Active):**
```
DPoP checkpoint: ~20ms
Passkey checkpoint: ~500ms
Canvas watermark: ~5-10ms
Canvas hash: ~2-5ms
Total: ~527-535ms per checkpoint
```

**Optimization (Async + Batching):**

```typescript
// Don't block on checkpoints
async function onScoreUpdate(score: number) {
  // Sync: Update game state immediately
  this.progress.score = score;
  this.sendData();
  
  // Async: Generate proofs in background
  Promise.all([
    this.transcript.append(score),
    this.canvasProof.sample(),      // ~5ms
    this.checkpoints.requestDPoP()  // ~20ms
  ]).catch(handleProofFailure);
  
  // Passkey: Only every 30s, user-interactive
  if (this.shouldRequestPasskey()) {
    this.checkpoints.requestPasskey(); // ~500ms but expected
  }
}
```

**Result:**
- Game loop unblocked
- Proofs generated in parallel
- Perceived latency: 0ms

---

## Section 5: Missing Elements (Gaps in All Proposals)

### 5.1 Network Resilience

**Problem:** All proposals assume stable network connectivity.

**Solution (Add to Sonnet):**

```typescript
class OfflineQueueManager {
  private queue: Checkpoint[] = [];
  
  async submitCheckpoint(checkpoint: Checkpoint) {
    if (navigator.onLine) {
      await this.submitToBackend(checkpoint);
    } else {
      this.queue.push(checkpoint);
      this.watchNetworkReconnect();
    }
  }
  
  private watchNetworkReconnect() {
    window.addEventListener('online', async () => {
      await this.flushQueue();
    }, { once: true });
  }
  
  private async flushQueue() {
    for (const checkpoint of this.queue) {
      await this.submitToBackend(checkpoint);
    }
    this.queue = [];
  }
}
```

---

### 5.2 SDK Integrity Verification

**Problem:** Attacker can modify SDK code itself.

**Solution:**

```typescript
// Add SDK code hash to all payloads
const sdkCodeHash = await hash(
  scriptTag.src,
  scriptTag.integrity || computeScriptIntegrity()
);

interface Checkpoint {
  // ... existing fields ...
  sdkCodeHash: string;  // Proves SDK wasn't tampered
}

// Backend verifies
if (checkpoint.sdkCodeHash !== expectedSDKHash) {
  throw new Error('SDK integrity violation');
}
```

---

### 5.3 Dispute Resolution

**Problem:** No mechanism for users to prove innocence if falsely flagged.

**Solution (Adopt Sonnet's Frame Submission):**

```typescript
// User-initiated dispute
async function submitDisputeEvidence(sessionId: string) {
  // Capture full transcript + canvas frames
  const evidence = {
    sessionId,
    transcript: this.transcript.getFullEvents(),
    canvasFrames: await this.captureFrames(10), // Last 10 frames
    checkpoints: this.checkpoints.getAll()
  };
  
  await fetch('/api/score/dispute', {
    method: 'POST',
    body: JSON.stringify(evidence)
  });
}
```

---

### 5.4 Privacy Safeguards

**Problem:** Opus's input recording raises privacy concerns.

**Solution:**

```typescript
// Privacy-preserving input sketch
class PrivacyPreservingInputSketch {
  private buffer: InputEvent[] = [];
  
  recordEvent(event: InputEvent) {
    // Only record timing and general region (no exact coordinates)
    this.buffer.push({
      type: event.type,
      timestamp: event.timestamp,
      region: this.quantizeToRegion(event.x, event.y), // 8 zones only
      // NO raw x/y coordinates
    });
  }
  
  private quantizeToRegion(x: number, y: number): number {
    // Map to 1 of 8 screen zones (4x2 grid)
    const col = Math.floor((x / window.innerWidth) * 4);
    const row = Math.floor((y / window.innerHeight) * 2);
    return row * 4 + col;
  }
}
```

---

## Section 6: Optimal Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)

**What to Build:**
```
✅ TranscriptRecorder (Opus input-bound hash)
✅ Canvas Sampling (Sonnet robust baseline)
✅ WindowClock (time windows)
✅ CheckpointEngine (DPoP only)
```

**What to Skip:**
```
❌ Passkey checkpoints (add later)
❌ Watermark closed-loop (add later)
❌ Server time gates (add later)
❌ Worker wallet binding (add later)
```

**Goal:** Establish baseline with minimal complexity.

---

### Phase 2: Canvas Proof (Weeks 3-4)

**Add:**
```
✅ Opus closed-loop watermarking
✅ Composer LSB implementation
✅ Fallback to sampling on watermark failure
```

**Validate:**
```
- Watermark survives game rendering
- Closed-loop dependency works
- Graceful degradation on failures
```

---

### Phase 3: Bot Detection (Weeks 5-6)

**Add:**
```
✅ Opus 64-byte input sketch
✅ Privacy-preserving input recording
✅ Backend behavioral classification
```

**Validate:**
```
- Bot detection accuracy
- False positive rate
- Privacy compliance
```

---

### Phase 4: Strong Anchors (Weeks 7-8)

**Add:**
```
✅ Passkey checkpoints (every 30s)
✅ Worker wallet binding (optional)
✅ Server time gates (Degen mode only)
```

**Validate:**
```
- Passkey UX acceptable
- Time gate latency manageable
- Full enforcement works
```

---

### Phase 5: Hardening (Weeks 9-12)

**Add:**
```
✅ Offline queue manager
✅ SDK integrity checks
✅ Dispute resolution
✅ Monitoring dashboards
```

**Validate:**
```
- Works offline
- SDK tampering detected
- Users can dispute flags
- Full telemetry
```

---

## Section 7: Final Recommendations

### 7.1 Architecture Decision

**Adopt Hybrid Approach:**

```
Base: Sonnet 4.5 (comprehensive, well-structured)
+ GPT server time gates (Degen mode only)
+ Opus input binding (all modes)
+ Opus closed-loop watermarking (replaces Sonnet's simple sampling)
+ Composer LSB implementation (best reference code)
```

---

### 7.2 Priority Features (Must-Have)

1. **Transcript with input binding** (Opus)
2. **Canvas closed-loop watermarking** (Opus)
3. **DPoP checkpoints every 5s** (All)
4. **Time window validation** (All)
5. **Input sketch for bot detection** (Opus)

---

### 7.3 Optional Features (Nice-to-Have)

1. **Passkey checkpoints** (high-stakes only)
2. **Server time gates** (Degen mode only)
3. **Worker wallet binding** (gas voucher integration)
4. **Frame submission** (disputes only)
5. **SDK integrity checks** (Phase 2)

---

### 7.4 Avoid Over-Engineering

**Don't Do (At Least Initially):**
- ❌ Worker wallet signatures for every session (adds complexity, low value)
- ❌ On-chain commitments per session (gas costs prohibitive)
- ❌ Full canvas frame recording (bandwidth/storage costs)
- ❌ ML-based behavioral classification (train on data first)

---

### 7.5 Phased Rollout Strategy

**Week 1-2:** Shadow mode (all proposals agree on this)
**Week 3-4:** Casual mode enforcement
**Week 5-6:** Tournament mode enforcement
**Week 7-8:** Degen mode enforcement (add server time gates)
**Week 9+:** Hardening and optimization

---

## Section 8: Synthesis: Best of All Worlds

### Final Architecture

```typescript
// SDK Core (Sonnet structure)
class DigitapGamePlayerSDK {
  // Layer 1: Transcript (Opus input-bound hash)
  private transcript = new TranscriptRecorder({
    hashFunction: opusInputBoundHash  // ← Opus innovation
  });
  
  // Layer 2: Canvas Proof (Opus closed-loop + Sonnet sampling)
  private canvas = new CanvasProofEngine({
    sampling: true,                    // ← Sonnet baseline
    watermarking: opusClosedLoop,      // ← Opus closed-loop
    implementation: composerLSB        // ← Composer code
  });
  
  // Layer 3: Input Sketch (Opus bot detection)
  private inputSketch = new InputSketchBuilder();  // ← Opus innovation
  
  // Layer 4: Checkpoints (Sonnet + GPT hybrid)
  private checkpoints = new CheckpointEngine({
    dpop: { interval: 5000 },          // ← All agree
    passkey: { interval: 30000 },      // ← Sonnet/Opus
    serverPaced: config.mode === 'DEGEN'  // ← GPT for high-stakes
  });
  
  // Layer 5: Worker Wallet (Sonnet optional)
  private workerWallet?: WorkerWalletSigner;
}

// Rolling Hash (Opus design)
R_i = H(
  R_{i-1},                // Previous hash
  score_i,                // Current score
  inputDigest_i,          // ← Opus input binding
  canvasSample_i,         // ← Sonnet robustness
  watermarkExtracted_i,   // ← Opus closed-loop
  timestamp_i             // Anti-replay
);

// Checkpoint (All combined)
interface Checkpoint {
  type: "dpop" | "passkey";
  wIndex: number;
  
  // Crypto (All)
  digest: string;
  signature: string;
  
  // Canvas (Opus closed-loop + Sonnet sampling)
  canvasProof: {
    sampleHash: string;        // ← Sonnet baseline
    watermarkVerified: boolean; // ← Opus closed-loop
  };
  
  // Input (Opus)
  inputSketch?: string;  // 64-byte fingerprint
  
  // Time (GPT for Degen)
  serverNonce?: string;  // Only if server-paced
}

// Backend Validation (GPT flow + Opus checks)
async function validateSession(claim: ScoreClaim) {
  // 1. Transcript integrity (All)
  await verifyHashChain(claim.rollingHash);
  
  // 2. Canvas proof (Opus closed-loop + Sonnet fallback)
  await verifyCanvasProof(claim.canvasProof);
  
  // 3. Input sketch (Opus bot detection)
  const botScore = await classifyInputSketch(claim.inputSketch);
  
  // 4. Checkpoint density (Opus/Sonnet)
  const validatedWindows = await verifyCheckpoints(claim.checkpoints);
  
  // 5. Time validation (GPT for Degen, Opus/Sonnet for others)
  const claimedTime = config.mode === 'DEGEN'
    ? await verifyServerPacedTime(claim.sessionId)
    : validatedWindows * 5000;
  
  // 6. Policy enforcement (Sonnet framework)
  await enforcePolicy(config.mode, { botScore, claimedTime, validatedWindows });
}
```

---

## Conclusion

### Winning Combination

**Architecture**: Sonnet 4.5 (best structure)  
**Time Validation**: GPT-5.2 (Degen mode) + Opus/Sonnet (other modes)  
**Canvas Proof**: Opus closed-loop + Composer implementation + Sonnet fallback  
**Bot Detection**: Opus input sketch (essential innovation)  
**Implementation**: Composer LSB code (production-ready)

### Key Takeaways

1. ✅ **No single proposal is perfect** - each has unique strengths
2. ✅ **Synthesis is stronger** than any individual approach
3. ✅ **Complexity must be justified** - don't over-engineer
4. ✅ **Phased rollout is critical** - learn from production data
5. ✅ **Mode-adaptive security** - casual ≠ degen

### Next Steps

1. **Approve** this synthesis as the implementation blueprint
2. **Start with Phase 1** (foundation + shadow mode)
3. **Collect data** from production before Phase 2
4. **Iterate** based on real attack patterns observed
5. **Train ML models** on input sketches (Phase 3)

---

**Document Version:** 1.0  
**Recommendation:** Implement synthesis approach, not any single proposal  
**Timeline:** 12 weeks for full rollout (3 weeks per phase × 4 phases)
