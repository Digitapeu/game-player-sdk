# WAM SDK Security Hardening - Comparative Analysis Report

**Date:** December 17, 2025  
**Author:** Composer Analysis  
**Documents Analyzed:**
- DEV_1_GPT_5.2.md (GPT-5.2 Assessment)
- DEV_2_OPUS_4.5.md (Opus 4.5 Assessment)
- DEV_4_SONNET_4.5.md (Sonnet 4.5 Assessment)
- DEV_3_COMPOSER_1.md (Composer Proposed Solution)

---

## Executive Summary

This report analyzes four independent security hardening proposals for WAM SDK, identifying unique innovations, complementary approaches, and opportunities for synthesis into an improved unified solution.

**Key Findings:**
1. **Server-paced time gating** (GPT-5.2) is a critical innovation missing from other proposals
2. **Input binding** (Opus 4.5) provides stronger bot detection than canvas-only approaches
3. **Canvas watermarking loop** (Opus 4.5) creates unforgeable dependencies
4. **Five-layer architecture** (Sonnet 4.5) provides comprehensive defense-in-depth
5. **Steganographic markers** (Composer) offer invisible tamper-evidence

**Recommendation:** Synthesize the best elements from all proposals into a unified architecture.

---

## 1. Architecture Comparison

### DEV_1_GPT_5.2: Server-Paced Time Gating

**Core Innovation:** Backend acts as time oracle, issuing nonces per window.

**Architecture:**
```
Client → Request Window Nonce → Backend (time gate)
Client → Submit Checkpoint with Nonce → Backend (verify)
```

**Key Features:**
- ✅ **Server-issued nonces** prevent client-side time compression
- ✅ **Two-step checkpoint** (issue nonce → prove) or single-step
- ✅ **Parent container** owns crypto (DPoP key in IndexedDB)
- ✅ **Session management** in parent, SDK only records transcript

**Strengths:**
- **Unforgeable time gating** - backend controls window progression
- **Prevents offline fabrication** - requires server interaction per window
- **Clean separation** - parent handles crypto, SDK handles game events

**Weaknesses:**
- ❌ No canvas proof mechanism
- ❌ No input binding
- ❌ Requires backend round-trip per checkpoint (latency concern)

**Novel Contribution:** ⭐⭐⭐⭐⭐
Server-paced time gating is the **most critical innovation** - solves time compression attacks fundamentally.

---

### DEV_2_OPUS_4.5: Input-Bound Hash Chain + Canvas Loop

**Core Innovation:** Rolling hash depends on user input + canvas watermark loop.

**Architecture:**
```
R_i = H(R_{i-1} || score || inputDigest || canvasSample || watermark)
watermark_i = embed_then_extract(canvas, R_{i-1})
```

**Key Features:**
- ✅ **Input binding** - hash includes user interaction digest
- ✅ **Canvas watermark loop** - embed → render → extract → hash
- ✅ **64-byte input sketch** - behavioral fingerprint without raw data
- ✅ **Unpredictable sampling** - canvas regions derived from hash

**Strengths:**
- **Strong bot detection** - input patterns reveal automation
- **Canvas loop dependency** - requires live rendering
- **Privacy-preserving** - only statistical summaries, not raw input
- **Minimal data transfer** - <500 bytes per session

**Weaknesses:**
- ❌ No server-paced time gating (vulnerable to offline fabrication)
- ❌ Input binding may be game-dependent (some games have minimal input)
- ❌ Watermark loop complexity (embed/extract timing issues)

**Novel Contribution:** ⭐⭐⭐⭐
Input binding and canvas watermark loop are **highly innovative** approaches to proving user interaction.

---

### DEV_4_SONNET_4.5: Five-Layer Defense Architecture

**Core Innovation:** Layered security with steganographic canvas watermarking.

**Architecture:**
```
Layer 5: On-chain commitment (optional)
Layer 4: User presence (Passkey every 30s)
Layer 3: Device binding (DPoP every 5s)
Layer 2: Visual binding (Canvas watermarks)
Layer 1: Transcript integrity (Rolling hash)
```

**Key Features:**
- ✅ **Five-layer defense** - redundancy and depth
- ✅ **LSB steganography** - invisible watermark embedding
- ✅ **Mode-based policies** - CASUAL/TOURNAMENT/DEGEN
- ✅ **Comprehensive implementation** - detailed code examples

**Strengths:**
- **Defense in depth** - multiple independent verification layers
- **Production-ready** - detailed implementation plan
- **Mode-adaptive** - scales security by stakes
- **Well-documented** - comprehensive testing and rollout strategy

**Weaknesses:**
- ❌ No server-paced time gating
- ❌ No input binding
- ❌ Canvas watermarking is simpler (no loop dependency)

**Novel Contribution:** ⭐⭐⭐⭐
Five-layer architecture provides **excellent defense-in-depth** and production-ready implementation guidance.

---

### DEV_3_COMPOSER_1: Steganographic Canvas Proof

**Core Innovation:** LSB steganography with direct canvas sampling.

**Architecture:**
```
Canvas Sampling → Hash → Include in Checkpoint
Steganographic Markers → Encode Checkpoint Data → Verify
```

**Key Features:**
- ✅ **Direct canvas sampling** - 5 regions (corners + center)
- ✅ **LSB steganography** - invisible markers in pixel LSBs
- ✅ **Simple integration** - minimal complexity
- ✅ **Backend validation** - canvas hash progression analysis

**Strengths:**
- **Simple and efficient** - low overhead
- **Invisible markers** - hard to detect/remove
- **Backward compatible** - no breaking changes
- **Clear implementation** - straightforward code

**Weaknesses:**
- ❌ No server-paced time gating
- ❌ No input binding
- ❌ No watermark loop (weaker dependency)

**Novel Contribution:** ⭐⭐⭐
Clean, simple approach to canvas proof with **good balance of security and complexity**.

---

## 2. Feature Comparison Matrix

| Feature | GPT-5.2 | Opus 4.5 | Sonnet 4.5 | Composer |
|---------|---------|----------|------------|----------|
| **Server-paced time gating** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Input binding** | ❌ No | ✅ Yes | ❌ No | ❌ No |
| **Canvas watermark loop** | ❌ No | ✅ Yes | ❌ Partial | ❌ No |
| **LSB steganography** | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| **Canvas sampling** | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| **DPoP checkpoints** | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| **Passkey checkpoints** | ✅ Optional | ✅ Yes | ✅ Yes | ✅ Yes |
| **Worker wallet binding** | ❌ No | ✅ Yes | ✅ Yes | ✅ Yes |
| **Behavioral analysis** | ❌ No | ✅ Yes (input sketch) | ❌ No | ❌ No |
| **Mode-based policies** | ✅ Yes | ❌ No | ✅ Yes | ✅ Yes |
| **Parent container crypto** | ✅ Yes | ❌ No | ❌ No | ❌ No |
| **Minimal data transfer** | ⚠️ Medium | ✅ Yes (<500B) | ⚠️ Medium | ⚠️ Medium |

---

## 3. Critical Innovations Missing from Composer Solution

### 3.1 Server-Paced Time Gating (GPT-5.2)

**What It Is:**
Backend issues time-gated nonces per window. Client cannot advance windows without server permission.

**Why It's Critical:**
- **Prevents offline fabrication** - attacker cannot generate checkpoints without server
- **Enforces real-time progression** - backend controls time windows
- **Prevents time compression** - cannot skip windows

**How to Integrate:**
```typescript
// Add to CheckpointEngine
async createDPoPCheckpoint(): Promise<void> {
  // Step 1: Request window nonce from backend
  const { nonceW, wIndex } = await fetch('/api/score/session/window', {
    method: 'POST',
    body: JSON.stringify({ sessionId, currentWindow })
  })
  
  // Step 2: Create checkpoint with server nonce
  const checkpointDigest = hash(
    sessionId,
    wIndex,
    nonceW,  // ← Server-issued nonce
    rollingHash,
    score,
    canvasHash
  )
  
  // Step 3: Sign and submit
  const dpopSig = await signWithDPoP(checkpointDigest)
  await submitCheckpoint({ wIndex, nonceW, dpopSig, ... })
}
```

**Impact:** ⭐⭐⭐⭐⭐ **CRITICAL** - Solves fundamental time compression vulnerability.

---

### 3.2 Input Binding (Opus 4.5)

**What It Is:**
Rolling hash includes digest of user input events (mouse, touch, keyboard).

**Why It's Critical:**
- **Proves user interaction** - hash depends on actual input
- **Detects bots** - automated input has different patterns
- **Prevents score fabrication** - cannot fake score without matching input

**How to Integrate:**
```typescript
// Add to TranscriptRecorder
class TranscriptRecorder {
  private inputBuffer: InputEvent[] = []
  
  recordInput(event: TouchEvent | MouseEvent | KeyboardEvent): void {
    this.inputBuffer.push({
      type: event.type,
      x: event.clientX,
      y: event.clientY,
      ts: performance.now()
    })
  }
  
  commitWindow(score: number, canvasHash: string): void {
    // Include input digest in hash
    const inputDigest = hash(canonicalize(this.inputBuffer))
    
    this.rollingHash = hash(
      this.rollingHash,
      score,
      inputDigest,  // ← Input binding
      canvasHash
    )
    
    this.inputBuffer = []
  }
}
```

**Impact:** ⭐⭐⭐⭐ **HIGH** - Significantly improves bot detection.

---

### 3.3 Canvas Watermark Loop (Opus 4.5)

**What It Is:**
Embed watermark based on previous hash → render → extract → include in next hash.

**Why It's Critical:**
- **Creates circular dependency** - cannot compute hash without live rendering
- **Prevents pre-rendering** - watermark must be embedded and extracted
- **Binds crypto to visual** - checkpoint signatures tied to canvas state

**How to Integrate:**
```typescript
// Modify CanvasSampler
class CanvasSampler {
  async sampleAndWatermark(prevHash: string): Promise<string> {
    // Step 1: Embed watermark based on previous hash
    const watermark = truncate(hash(prevHash), 16)
    this.embedWatermark(watermark)
    
    // Step 2: Wait for render
    await this.waitForNextFrame()
    
    // Step 3: Extract watermark
    const extracted = this.extractWatermark()
    
    // Step 4: Include in hash
    return hash(canvasSample, extracted)
  }
}
```

**Impact:** ⭐⭐⭐⭐ **HIGH** - Creates unforgeable dependency on live rendering.

---

### 3.4 Input Sketch (Opus 4.5)

**What It Is:**
64-byte behavioral fingerprint capturing input statistics (timing, spatial, dynamics).

**Why It's Helpful:**
- **Bot detection** - statistical patterns reveal automation
- **Privacy-preserving** - no raw input data
- **Minimal overhead** - only 64 bytes per session

**How to Integrate:**
```typescript
// Add InputSketchBuilder
class InputSketchBuilder {
  private tapIntervals: number[] = []
  private touchZones: Uint8Array = new Uint8Array(8)
  private velocities: number[] = []
  
  recordEvent(event: InputEvent): void {
    // Collect statistics
    this.tapIntervals.push(event.interval)
    this.touchZones[event.zone]++
    this.velocities.push(event.velocity)
  }
  
  build(): Uint8Array {
    // Create 64-byte sketch
    const sketch = new Uint8Array(64)
    // ... histogram encoding ...
    return sketch
  }
}
```

**Impact:** ⭐⭐⭐ **MEDIUM** - Useful for bot detection, not critical for integrity.

---

### 3.5 Five-Layer Architecture (Sonnet 4.5)

**What It Is:**
Layered defense with independent verification mechanisms.

**Why It's Helpful:**
- **Defense in depth** - redundancy if one layer fails
- **Clear separation** - each layer has distinct purpose
- **Mode-adaptive** - can enable/disable layers by mode

**How to Integrate:**
Adopt the layered approach:
1. Layer 1: Transcript integrity (rolling hash)
2. Layer 2: Visual binding (canvas proof)
3. Layer 3: Device binding (DPoP)
4. Layer 4: User presence (Passkey)
5. Layer 5: Identity binding (Worker wallet)

**Impact:** ⭐⭐⭐⭐ **HIGH** - Excellent architectural pattern.

---

## 4. What Can Be Used from Each Proposal

### From GPT-5.2:

✅ **Server-Paced Time Gating**
- Implement `/api/score/session/window` endpoint
- Issue time-gated nonces per window
- Enforce window progression server-side

✅ **Parent Container Architecture**
- Move DPoP signing to parent (GameBox)
- SDK only records transcript
- Parent handles all crypto operations

✅ **Session Management**
- Parent owns session lifecycle
- SDK sends transcript updates via postMessage
- Clean separation of concerns

---

### From Opus 4.5:

✅ **Input Binding**
- Add input event listeners in SDK
- Include input digest in rolling hash
- Prove user interaction

✅ **Canvas Watermark Loop**
- Embed watermark based on previous hash
- Extract after render
- Include in next hash (circular dependency)

✅ **Input Sketch**
- Build 64-byte behavioral fingerprint
- Send with final payload
- Use for bot detection (non-critical)

✅ **Unpredictable Canvas Sampling**
- Derive sample coordinates from hash
- Prevents pre-computation
- More secure than fixed regions

---

### From Sonnet 4.5:

✅ **Five-Layer Architecture**
- Adopt layered defense model
- Independent verification per layer
- Mode-based layer activation

✅ **LSB Steganography Implementation**
- Use provided code examples
- Embed checkpoint data in canvas
- Extract for verification

✅ **Mode-Based Policies**
- CASUAL: Shadow mode, no enforcement
- TOURNAMENT: DPoP + Passkey required
- DEGEN: All layers + canvas frames

✅ **Comprehensive Testing Strategy**
- Unit tests for each module
- Integration tests for verification
- Security tests for attack resistance

---

### From Composer (Current Solution):

✅ **Simple Canvas Sampling**
- 5-region approach (corners + center)
- Easy to implement
- Good balance of security/complexity

✅ **Steganographic Marker Encoding**
- LSB encoding implementation
- Checkpoint data in markers
- Backend validation logic

---

## 5. Improved Unified Architecture

### Synthesized Solution

**Core Components:**

1. **Server-Paced Time Gating** (from GPT-5.2)
   - Backend issues time-gated nonces
   - Prevents offline fabrication
   - Enforces real-time progression

2. **Input-Bound Transcript** (from Opus 4.5)
   - Rolling hash includes input digest
   - Proves user interaction
   - Detects bot automation

3. **Canvas Watermark Loop** (from Opus 4.5)
   - Embed → render → extract → hash
   - Circular dependency on live rendering
   - Binds crypto to visual state

4. **Five-Layer Defense** (from Sonnet 4.5)
   - Transcript integrity
   - Visual binding
   - Device binding
   - User presence
   - Identity binding

5. **LSB Steganography** (from Composer + Sonnet)
   - Invisible markers
   - Checkpoint data encoding
   - Backend extraction

---

### Improved Data Flow

```
1. SDK Init
   ├── Start transcript recorder
   ├── Attach input listeners
   ├── Initialize canvas sampler
   └── Request session start from parent

2. Parent Session Start
   ├── Call /api/score/session/start
   ├── Receive sessionId, windowMs, policy
   └── Start checkpoint timer

3. Every Window (5s)
   ├── SDK: Collect input events
   ├── SDK: Sample canvas (unpredictable regions)
   ├── SDK: Embed watermark(R_{i-1})
   ├── SDK: Wait for render
   ├── SDK: Extract watermark
   ├── SDK: Commit window (score, inputDigest, canvasHash, watermark)
   ├── Parent: Request window nonce from backend
   ├── Backend: Issue nonceW (time-gated)
   ├── Parent: Sign checkpoint with DPoP
   ├── Parent: Submit checkpoint to backend
   └── Backend: Verify and advance window

4. Every 6 Windows (30s)
   ├── Parent: Request Passkey assertion
   ├── User: Authenticate (biometric/PIN)
   ├── Parent: Embed Passkey signature in canvas
   └── Parent: Submit strong checkpoint

5. Game End
   ├── SDK: Finalize transcript
   ├── SDK: Build input sketch (64 bytes)
   ├── Parent: Sign final claim with worker wallet
   ├── Parent: Submit to /api/score/finalize
   └── Backend: Full verification pipeline
```

---

### Improved Checkpoint Digest

```typescript
// Enhanced checkpoint digest includes all binding mechanisms
const checkpointDigest = hash(
  sessionId,
  wIndex,
  nonceW,              // ← Server-issued (time gating)
  rollingHash,         // ← Includes input digest (input binding)
  scoreSoFar,
  stateTag,
  canvasHash,          // ← Includes watermark (visual binding)
  codeHash,
  sdkVersion
)
```

---

## 6. Implementation Priority

### Phase 1: Foundation (Critical)
1. ✅ Server-paced time gating (GPT-5.2)
2. ✅ Transcript recorder with input binding (Opus 4.5)
3. ✅ Canvas sampling (Composer)
4. ✅ DPoP checkpoints (All proposals)

**Why:** These provide the core security guarantees.

---

### Phase 2: Enhanced Binding (High Priority)
1. ✅ Canvas watermark loop (Opus 4.5)
2. ✅ LSB steganography (Composer + Sonnet)
3. ✅ Passkey checkpoints (All proposals)

**Why:** Strengthens visual binding and user presence proof.

---

### Phase 3: Behavioral Analysis (Medium Priority)
1. ✅ Input sketch builder (Opus 4.5)
2. ✅ Backend behavioral classifier
3. ✅ Bot detection heuristics

**Why:** Improves bot detection but not critical for integrity.

---

### Phase 4: Production Hardening (Low Priority)
1. ✅ Worker wallet binding (Sonnet 4.5)
2. ✅ Mode-based policies (Sonnet 4.5)
3. ✅ Comprehensive testing (Sonnet 4.5)

**Why:** Production-ready features and operational excellence.

---

## 7. Recommendations

### Critical Additions to Composer Solution

1. **⭐ CRITICAL: Add Server-Paced Time Gating**
   - Implement backend window nonce endpoint
   - Require server nonce in checkpoint digest
   - Prevents offline fabrication and time compression

2. **⭐ HIGH: Add Input Binding**
   - Include input digest in rolling hash
   - Attach input event listeners
   - Proves user interaction

3. **⭐ HIGH: Implement Canvas Watermark Loop**
   - Embed watermark based on previous hash
   - Extract after render
   - Create circular dependency

4. **⭐ HIGH: Adopt Five-Layer Architecture**
   - Organize into distinct layers
   - Independent verification per layer
   - Mode-based activation

5. **⭐ MEDIUM: Add Input Sketch**
   - Build behavioral fingerprint
   - Use for bot detection
   - Privacy-preserving approach

---

### Architecture Improvements

**Current Composer Architecture:**
```
SDK → Transcript → Checkpoints → Backend
```

**Improved Architecture:**
```
SDK → Transcript (with input) → Parent → Backend (time-gated)
     ↓
  Canvas Loop → Watermark → Hash → Checkpoint
```

**Key Changes:**
1. Parent container owns crypto (DPoP signing)
2. Backend issues time-gated nonces
3. Transcript includes input digest
4. Canvas watermark loop creates dependency
5. Five-layer defense model

---

### Backend Endpoint Additions

**New Endpoints Required:**

1. `POST /api/score/session/start`
   - Issue sessionId
   - Return window duration, policy
   - Initialize Redis session state

2. `POST /api/score/session/window`
   - Issue time-gated nonceW
   - Enforce window progression
   - Return nextWindowAt

3. `POST /api/score/session/checkpoint`
   - Verify checkpoint signature
   - Validate nonceW
   - Advance window counter
   - Store checkpoint

4. `POST /api/score/finalize` (enhanced)
   - Verify all checkpoints
   - Validate input sketch
   - Extract canvas watermarks (optional)
   - Enforce mode-based policies

---

## 8. Security Analysis Comparison

### Attack Resistance Matrix

| Attack | GPT-5.2 | Opus 4.5 | Sonnet 4.5 | Composer | **Improved** |
|--------|---------|----------|------------|----------|--------------|
| **Offline fabrication** | ✅ Strong | ⚠️ Weak | ⚠️ Weak | ⚠️ Weak | ✅ **Strong** |
| **Time compression** | ✅ Strong | ⚠️ Medium | ⚠️ Medium | ⚠️ Medium | ✅ **Strong** |
| **Bot automation** | ⚠️ Medium | ✅ Strong | ⚠️ Medium | ⚠️ Medium | ✅ **Strong** |
| **Memory editing** | ⚠️ Medium | ✅ Strong | ✅ Strong | ✅ Strong | ✅ **Strong** |
| **Canvas manipulation** | ❌ Weak | ✅ Strong | ✅ Strong | ✅ Strong | ✅ **Strong** |
| **Replay attacks** | ✅ Strong | ✅ Strong | ✅ Strong | ✅ Strong | ✅ **Strong** |
| **Credential theft** | ⚠️ Medium | ✅ Strong | ✅ Strong | ✅ Strong | ✅ **Strong** |

**Improved Solution:** Combines strengths from all proposals.

---

## 9. Performance Impact Comparison

| Metric | GPT-5.2 | Opus 4.5 | Sonnet 4.5 | Composer | **Improved** |
|--------|---------|----------|------------|----------|--------------|
| **Backend round-trips** | High (per window) | Low | Low | Low | **Medium** (per window) |
| **Client CPU overhead** | Low | Medium | Medium | Low | **Medium** |
| **Data transfer** | Medium | Very Low (<500B) | Medium | Medium | **Low** (~1KB) |
| **Latency impact** | High (per window) | Low | Low | Low | **Medium** (per window) |

**Trade-off:** Server-paced time gating adds latency but provides critical security.

---

## 10. Conclusion

### Key Findings

1. **Server-paced time gating** (GPT-5.2) is the **most critical innovation** - solves fundamental time compression vulnerability.

2. **Input binding** (Opus 4.5) significantly improves bot detection and user interaction proof.

3. **Canvas watermark loop** (Opus 4.5) creates unforgeable dependency on live rendering.

4. **Five-layer architecture** (Sonnet 4.5) provides excellent defense-in-depth pattern.

5. **LSB steganography** (Composer + Sonnet) offers clean implementation of invisible markers.

### Recommended Unified Solution

**Synthesize:**
- ✅ Server-paced time gating from GPT-5.2
- ✅ Input binding from Opus 4.5
- ✅ Canvas watermark loop from Opus 4.5
- ✅ Five-layer architecture from Sonnet 4.5
- ✅ LSB steganography from Composer + Sonnet
- ✅ Mode-based policies from Sonnet 4.5
- ✅ Input sketch from Opus 4.5 (optional)

**Result:** Comprehensive security solution with:
- Strong time compression resistance
- Excellent bot detection
- Unforgeable visual binding
- Defense-in-depth architecture
- Production-ready implementation

### Next Steps

1. **Update Composer solution** with critical additions:
   - Server-paced time gating
   - Input binding
   - Canvas watermark loop

2. **Adopt five-layer architecture** for clear separation

3. **Implement backend endpoints** for time gating

4. **Add input sketch** for behavioral analysis (optional)

5. **Test unified solution** against all attack vectors

---

## Appendix: Feature Adoption Matrix

| Feature | Source | Priority | Status |
|---------|--------|----------|--------|
| Server-paced time gating | GPT-5.2 | ⭐⭐⭐⭐⭐ CRITICAL | ✅ **MUST ADD** |
| Input binding | Opus 4.5 | ⭐⭐⭐⭐ HIGH | ✅ **MUST ADD** |
| Canvas watermark loop | Opus 4.5 | ⭐⭐⭐⭐ HIGH | ✅ **MUST ADD** |
| Five-layer architecture | Sonnet 4.5 | ⭐⭐⭐⭐ HIGH | ✅ **SHOULD ADD** |
| LSB steganography | Composer + Sonnet | ⭐⭐⭐ MEDIUM | ✅ **KEEP** |
| Input sketch | Opus 4.5 | ⭐⭐⭐ MEDIUM | ⚠️ **CONSIDER** |
| Mode-based policies | Sonnet 4.5 | ⭐⭐⭐ MEDIUM | ✅ **SHOULD ADD** |
| Parent container crypto | GPT-5.2 | ⭐⭐ LOW | ⚠️ **CONSIDER** |
| Behavioral classifier | Opus 4.5 | ⭐⭐ LOW | ⚠️ **OPTIONAL** |

---

**Report Version:** 1.0  
**Date:** December 17, 2025  
**Status:** Ready for Implementation Planning
