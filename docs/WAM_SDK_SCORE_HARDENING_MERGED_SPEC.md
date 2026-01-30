# WAM Score Hardening (Merged Spec)

**Status:** Implementation Spec (merged)  
**Audience:** SDK + Platform (GameBox) + Backend teams  
**Primary goal:** secure, verifiable, real-time–paced score submissions for payouts/tournaments without deterministic server scoring.

---

## 0) Non-negotiables

### 0.1 Public SDK compatibility
The **game-facing SDK surface MUST NOT CHANGE**.
- Existing calls from games remain:
  - `digitapSDK('init', hasScore, hasHighScore)`
  - `digitapSDK('setCallback', ...)`
  - `digitapSDK('setProgress', state, score, level)`
  - `digitapSDK('setLevelUp', level)`
  - `digitapSDK('setPlayerFailed', state)`
- Existing `postMessage` event shapes and semantics remain (no breaking changes).

All security mechanisms in this spec are:
- **additive**,
- **feature-flagged**,
- can run in **shadow mode**,
- must **degrade gracefully** (never crash games).

### 0.2 Trust model
- Game iframe is **untrusted** (attacker controls JS/runtime).
- The only trust roots are:
  - backend-issued challenges / time gates,
  - **device-bound non-extractable DPoP `CryptoKey`** stored under **`win.wam.app`** origin,
  - optional: Passkey (WebAuthn) once per app session,
  - optional: worker wallet signature (existing gas/voucher identity).

### 0.3 What we prove (and what we do not)
**We prove (for payout/tournament tiers):**
- **Real-time density**: the session progressed across server-paced windows (no time compression).
- **Integrity**: checkpoints and the final claim are bound to an append-only transcript commitment.
- **Device possession**: device-bound key produced signatures at required windows.
- **Replay resistance**: window nonces + session state prevent reuse.

**We do NOT prove:**
- Correctness of game logic or that the “score is correct” in an absolute sense.

This system is designed to make cheating **harder, slower, and detectable**, and to provide an objective verification story for users.

---

## 1) System architecture

### 1.1 Components
1) **Game iframe** (third-party HTML5, untrusted)
- Includes existing SDK.
- Continues to send the same progress events to parent.

2) **Parent container (GameBox)** on `win.wam.app` (trusted-by-policy)
- Owns DPoP key (non-extractable) in IndexedDB.
- Optionally prompts passkey once per app session.
- Maintains per-run session state, computes/maintains rolling hash (recommended), and talks to backend.

3) **Backend (score service)**
- Issues time gates and verifies proofs.
- Keeps minimal per-session state in Redis.
- Feeds verified outputs into existing per-game Lua validation + payout logic.

### 1.2 Data planes
- **Compatibility plane** (already exists): iframe SDK -> parent `postMessage` score/state/level events.
- **Security plane** (new): parent <-> backend session/checkpoint/submit calls.
- **Optional risk plane** (new, non-critical): input sketch / canvas sampling signals for confidence scoring.

---

## 2) Mode policies (enforcement tiers)

All enforcement is **mode-based** and **feature-flagged per game + platform + mode**.

### 2.1 Modes
- **CASUAL (low stake)**
  - may run shadow-only or relaxed enforcement.
  - can accept sessions without passkey.

- **TOURNAMENT (payout)**
  - requires real-time density.
  - requires minimum validated windows.
  - passkey recommended; can be required depending on tournament rules.

- **DEGEN/HIGH_STAKE**
  - strict density + passkey gate + tighter score delta constraints.
  - optional extra: platform attestation (Android Play Integrity / iOS App Attest) if available.

### 2.2 Recommended defaults
- `W = 5000ms` (window duration)
- `minValidatedWindows`:
  - casual: 0–2
  - tournament: 6+ (>= 30s)
  - degen: 12+ (>= 60s)
- `maxScoreDeltaPerWindow`: configured per game and mode.

---

## 3) Canonical transcript commitment

### 3.1 Event sources
Transcript events are derived from **existing, already-emitted SDK events** plus internal checkpoint events.

Minimum transcript event types:
- `init`
- `score_update` (from `SDK_PLAYER_SCORE_UPDATE`)
- `level_up` (from `SDK_PLAYER_LEVEL_UP`)
- `failed` (from `SDK_PLAYER_FAILED`)
- `checkpoint` (per window, internal)

### 3.2 Canonical encoding
To avoid hash ambiguity, encoding MUST be canonical:
- deterministic field ordering
- explicit version `v`
- strict type normalization (numbers as integers where expected)
- length caps

**Canonical JSON** is acceptable if the canonicalizer is deterministic and shared across implementations.

### 3.3 Rolling hash
Use SHA-256.
- `R0 = SHA256( encode(initEvent) )`
- For each event `Ei`:
  - `Ri = SHA256( Ri-1 || SHA256(encode(Ei)) )`

Notes:
- This avoids variable-length concatenation ambiguity.
- Store `rollingHash` as 32-byte hex.

### 3.4 Where hashing runs
Recommended: **parent container** computes transcript/rolling hash because:
- the iframe is untrusted,
- the parent already observes all events,
- the parent owns networking and keys.

Iframe-side transcript is optional (shadow-only) but never trusted over parent.

---

## 4) The critical mechanism: server-paced window density

### 4.1 Why client-only density is insufficient
If the client controls window advancement, they can:
- accelerate timers / `performance.now`,
- generate “windows” instantly,
- request signatures repeatedly.

Therefore, real-time density requires the backend to act as the time oracle.

### 4.2 Window model
- Backend defines `W` in ms.
- A session has windows `wIndex = 1..N`.
- A window is **validated** only if:
  - the backend allows the window (time gate), and
  - the client submits a valid DPoP signature over a server-derived nonce.

### 4.3 Server time gate state
For each session, backend stores:
- `wIndex` (last validated)
- `nextWindowAtMs` (server epoch ms)
- `validatedWindows`
- last accepted `rollingHash`, `scoreSoFar`, `stateTag` (for plausibility)

### 4.4 Nonce per window
Backend must generate/derive a nonce unique to `(sessionId, wIndex)`.
Two acceptable patterns:
- **Random nonce** stored in Redis for that window.
- **Derived nonce**: `nonceW = H(serverSecret || sessionId || wIndex || nextWindowAtMs)`.

Derived nonce avoids storing per-window nonce; still unique and unpredictable.

---

## 5) DPoP checkpoint proof (device binding)

### 5.1 Preconditions
- DPoP key is a non-extractable `CryptoKey` under `win.wam.app` origin.
- Backend can map a stable identifier (thumbprint/jkt) to the corresponding public key.

### 5.2 Checkpoint digest
For each window validated by server time gate:

`checkpointDigest = SHA256( encodeCheckpointDigestV1(...) )`

Fields to include (versioned):
- `v = 1`
- `sessionId`
- `wIndex`
- `nonceW` (server-issued/derived)
- `rollingHash` (current)
- `scoreSoFar`
- `stateTag`
- `gameId`
- `codeHash` (server-authoritative expected code hash)
- `sdkSecurityVersion`

**Rationale:**
- binds the signature to the session, time gate, transcript commitment, and claimed score/state.

### 5.3 Signature algorithm
Use the DPoP key’s existing algorithm.
- If your DPoP is ES256 / P-256, then:
  - `crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, digestBytes)`

Store and transmit signatures as base64url.

### 5.4 Checkpoint cadence
- Exactly **one checkpoint per window** for payout modes.
- The parent should schedule checkpoint attempts roughly every `W` and handle early rejections via `retryAfterMs`.

---

## 6) Passkey (optional, but recommended for payout tiers)

### 6.1 UX requirement
Passkey prompts must be **optional** and at most **once per app session**.

### 6.2 Passkey purpose
Passkey is NOT the density mechanism.
Passkey is used for:
- stronger “user presence” gate for payouts,
- raising cost of bot farms,
- binding sessions to a verified user presence event.

### 6.3 App-session passkey token
At app session start (or first time entering payout mode), parent requests a WebAuthn assertion:
- `challenge = SHA256( v || appSessionId || userId || deviceKeyThumbprint || issuedAt || policyId )`
- require `userVerification = 'required'` for payout tiers.

Store the resulting WebAuthn assertion in **memory only** and reference it from subsequent sessions (until page reload / app restart).

Backend verifies the passkey assertion once and returns a short-lived `passkeySessionToken` (server-signed) that can be attached to score sessions.

---

## 7) Worker wallet binding (optional)

### 7.1 Purpose
Bind the final score claim to the same cryptographic identity used in your gas/voucher pipeline.

### 7.2 Final claim digest
At end-of-run:

`finalClaimDigest = SHA256( v || sessionId || rollingHashFinal || validatedWindows || finalScore || claimedTimeMs || gameId || codeHash || sdkSecurityVersion || policyId )`

Sign with worker wallet (existing unlock flow; may require passkey depending on your design).

### 7.3 Backend verification
- Verify signature corresponds to expected worker wallet address for the user.
- Treat as an additional integrity anchor, not the density anchor.

---

## 8) Optional risk signals (NOT consensus-critical)

These signals MUST NOT be the sole reason to accept/deny payouts, because the attacker controls the runtime. They are useful for:
- confidence scoring,
- clustering bot farms,
- manual review triggers,
- tuning per-game Lua limits.

### 8.1 Input sketch (behavioral fingerprint)
Parent collects coarse input statistics over windows (not raw events):
- count, entropy buckets, interval variance estimates, touch radius stats, etc.
- compress into fixed-size sketch (e.g., 64 bytes).

Attach to final submit for risk scoring.

### 8.2 Canvas sampling / watermarking
Canvas hashing or LSB steganography MAY be included as a soft signal:
- sample small regions and hash
- detect “frozen canvas” patterns

Do not rely on “encoding scheme secrecy” as a security claim.

### 8.3 Platform attestation (high value)
For native webviews:
- Android Play Integrity
- iOS App Attest / DeviceCheck
Bind attestation nonce to `sessionId`.

This is a stronger signal than any canvas technique.

---

## 9) Backend API (normative)

### 9.1 Endpoint: start session
`POST /score/session/start`

**Request**
- `userId`
- `gameId`
- `mode`
- `sdkSecurityVersion`
- `deviceKeyThumbprint` (jkt)
- `codeHashHint` (optional; backend overrides with expected)
- optional: `passkeySessionToken`

**Response**
- `sessionId`
- `policyId`
- `windowMs` (W)
- `minValidatedWindows`
- `maxScoreDeltaPerWindow`
- `expectedCodeHash`
- `startAtServerMs`

Backend creates Redis state:
- `wIndex=0`
- `nextWindowAtMs = startAtServerMs + W`
- `validatedWindows=0`
- `lastScore=0`, `lastRollingHash=R0`, etc.

### 9.2 Endpoint: checkpoint (single-step, time gated)
`POST /score/session/checkpoint`

**Request**
- `sessionId`
- `rollingHash`
- `scoreSoFar`
- `stateTag`
- `dpopSig` (signature over server-derived nonce and fields)

**Response (success)**
- `wIndex`
- `validatedWindows`
- `nextWindowAtMs`

**Response (early)**
- `retryAfterMs`

**Backend must**:
- enforce `now >= nextWindowAtMs` (time gate)
- increment window
- compute/derive `nonceW`
- verify signature
- run plausibility rules (score delta, transitions)
- update Redis atomically

### 9.3 Endpoint: finalize/submit (augment existing)
You already have a score submission endpoint with per-game Lua checks.

Augment it to accept optional security fields:
- `sessionId`
- `finalScore`
- `rollingHashFinal`
- `validatedWindows`
- `claimedTimeMs = validatedWindows * W`
- `policyId`
- optional: `workerSig`
- optional: `inputSketch`
- optional: `attestation`

Backend must:
- mark session closed (prevent replay)
- feed verified time/windows into existing Lua validators
- apply mode policy (reject/downgrade)

---

## 10) Redis data model (normative)

### 10.1 Keys
- `score:sess:{sessionId}` (hash)
  - `userId, gameId, mode, policyId`
  - `expectedCodeHash`
  - `sdkSecurityVersion`
  - `wIndex`
  - `nextWindowAtMs`
  - `validatedWindows`
  - `lastScore`
  - `lastRollingHash`
  - `stateTag`
  - `closed` (0/1)

Set TTL (e.g., 1–6 hours) depending on max expected session duration.

### 10.2 Atomic checkpoint script (Lua)
Implement `EVALSHA score_checkpoint.lua` that:
- loads session
- rejects if closed
- rejects if now < nextWindowAtMs
- increments wIndex
- derives nonceW
- verifies signature (if verification is not in Lua, then do atomic state updates with a compare-and-set scheme)
- checks score delta / state transitions
- updates `validatedWindows`, `nextWindowAtMs += W`, `last*` fields

**Important implementation note:**
- If signature verification is done in application code (recommended), the Lua script should still enforce monotonic window advancement by using an atomic compare on `wIndex` and a server-derived nonce that the app must return.
- Best design is: Lua does time gate + nonce issuance + state increment; app verifies signature; app confirms consumption via second atomic call. If you want single-call atomicity, do verification in the app but ensure idempotency keys.

(Choose one pattern and document it in code. Do not handwave this; this is where most cheating gaps appear.)

---

## 11) Parent container implementation (normative)

### 11.1 Session lifecycle
- On run start (when parent triggers `SDK_START_GAME[_FROM_ZERO]`):
  - call `/score/session/start`
  - initialize transcript state
  - start checkpoint scheduler

- During run:
  - on every SDK event from iframe, append to transcript and update `rollingHash`
  - every `W` attempt checkpoint:
    - call `/score/session/checkpoint` with current snapshot
    - on `retryAfterMs`, reschedule

- On death (`SDK_PLAYER_FAILED`):
  - stop scheduler
  - finalize transcript
  - submit via existing score endpoint with security fields

### 11.2 Failure handling
- If checkpoint fails transiently: keep session running; window won’t validate; time will clamp.
- If strict mode and repeated failures: downgrade or reject payout eligibility.

### 11.3 Payload minimization
- Do NOT send raw tick streams.
- Checkpoint requests are small: `{ sessionId, rollingHash, scoreSoFar, stateTag, sig }`.
- Final submit includes only aggregates and final commitments.

---

## 12) Security analysis (practical)

### 12.1 Defended attacks
- **Score injection / postMessage forging:** doesn’t help unless attacker also satisfies density gates and plausibility constraints; parent+backend enforce.
- **Replay:** blocked by session closure and per-window gating.
- **Time compression:** blocked because backend refuses to advance windows early.
- **Offline fabrication:** impossible to get validated windows without backend cooperation.

### 12.2 Residual risks
- A bot can still play “in real time” (cannot be eliminated in a client-only game).
- Credential theft + real-time automation remains possible; mitigated by passkey gate + risk scoring + rate limiting.
- Device farms are mitigated by economics and detection, not eliminated.

---

## 13) Performance requirements

### 13.1 RPS sizing
Backend steady-state checkpoint rate:
- `RPS ≈ concurrentPlayers / (W in seconds)`

Recommended defaults:
- W=5s → 2000 concurrent ≈ 400 RPS (easy)

### 13.2 Client overhead
- Rolling hash updates on score/state events are cheap.
- One signature generation per window (in parent) is cheap.
- Avoid heavy canvas operations in consensus path.

---

## 14) Rollout plan (mandatory)

### Phase 0: Shadow (collect only)
- compute rolling hash
- call checkpoint endpoint but do not enforce payout
- log outcomes

### Phase 1: Density enforcement for tournaments
- require `validatedWindows >= minValidatedWindows`
- clamp time and gate rewards

### Phase 2: Add passkey gate (optional)
- require passkey once per app session for payout eligibility

### Phase 3: Tighten per-game heuristics
- max score delta per window, allowed transitions
- incorporate risk signals

Rollback must be immediate via feature flags.

---

## 15) Implementation checklist

### SDK (iframe)
- No breaking changes.
- Optional: expose nothing new publicly.

### Parent (GameBox)
- Implement transcript recorder + rolling hash
- Implement checkpoint scheduler
- Integrate DPoP signing
- Integrate optional passkey session token
- Submit final claim at death

### Backend
- Implement `session/start`, `session/checkpoint`
- Extend existing submit endpoint
- Redis/Lua state machine
- Observability: acceptance/rejection reasons, per-mode metrics

---

## 16) Appendix: normative field lists

### 16.1 Minimal checkpoint snapshot
- `rollingHash` (32 bytes)
- `scoreSoFar` (uint32)
- `stateTag` (short string or enum)

### 16.2 Minimal final claim
- `sessionId`
- `finalScore`
- `rollingHashFinal`
- `validatedWindows`
- `claimedTimeMs`
- `policyId`
- optional: `workerSig`, `passkeySessionToken`, `inputSketch`, `attestation`
