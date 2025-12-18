# WAM SDK Security Hardening - Team Analysis Report

**Compiled by:** Claude Opus 4.5  
**Date:** December 17, 2024  
**Purpose:** Synthesize findings from all four team assessments

---

## Executive Summary

Four independent analyses were conducted on the WAM SDK security hardening challenge. Each brought unique perspectives and identified critical security mechanisms. This report synthesizes the findings, highlights key innovations, identifies gaps, and proposes a unified implementation strategy.

### Documents Analyzed

| Document | Author | Focus Area | Lines |
|----------|--------|------------|-------|
| DEV_1_GPT_5.2.md | GPT 5.2 | Server-paced density enforcement | 365 |
| DEV_2_OPUS_4.5.md | Opus 4.5 | Input-bound hashing + behavioral fingerprints | 920 |
| DEV_3_COMPOSER_1.md | Composer 1 | Canvas steganography implementation | 862 |
| DEV_4_SONNET_4.5.md | Sonnet 4.5 | Five-layer architecture + full implementation | 2289 |

---

## 1. Critical Insight: Server-Paced Window Nonces

### The Gap Identified by GPT

**GPT's key insight (missing from other analyses):**

> "If the backend only sees a single final 'submit score' call, an attacker can generate any number of 'per-window proofs' in a burst (because the runtime can ask the signer repeatedly). That means you can get **integrity** but not **real-time density**."

**This is a critical flaw in client-only approaches.** Without server-issued nonces, an attacker can:

1. Pause the game
2. Generate all DPoP signatures in rapid succession
3. Submit a "60-second session" that took 5 seconds to compute

### GPT's Solution: Server as Time Oracle

```
POST /score/session/checkpoint
├── Server checks: now >= nextWindowAt?
├── If too early → reject with retryAfterMs
├── If on time → issue nonce, increment window
├── Client signs: H(sessionId || wIndex || serverNonce || ...)
└── Server validates signature before advancing
```

**This ensures:** The client cannot advance windows faster than wall-clock time.

### Impact on Other Designs

| Design | Has Server Pacing? | Fix Required |
|--------|-------------------|--------------|
| Opus | ❌ No | Must add server nonces |
| Composer | ❌ No | Must add server nonces |
| Sonnet | ❌ No | Must add server nonces |
| GPT | ✅ Yes | Reference implementation |

**Recommendation:** Adopt GPT's server-paced checkpoint protocol as the foundation.

---

## 2. Rolling Hash Location

### Comparison

| Design | Location | Rationale |
|--------|----------|-----------|
| GPT | Parent (GameBox) | Parent already sees all events via postMessage |
| Opus | SDK (iframe) | Cryptographic self-containment |
| Composer | SDK (iframe) | SDK owns transcript |
| Sonnet | SDK (iframe) | SDK internal modules |

### GPT's Rationale

> "If you prefer to keep all logic in parent, iframe SDK can remain unchanged and parent can compute rolling hash from the same messages it already receives."

**Benefits of parent-side computation:**
1. No SDK changes needed (API frozen)
2. Parent can add security without game integration
3. Simpler upgrade path
4. Parent already has crypto primitives (DPoP, Passkey, Wallet)

**Recommendation:** Compute rolling hash in parent, not SDK. SDK remains unchanged.

---

## 3. Canvas Steganography Approaches

All designs except GPT include canvas steganography. Here's how they differ:

### Sampling Strategy

| Design | Approach | Regions | Rationale |
|--------|----------|---------|-----------|
| Opus | Seed-derived random | 8 points | Unpredictable sampling |
| Composer | Fixed corners + center | 5 regions (8×8 each) | UI areas rarely change |
| Sonnet | Full-frame LSB | Entire canvas | Maximum embedding capacity |

### Watermark Embedding

| Design | Method | Payload | Location |
|--------|--------|---------|----------|
| Opus | LSB in blue channel | 16 bytes | Top-left 64×8 region |
| Composer | LSB in RGB | 32 bytes | Corner regions |
| Sonnet | LSB in RGB | 200 bytes | Full frame |

### Closed-Loop Binding

**Opus's unique contribution:** The watermark creates a **circular dependency**:

```
Window N:
├── expectedWatermark = H(R_{N-1})
├── embedWatermark(canvas, expectedWatermark)
├── [Game renders]
├── extractedWatermark = extractWatermark(canvas)
├── R_N = H(R_{N-1} || ... || extractedWatermark)
│
Window N+1:
├── expectedWatermark = H(R_N)  // Depends on previous extraction
└── ... loop continues
```

**This is powerful because:** You can't compute future hashes without rendering current frames.

### Recommended Hybrid

1. **Sampling:** Use Opus's seed-derived random sampling (unpredictable)
2. **Embedding:** Use Composer's corner regions (stable, game rarely touches)
3. **Loop:** Use Opus's closed-loop dependency (unforgeable)

---

## 4. Input Binding and Behavioral Analysis

### Unique to Opus: Input-Bound Hash Chain

```typescript
R_i = H(R_{i-1} || score || inputDigest || canvasSample || watermark)
```

Where `inputDigest = H(inputEvents_in_window)`.

**Why this matters:** The hash chain now depends on **what the user did**, not just the score they claim.

### Unique to Opus: 64-Byte Input Sketch

A compressed behavioral fingerprint:

```typescript
interface InputSketch {
  tapIntervals: Uint8Array(8);      // Timing distribution
  touchZones: Uint8Array(8);        // Spatial distribution
  velocityBuckets: Uint8Array(8);   // Movement speed
  inputEntropy: Uint8Array(8);      // Randomness measure
}
```

**Bot detection signals:**

| Signal | Human | Bot |
|--------|-------|-----|
| Tap interval variance | High (50-500ms) | Low (consistent) |
| Position entropy | Medium-high | Very low or very high |
| Velocity profile | Bell curve | Flat or bimodal |

**None of the other designs include behavioral fingerprinting.**

**Recommendation:** Adopt input-bound hashing and input sketch from Opus.

---

## 5. Passkey Strategy

### Comparison

| Design | Frequency | Use Case |
|--------|-----------|----------|
| GPT | **Once per app session** | Tier gating + user presence |
| Opus | Every 30s | Real-time user presence |
| Composer | Every 30s | Strong checkpoint anchor |
| Sonnet | Every 30s | User-presence proof |

### GPT's Approach is Better for UX

> "For payout/tournaments, require exactly once per app session... Then store in parent memory and reuse as a gating credential for subsequent game sessions."

**Benefits:**
1. Single biometric prompt at app launch
2. No interruption during gameplay
3. Still proves human started the session
4. DPoP (silent) handles real-time density

**Recommendation:** Use GPT's approach:
- Passkey once per app session (for tier gating)
- DPoP every window (for density, silent)

---

## 6. Hash Function Choice

| Design | Hash Function | Rationale |
|--------|---------------|-----------|
| GPT | SHA-256 | Web Crypto API standard |
| Opus | SHA-256 | Browser compatibility |
| Composer | Not specified | - |
| Sonnet | **keccak256** | EVM compatibility |

### Sonnet's Rationale

> "Cryptographic hash (keccak256 for EVM compatibility)"

If you ever need on-chain verification or EIP-712 signatures, keccak256 is the right choice.

**Recommendation:** Use keccak256 for future-proofing (ethers.js available).

---

## 7. Database Schema

### Only Sonnet Provides Full Schema

```sql
CREATE TABLE score_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  rolling_hash TEXT NOT NULL,
  anchors_hash TEXT NOT NULL,
  submitted_score INT NOT NULL,
  claimed_time_ms BIGINT NOT NULL,
  verified_time_ms BIGINT NOT NULL,  -- Clamped time
  dpop_checkpoints_provided INT NOT NULL,
  dpop_checkpoints_valid INT NOT NULL,
  passkey_checkpoints_provided INT NOT NULL,
  passkey_checkpoints_valid INT NOT NULL,
  canvas_hashes JSONB,
  worker_signature TEXT,
  sdk_version TEXT NOT NULL,
  mode TEXT NOT NULL,
  confidence_score DECIMAL(3, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
```

**Recommendation:** Adopt Sonnet's schema, extend with GPT's Redis state model for real-time window tracking.

---

## 8. Testing and Monitoring

### Only Sonnet Provides

- Unit test specifications
- Integration test specifications
- E2E test specifications
- Security test specifications
- Monitoring dashboard metrics
- Alert thresholds

**Recommendation:** Adopt Sonnet's testing and monitoring framework.

---

## 9. Payload Size Comparison

| Design | Per-Tick | Per-Session End | Total (60s game) |
|--------|----------|-----------------|------------------|
| GPT | ~100 bytes | ~300 bytes | ~1.5 KB |
| Opus | **~25 bytes** | **~220 bytes** | **~500 bytes** |
| Composer | ~500 bytes | ~1 KB | ~7 KB |
| Sonnet | ~500 bytes | ~1 KB | ~6 KB |

**Opus achieves 10x smaller payloads** through:
1. Truncated hashes (16 bytes vs 32)
2. Compact binary encoding
3. Input sketch (64 bytes) vs raw events (50KB)

**Recommendation:** Adopt Opus's payload design for cost efficiency.

---

## 10. Comprehensive Feature Matrix

| Feature | GPT | Opus | Composer | Sonnet | Recommendation |
|---------|-----|------|----------|--------|----------------|
| **Server-paced nonces** | ✅ | ❌ | ❌ | ❌ | **Adopt from GPT** |
| Rolling hash | ✅ | ✅ | ✅ | ✅ | All agree |
| Rolling hash in parent | ✅ | ❌ | ❌ | ❌ | **Adopt from GPT** |
| DPoP checkpoints | ✅ | ✅ | ✅ | ✅ | All agree |
| Passkey once/session | ✅ | ❌ | ❌ | ❌ | **Adopt from GPT** |
| Canvas sampling | ❌ | ✅ | ✅ | ✅ | Adopt from Opus |
| Canvas watermark | ❌ | ✅ | ✅ | ✅ | Adopt from Opus |
| Closed-loop watermark | ❌ | ✅ | ❌ | ❌ | **Unique to Opus** |
| Seed-derived sampling | ❌ | ✅ | ❌ | ❌ | **Unique to Opus** |
| Input-bound hash | ❌ | ✅ | ❌ | ❌ | **Unique to Opus** |
| Input sketch (behavioral) | ❌ | ✅ | ❌ | ❌ | **Unique to Opus** |
| Worker wallet sig | ✅ | ✅ | ✅ | ✅ | All agree |
| Minimal payload (~500B) | ❌ | ✅ | ❌ | ❌ | **Unique to Opus** |
| Database schema | ❌ | ❌ | ❌ | ✅ | **Adopt from Sonnet** |
| Testing strategy | ❌ | ❌ | ❌ | ✅ | **Adopt from Sonnet** |
| Monitoring/alerts | ❌ | ❌ | ❌ | ✅ | **Adopt from Sonnet** |
| keccak256 hash | ❌ | ❌ | ❌ | ✅ | **Adopt from Sonnet** |
| Five-layer defense | ❌ | ❌ | ❌ | ✅ | Good framing |
| Canvas context proxy | ❌ | ❌ | ❌ | ✅ | Alternative approach |
| Edge case handling | ❌ | ⚠️ | ✅ | ⚠️ | **Adopt from Composer** |
| Endpoint contracts | ✅ | ⚠️ | ⚠️ | ✅ | Adopt from GPT |

---

## 11. Critical Gaps in Each Design

### GPT (DEV_1)

| Gap | Impact | Fix |
|-----|--------|-----|
| No canvas binding | Vulnerable to memory editing | Add steganography from Opus |
| No behavioral analysis | Can't detect bots | Add input sketch from Opus |
| No input binding | Hash doesn't prove interaction | Add input digest to hash |

### Opus (DEV_2)

| Gap | Impact | Fix |
|-----|--------|-----|
| **No server-paced nonces** | Can burst-generate proofs | **Critical: Add from GPT** |
| No database schema | Incomplete spec | Add from Sonnet |
| No testing strategy | Implementation risk | Add from Sonnet |

### Composer (DEV_3)

| Gap | Impact | Fix |
|-----|--------|-----|
| **No server-paced nonces** | Can burst-generate proofs | **Critical: Add from GPT** |
| No input binding | Hash doesn't prove interaction | Add from Opus |
| No behavioral analysis | Can't detect bots | Add from Opus |
| Fixed sampling regions | Predictable | Use seed-derived from Opus |

### Sonnet (DEV_4)

| Gap | Impact | Fix |
|-----|--------|-----|
| **No server-paced nonces** | Can burst-generate proofs | **Critical: Add from GPT** |
| No input binding | Hash doesn't prove interaction | Add from Opus |
| No behavioral fingerprint | Can't detect bots efficiently | Add from Opus |
| No closed-loop watermark | Weaker canvas binding | Add from Opus |
| Large payloads (~6KB) | Higher costs | Optimize per Opus |

---

## 12. Unified Implementation Plan

Based on the synthesis, here's the recommended unified approach:

### Phase 0: Infrastructure (Week 1)

**From GPT:**
- Server-paced checkpoint endpoint
- Redis state for window tracking
- Session start/end contracts

**From Sonnet:**
- Database schema
- Monitoring infrastructure

### Phase 1: Core Security (Week 2-3)

**From GPT:**
- Rolling hash computed in parent
- Passkey once per app session
- DPoP checkpoints per window (server-paced)

**From Opus:**
- Input-bound hash: `R_i = H(R_{i-1} || score || inputDigest || serverNonce)`
- Input sketch collection (64 bytes)

**From Sonnet:**
- keccak256 hashing

### Phase 2: Canvas Binding (Week 4-5)

**From Opus:**
- Seed-derived random sampling
- Closed-loop watermark embedding
- Canvas hash in rolling hash

**From Composer:**
- Edge case handling (WebGL, resize, multiple canvases)
- Corner region embedding (stable areas)

### Phase 3: Enforcement (Week 6-7)

**From GPT:**
- Mode-based policy tiers
- Time clamping from validated windows

**From Sonnet:**
- Worker wallet signature
- Testing suite
- Alert thresholds

### Phase 4: Optimization (Week 8)

**From Opus:**
- Minimal payload encoding (~500 bytes)
- Truncated hashes where safe

**From Sonnet:**
- Performance monitoring
- Rollout strategy

---

## 13. Final Unified Hash Chain

Combining the best of all approaches:

```
SESSION START (Parent):
├── sessionId = crypto.randomUUID()
├── Request server: POST /score/session/start → { windowMs, startAt }
├── R₀ = keccak256(sessionId || gameId || timestamp)
├── Passkey assertion (once per app session, if reward tier)

EACH WINDOW (Parent, server-paced):
├── Wait for server: POST /score/session/checkpoint → { nonceW } or reject
├── Collect: inputDigest from input events
├── Collect: canvasSample from seed-derived points
├── Collect: watermarkExtract from LSB read
├── Compute: R_i = keccak256(R_{i-1} || score || inputDigest || nonceW || canvasSample || watermarkExtract)
├── Embed: watermark = H(R_i) into canvas
├── Sign: dpopSig = Sign_deviceKey(H(sessionId || wIndex || nonceW || R_i))
├── Update: inputSketch (behavioral fingerprint)
├── Submit: checkpoint to server for validation

SESSION END (Parent):
├── Finalize: rollingHash, anchorsHash, inputSketch
├── Sign: workerSig = Sign_workerWallet(claimDigest)
├── Submit: POST /score/session/end with full payload (~500 bytes)

BACKEND VALIDATION:
├── Verify: DPoP signatures for each window
├── Verify: Passkey assertion (if reward tier)
├── Verify: Worker wallet signature
├── Clamp: time to validated windows
├── Classify: inputSketch for bot detection
├── Store: verified session
```

---

## 14. Key Takeaways

### What Each Contributor Brought

| Contributor | Key Contribution |
|-------------|------------------|
| **GPT** | Server-paced nonces (critical for real-time), rolling hash in parent, practical endpoint contracts |
| **Opus** | Input-bound hashing, closed-loop canvas watermark, 64-byte behavioral fingerprint, minimal payloads |
| **Composer** | Detailed steganography implementation, edge case handling, performance analysis |
| **Sonnet** | Comprehensive architecture, database schema, testing strategy, monitoring framework |

### Critical Lesson

**Without server-paced nonces, all client-side security is bypassable.** GPT identified this; others missed it. This is the single most important finding.

### Recommended Priority

1. **Must have:** Server-paced nonces (GPT)
2. **Must have:** Rolling hash with input binding (Opus)
3. **Should have:** Canvas steganography with closed loop (Opus)
4. **Should have:** Behavioral fingerprint (Opus)
5. **Nice to have:** On-demand frame submission for disputes (Sonnet Phase 5)

---

## 15. Decision Points for Team

1. **Hash function:** SHA-256 (simpler) or keccak256 (EVM compatible)?
2. **Passkey frequency:** Once per app session (GPT) or every 30s (others)?
3. **Canvas watermark:** Include (most designs) or skip (GPT)?
4. **Input sketch:** Include (Opus only) or defer to ML later?
5. **Server checkpoint timing:** Single-step (GPT B1) or two-step (GPT B2)?

### Recommended Decisions

1. **keccak256** - Future-proofs for on-chain
2. **Once per app session** - Better UX, DPoP handles density
3. **Include canvas watermark** - Adds significant security
4. **Include input sketch** - Low cost, high value
5. **Single-step** - Fewer round trips

---

## Appendix: Document Comparison Summary

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FEATURE COVERAGE BY DOCUMENT                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Server-paced nonces      ████████████████ GPT only                     │
│  Rolling hash             ████████████████ All                          │
│  DPoP checkpoints         ████████████████ All                          │
│  Passkey checkpoints      ████████████████ All (different freq)         │
│  Worker wallet sig        ████████████████ All                          │
│  Canvas sampling          ████████████░░░░ Opus, Composer, Sonnet       │
│  Canvas watermark         ████████████░░░░ Opus, Composer, Sonnet       │
│  Closed-loop watermark    ████░░░░░░░░░░░░ Opus only                    │
│  Input-bound hash         ████░░░░░░░░░░░░ Opus only                    │
│  Behavioral fingerprint   ████░░░░░░░░░░░░ Opus only                    │
│  Database schema          ████░░░░░░░░░░░░ Sonnet only                  │
│  Testing strategy         ████░░░░░░░░░░░░ Sonnet only                  │
│  Monitoring/alerts        ████░░░░░░░░░░░░ Sonnet only                  │
│  Minimal payloads         ████░░░░░░░░░░░░ Opus only                    │
│  Edge case handling       ████████░░░░░░░░ Composer best                │
│  Endpoint contracts       ████████░░░░░░░░ GPT, Sonnet                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

**End of Analysis Report**
