## Objective
Ship **secure, verifiable score submissions** for WAM HTML5 games where:
- the **public game SDK shape remains unchanged** (same calls/events; no breaking changes),
- the backend can verify **data integrity** and **real-time density** without simulating gameplay,
- payouts/tournaments are protected by **cryptographic proofs + server-paced time gating**,
- the system remains practical across web + mobile web + webviews.

This plan assumes:
- The **device-bound DPoP key** exists as a **non-extractable `CryptoKey`** in IndexedDB under the **`win.wam.app` (parent) origin**.
- Passkeys are **optional**, but we can require **one passkey prompt per app session** for payout/tournament tiers.
- Score is submitted **at end-of-run (death)** (the parent keeps a memory stack then submits).

---

## Reality check (why this needs backend touchpoints)
If the backend only sees a single final “submit score” call, an attacker can generate any number of “per-window proofs” in a burst (because the runtime can ask the signer repeatedly). That means you can get **integrity** but not **real-time density**.

**Conclusion:** to enforce density, you must add **server-issued, time-gated nonces per window** (or an equivalent time oracle the attacker can’t forge). This can be done with very lightweight endpoints backed by Redis/Lua.

---

## Threat model (what we defend, what we don’t)
- **Attacker controls the game and SDK JS runtime** (debugger/injection/rewrites/replay).
- We do **not** prove game logic correctness.
- We aim to prevent or strongly detect:
  - offline fabricated runs,
  - time-compressed runs (fast-forward),
  - replayed submissions,
  - post-hoc transcript edits,
  - large-scale automated farming for payouts.

We assume:
- attacker cannot forge signatures from the **non-extractable** DPoP key,
- attacker cannot forge passkey assertions without an authenticator.

---

## Architecture overview
There are 3 execution contexts:

1) **Game iframe** (untrusted)
- Runs the existing SDK script.
- Emits the same `postMessage` events as today (score/state/level/fail).

2) **Parent container** (`win.wam.app`, trusted-by-policy)
- Owns the DPoP key in IndexedDB.
- Performs all privileged crypto (DPoP signing, optional passkey).
- Owns networking to backend.
- Maintains the “memory stack” and submits at death.

3) **Backend** (authoritative)
- Issues time-gated window nonces.
- Verifies signatures and enforces density + integrity rules.
- Continues to run your existing game-specific validation (Redis/Lua), now augmented with verified session facts.

**Non-breaking rule:** game-facing SDK API and events remain identical; all new security is additive and internal.

---

## Core mechanism
### 1) Transcript commitment (rolling hash)
Maintain a rolling commitment over canonicalized events derived from existing SDK messages:
- init/settings
- score updates (`SDK_PLAYER_SCORE_UPDATE`)
- level ups (`SDK_PLAYER_LEVEL_UP`)
- run end/death (`SDK_PLAYER_FAILED`)
- internal checkpoints (not visible to game)

Rolling hash:
- `R0 = H(init)`
- `Ri = H(Ri-1 || encode(event_i))`

**Canonical encoding requirements**:
- deterministic field ordering
- explicit schema version
- strict length caps
- normalize types (string/number)

### 2) Real-time density via server-paced windows
Partition time into windows of duration `W` (e.g., 5000ms).
- The backend is the time oracle.
- The client can only validate window `wIndex` after the backend says it’s time.

### 3) Per-window DPoP checkpoint signatures
For each validated window, sign a digest bound to:
- session
- server nonce for that window
- rolling hash (integrity)
- score/state snapshot (plausibility)
- code identity (anti “swap game build”)

Digest:
`checkpointDigest = H(sessionId || wIndex || nonceW || rollingHash || scoreSoFar || stateTag || codeHash || sdkVersion)`

Signature:
`dpopSig = Sign_deviceKey(checkpointDigest)`

### 4) Optional “one per app session” passkey anchor
For payout/tournaments, require exactly once per app session:
- create a passkey assertion over:
  `passkeyDigest = H(appSessionId || playerId || deviceKeyThumbprint || issuedAt || policyId)`

Then store in parent memory and reuse as a gating credential for subsequent game sessions in the same app session.

**Important:** passkey is for **tier gating + user presence**, not for density (density is enforced by server window pacing).

---

## Protocols & endpoint contracts
### A) Backend: start session
`POST /score/session/start`

**Request** (parent -> backend):
- `playerId`
- `gameId`
- `mode` (casual/tournament/payout)
- `sdkVersion`
- `deviceKeyThumbprint` (stable ID of DPoP public key)
- `codeHash` (server should verify this against game registry; do not trust arbitrary value)
- optional: `passkeyProof` (if tier requires and available)

**Response**:
- `sessionId`
- `policyId`
- `windowMs` (`W`)
- `startAtServerMs`
- `minValidatedWindows`
- `maxScoreDeltaPerWindow` (optional per game/mode)
- `expectedCodeHash` (authoritative)

**Redis state** (keyed by `sessionId`):
- `playerId, gameId, mode, policyId`
- `expectedCodeHash, sdkVersion`
- `wIndex = 0`
- `nextWindowAt = startAtServerMs + W`
- `validatedWindows = 0`
- `lastRollingHash = R0`
- `lastScore = 0` (or initial)
- `lastStateTag`
- `nonceW` (current issued nonce if using 2-step issuance)


### B) Backend: issue nonce for next window (time gate)
Two implementation options:

**Option B1 (1-step):** combined issue+verify
- `POST /score/session/checkpoint`
- server enforces `now >= nextWindowAt`, increments window, and verifies signature in one call.

**Option B2 (2-step):** issue then prove
- `POST /score/session/window` -> returns `nonceW` once time gate passes
- `POST /score/session/checkpoint` -> client returns signature over that nonce

Recommendation: **Option B1** to reduce round trips, unless you want explicit “waitMs” UX.


### C) Backend: checkpoint verify (recommended single-step)
`POST /score/session/checkpoint`

**Request**:
- `sessionId`
- `rollingHash`
- `scoreSoFar`
- `stateTag`
- `dpopSig`

**Server-side steps**:
1) Load session from Redis.
2) Time gate:
   - if `now < nextWindowAt` => reject with `retryAfterMs`.
3) Set `wIndex = wIndex + 1`.
4) Create `nonceW = H(serverSecret || sessionId || wIndex || nextWindowAt)` (or random).
5) Compute expected digest:
   `checkpointDigest = H(sessionId || wIndex || nonceW || rollingHash || scoreSoFar || stateTag || expectedCodeHash || sdkVersion)`
6) Verify `dpopSig` against the registered public key for `deviceKeyThumbprint`.
7) Plausibility checks (configurable):
   - `scoreSoFar - lastScore <= maxScoreDeltaPerWindow`
   - allowed state transitions
   - monotonicity rules per game/mode
8) Update Redis:
   - `validatedWindows++`
   - `lastRollingHash = rollingHash`
   - `lastScore = scoreSoFar`
   - `lastStateTag = stateTag`
   - `nextWindowAt += W`
9) Return:
   - `wIndex`
   - `nonceW` (optional to return for audit/debug)
   - `validatedWindows`

**Why this works:** the client cannot obtain validated windows faster than real time because the backend refuses to advance.


### D) Existing endpoint: submit score at death (augmented)
Keep your existing score submission endpoint and Lua validation, but accept optional session data.

`POST /score/submit`

**Existing fields**: unchanged.

**Additive fields**:
- `sessionId`
- `finalScore`
- `finalRollingHash`
- `validatedWindows`
- `claimedTimeMs = validatedWindows * W`
- `policyId`
- optional: `passkeyProofRef` (or the proof itself)

**Backend checks**:
- session exists and belongs to player/game/mode
- `finalScore` equals last checkpoint score (or within allowed range)
- `validatedWindows >= minValidatedWindows` for payout/tournament
- finalize session state (mark used/closed, prevent replay)
- run existing game-specific Lua checks using **verified** values (time, window count, last score trajectory bounds)


### E) Anti-replay and idempotency
- `sessionId` is single-use; after final submit, mark session as closed.
- Checkpoint endpoint enforces monotonic `wIndex` via Redis state.
- If a checkpoint request is retried, allow idempotency by including a client `checkpointSeq` (optional) or by allowing “same rollingHash within same wIndex” semantics.

---

## Parent container responsibilities (`win.wam.app`)
### 1) Own the crypto
- DPoP signer uses the non-extractable key in IndexedDB.
- Passkey prompt (if required) happens once per app session; store result only in memory.

### 2) Own the session
- On game start (when you send `SDK_START_GAME[_FROM_ZERO]`), parent calls `/score/session/start`.
- Parent maintains:
  - `sessionId`
  - rolling hash state (or receives rolling hash updates from SDK)
  - current `scoreSoFar` from SDK events
  - checkpoint timer (every `W`)

### 3) Run checkpoints
Every `W` ms:
- take current `rollingHash`, `scoreSoFar`, `stateTag`
- call `/score/session/checkpoint` with `dpopSig`
- store `validatedWindows` locally for UI/telemetry

### 4) Submit on death
When parent receives `SDK_PLAYER_FAILED`:
- stop checkpoint loop
- submit to existing `/score/submit` with `sessionId`, final hash, window count, time

---

## Game iframe SDK responsibilities (non-breaking additions)
Even if parent owns networking, the iframe SDK can still provide value without changing game API:

- **TranscriptRecorder** (internal-only):
  - observe the same events it already sends
  - update `rollingHash`
  - optionally `postMessage` a compact `rollingHashUpdate` to parent (internal controller/type)

- **No new public methods**.
- **No changed semantics** of `setProgress`, `setLevelUp`, `setPlayerFailed`.

If you prefer to keep all logic in parent, iframe SDK can remain unchanged and parent can compute rolling hash from the same messages it already receives.

---

## Data model (canonical)
### Transcript event (stored/hashed)
- `v`: schema version
- `t`: event type
- `ms`: elapsed ms since session start (optional; informational)
- `score`, `level`, `state`
- `wIndex`: current window index (optional)

### Checkpoint record (server-verified)
- `sessionId`
- `wIndex`
- `serverTimeWindowAt`
- `rollingHash`
- `scoreSoFar`
- `stateTag`
- `checkpointDigest`
- `dpopSig`

Store full records in logs/DB for audit; keep only aggregates in Redis.

---

## Policy tiers (shipping-friendly)
### Tier 0: legacy
- accept current submit payload
- no density enforcement

### Tier 1: shadow integrity
- compute rolling hash and submit as optional
- server stores but does not enforce

### Tier 2: density enforced (payout/tournament)
- require session + validated windows
- enforce time gating + DPoP signature validity
- clamp or reject if insufficient windows

### Tier 3: density + passkey gate
- require one passkey per app session for payout/tournament
- sessions without passkey are ineligible for payouts (can still play)

---

## Integration with existing Redis/Lua per-game validation
Today you validate parameters for each game in Lua. Keep that, but feed it **verified** fields:
- `claimedTimeMs` (from validated windows)
- `validatedWindows`
- `scoreTrajectory` constraints (max delta per window)
- `mode/policyId`

Practical approach:
- Extend your Lua script interface to accept these new fields.
- For each game mode, define:
  - `W`
  - `minValidatedWindows`
  - `maxScoreDeltaPerWindow`
  - allowed state transitions

---

## Optional: auxiliary signals (not acceptance criteria)
Canvas/input telemetry and steganographic watermarks are **not cryptographic trust roots** under this threat model. If you want them:
- use only for **risk scoring** / audit
- never as sole eligibility for payout

---

## Rollout plan (no breakage)
1) **Shadow mode in production**
   - parent starts sessions + checkpoints
   - backend verifies signatures and density
   - no payout impact; log reject reasons

2) **Enable enforcement for a single tournament mode**
   - require `validatedWindows >= min`
   - reject or downgrade sessions missing density

3) **Expand to payouts**
   - add passkey gate (one per app session)
   - tune per-game window rules

4) **Hardening**
   - idempotency, rate limits, abuse protection
   - analytics dashboards: failure modes, drop-off, false positives

---

## Success criteria
- **Cannot compress time**: attacker can’t produce N validated windows faster than N*W.
- **Cannot replay**: session IDs and window nonces are single-use.
- **Cannot post-edit**: rolling hash binds the transcript snapshots to verified checkpoints.
- **Operationally shippable**: only a few lightweight endpoints; Redis/Lua friendly; no game integration changes.

---

## Open items (implementation decisions)
- Choose Option B1 (single-step checkpoint) vs B2 (issue nonce then prove). Default: **B1**.
- Decide whether rolling hash is computed in iframe SDK or in parent (recommended: **parent**, since it already sees all events).
- Decide the canonical hash function (recommended: `SHA-256`) and encoding (recommended: stable JSON + UTF-8).
- Decide how to derive/represent `deviceKeyThumbprint` and how the backend maps it to a public key.
