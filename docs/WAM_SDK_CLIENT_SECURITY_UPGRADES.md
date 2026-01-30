# Client Score Hardening Specification (Client-Only, HTML5, Single SDK)

## Table of Contents
- [1. Executive Summary](#1-executive-summary)
- [2. Non-Goals and Constraints](#2-non-goals-and-constraints)
- [3. Existing Security Primitives](#3-existing-security-primitives)
- [4. Threat Model](#4-threat-model)
- [5. Architecture](#5-architecture)
- [6. Core Mechanisms](#6-core-mechanisms)
  - [6.1 Transcript Commitment](#61-transcript-commitment)
  - [6.2 Time and Density Enforcement](#62-time-and-density-enforcement)
  - [6.3 Device-Bound Anchors](#63-device-bound-anchors)
- [7. Reuse: Device-Bound Key and DPoP](#7-reuse-device-bound-key-and-dpop)
- [8. Reuse: Passkey and Passkey-Encrypted Worker Wallet](#8-reuse-passkey-and-passkey-encrypted-worker-wallet)
- [9. On-Chain Commitment](#9-on-chain-commitment)
- [10. Implementation Guide](#10-implementation-guide)
  - [10.1 SDK Update Rules (Do Not Break Production)](#101-sdk-update-rules-do-not-break-production)
  - [10.2 Internal Modules](#102-internal-modules)
  - [10.3 Data Model](#103-data-model)
  - [10.4 Checkpoint Scheduling](#104-checkpoint-scheduling)
  - [10.5 Submission Flow](#105-submission-flow)
- [11. Security Controls](#11-security-controls)
- [12. Configuration](#12-configuration)
- [13. Examples](#13-examples)
  - [13.1 Example Session](#131-example-session)
  - [13.2 Example JSON Payloads](#132-example-json-payloads)
- [14. Backward Compatibility and Rollout](#14-backward-compatibility-and-rollout)

---

## 1. Executive Summary

This spec hardens client-side score submission for licensed HTML5 games using a single SDK across:
- Web (mobile/desktop)
- iOS
- Android
- Telegram Mini App

The system assumes **no trusted client** and avoids any requirement to port third-party games.

It reuses security primitives you already have:
- a **device-bound key** currently used to send **DPoP** headers, and
- a **Passkey** which encrypts a **worker wallet** used to sign backend vouchers for WAM gas transactions.

The SDK produces a tamper-evident gameplay transcript and binds it to **periodic device-bound proofs** so that:
- the transcript cannot be edited after the fact, and
- claimed playtime cannot be compressed without failing proof density rules.

This does **not** prove the game’s internal logic is correct. It proves the score claim is bound to a real-time, device-bound transcript under SDK-enforced rules.

---

## 2. Non-Goals and Constraints

### Non-Goals
- Proving the correctness of third-party game logic (physics, RNG, etc.)
- Preventing all cheating (only preventing and detecting provable manipulation)
- Requiring a server to authoritatively simulate gameplay

### Constraints (Hard Requirements)
- Games are licensed HTML5 titles; you cannot port or rewrite them.
- Each game can only integrate a **simple SDK**.
- The SDK is a **live production dependency**; updates must not break any existing behavior.

---

## 3. Existing Security Primitives

These are assumed to exist and must be reused:

| Primitive | Already Used For | How This Spec Uses It |
|---|---|---|
| Device-bound key | DPoP header signing | Silent, frequent checkpoint signatures |
| DPoP | Proof-of-possession per request | Evidence of device key continuity + anti-replay binding |
| Passkey (WebAuthn) | Unlock/encrypt worker wallet | Strong periodic checkpoint anchor |
| Passkey-encrypted worker wallet | Signing backend vouchers for WAM gas | Optionally co-sign/bind score claim to voucher context |
| Existing SDK hooks | init/state/score/end | Must remain compatible |

---

## 4. Threat Model

### Attacker Capabilities
- Full control over client JS runtime (debugger, script injection, memory editing)
- Can modify game code and SDK code
- Can pause/rewind/fast-forward or run offline
- Can fabricate events and scores

### Attacker Limitations (Assumed)
- Cannot forge signatures from the device-bound key
- Cannot forge valid Passkey assertions without authenticator participation
- Cannot produce valid proofs for time windows they did not actually span (if density is enforced)

---

## 5. Architecture

### High-Level Components
- **Game**: third-party HTML5 game (untrusted)
- **SDK**: trusted-by-policy, but not by attacker; must be tamper-evident
- **Anchors**:
  - frequent: device-bound key (DPoP key)
  - periodic: Passkey (user/device authenticator)
- **Transcript**: append-only log commitment
- **On-chain commit**: minimal anchoring of the claim and anchor commitment

### Primary Outputs at Session End
- `rollingHash` (commitment to all transcript events)
- `anchorsHash` (commitment to checkpoint proofs)
- `finalScore`, `claimedTimeMs`, `sessionId`, `sdkVersion`, `codeHash`

---

## 6. Core Mechanisms

### 6.1 Transcript Commitment

The SDK maintains a rolling commitment over session events:

- Start:
  - `R0 = H(initPayload)`
- Each event:
  - `Ri = H(Ri-1 || encode(event_i))`

`encode(event_i)` MUST be:
- canonical (deterministic field ordering)
- length-limited (hard caps)
- versioned (schema version included)

Events include at least:
- state transitions (`init`, `playing`, `dead`, `end`)
- score updates
- periodic checkpoints (see below)

A Merkle tree is optional. Rolling hash is the minimum.

### 6.2 Time and Density Enforcement

Time is partitioned into fixed windows of duration `W` milliseconds.

Rules:
1. The SDK only credits “played time” for windows that contain a valid checkpoint proof.
2. Claimed playtime MUST be derived from the number of validated windows:
   - `claimedTimeMs = validatedWindows * W`
3. If the game reports more time than validated windows allow, the SDK MUST clamp time to the validated value.

Purpose:
- prevents time compression (fast-forwarding)
- prevents offline transcript fabrication without periodic proofs

### 6.3 Device-Bound Anchors

Two anchor levels are used:

1. **Frequent checkpoint (silent)** using device-bound key (DPoP key)
2. **Periodic strong checkpoint** using Passkey (WebAuthn assertion)

The frequent anchor provides high granularity. The strong anchor provides high assurance.

---

## 7. Reuse: Device-Bound Key and DPoP

### 7.1 What It Proves
- Possession of the device-bound key at checkpoint time
- Continuity across the session when counters/time-window indexing is enforced
- Anti-replay binding when the signed message includes session-scoped material

### 7.2 Checkpoint Signature Payload

For each time window `wIndex`, generate:

- `checkpointDigest = H(sessionId || wIndex || rollingHash || scoreSoFar || stateTag)`

Then sign:

- `dpopSig = Sign_deviceKey(checkpointDigest)`

Store:
- `wIndex`
- `checkpointDigest`
- `dpopSig`
- optional DPoP metadata if available (e.g., JWK thumbprint, iat)

### 7.3 How It Is Used
- Include `H(dpopSig)` into transcript events for that window.
- Add the full checkpoint object to the anchor bundle committed by `anchorsHash`.

### 7.4 Limits
- DPoP signing alone does not enforce user presence.
- A compromised device/runtime can still call signing APIs; strong checkpoints mitigate this.

---

## 8. Reuse: Passkey and Passkey-Encrypted Worker Wallet

### 8.1 Passkey Strong Checkpoint

Every `P` windows (e.g., every 6 windows = 30s if W=5s), request a Passkey assertion over:

- `passkeyDigest = H(sessionId || windowRange || rollingHash || scoreSoFar || codeHash || sdkVersion)`

Collect:
- `authenticatorData`
- `clientDataJSON`
- `signature`
- `credentialId`

Store the Passkey checkpoint object in the anchor bundle.

### 8.2 Binding to Worker Wallet / Gas Voucher Context

You already have:
- a Passkey that unlocks/encrypts a worker wallet
- that wallet signs backend vouchers for WAM token gas transactions

Use this in score submission as follows:

- At `SDK.end()` (or optionally at each strong checkpoint):
  1. Unlock the worker wallet via Passkey (existing flow).
  2. Sign a `scoreClaimDigest`:

     - `scoreClaimDigest = H(sessionId || rollingHash || anchorsHash || finalScore || claimedTimeMs || gameId || codeHash || sdkVersion)`

  3. `workerSig = Sign_workerWallet(scoreClaimDigest)`

Rationale:
- Ties score claim to the same cryptographic identity already used in your gas/voucher pipeline.
- Reduces proliferation of new trust roots.
- Enables backend/voucher flows to refuse to relay on-chain score commits without the bound signature.

### 8.3 Limits
- Worker wallet signature proves the wallet signed; it does not by itself prove real time.
- Strong checkpoints still required for real-time anchoring.

---

## 9. On-Chain Commitment

### 9.1 Minimal On-Chain Data

Store only what is required to “set it in stone”:

- `sessionId`
- `player` (account / smart account)
- `rollingHash`
- `anchorsHash`
- `finalScore`
- `claimedTimeMs`
- `gameId`
- `sdkVersion`
- `codeHash`

Optional:
- `workerSig` (if you want on-chain binding to the worker wallet identity)

### 9.2 Why Minimal
- Signature verification for WebAuthn on-chain is expensive and not uniform.
- The chain should anchor integrity; verification is public off-chain initially.
- Upgrades can add zk verification later without changing the commitment format.

---

## 10. Implementation Guide

### 10.1 SDK Update Rules (Do Not Break Production)

Hard requirements:
- Do not change semantics of existing public SDK APIs.
- All new behavior must be:
  - additive
  - feature-flagged
  - capable of running in “observe only” mode
- Failure to obtain anchors MUST degrade gracefully (policy-controlled), not crash games.

### 10.2 Internal Modules

Add internal components:

- `TranscriptRecorder`
  - canonical encoding
  - rolling hash maintenance
- `WindowClock`
  - defines window index progression from monotonic time
- `CheckpointEngine`
  - schedules frequent and strong checkpoints
- `AnchorBundle`
  - collects proofs and computes `anchorsHash`
- `ScoreClaimBuilder`
  - generates final claim for submission

### 10.3 Data Model

#### Transcript Event (canonical)
```json
{
  "v": 1,
  "t": "score|state|checkpoint",
  "w": 12,
  "ms": 51234,
  "score": 4200,
  "state": "playing",
  "anchorRef": "0x..." 
}
```

`anchorRef` is a hash pointer (e.g., H(dpopSig) or H(passkeySig)), not the full proof.

#### Frequent Checkpoint Object
```json
{
  "type": "dpop",
  "wIndex": 12,
  "checkpointDigest": "0x...",
  "dpopSig": "0x..."
}
```

#### Strong Checkpoint Object
```json
{
  "type": "passkey",
  "wFrom": 12,
  "wTo": 17,
  "passkeyDigest": "0x...",
  "credentialId": "base64url...",
  "authenticatorData": "base64url...",
  "clientDataJSON": "base64url...",
  "signature": "base64url..."
}
```

#### Anchor Bundle Commitment
- `anchorsHash = H(canonicalSerialize(checkpoints[]))`

### 10.4 Checkpoint Scheduling
Defaults (configurable):
	•	Window duration W = 5000ms
	•	DPoP checkpoint: every window (each 5s)
	•	Passkey checkpoint: every P windows (e.g., every 6 windows = 30s)

Rules:
	•	If DPoP checkpoint fails for a window, that window is not validated.
	•	If Passkey checkpoint fails, session policy decides:
	•	reject (strict modes: tournaments, rewards)
	•	downgrade (casual mode: no rewards / off-chain leaderboard only)

### 10.5 Submission Flow
At SDK.end():
	1.	Finalize transcript: compute rollingHash.
	2.	Finalize anchor bundle: compute anchorsHash.
	3.	Compute claimedTimeMs from validated windows.
	4.	Build scoreClaimDigest and optionally sign with worker wallet (workerSig).
	5.	Return a payload ready for on-chain submission (or backend relay).

## 11. Security Controls
Controls (Enforced)
	•	Rolling hash integrity (any edit breaks rollingHash)
	•	Proof density vs claimed time (prevents time compression)
	•	Per-window DPoP signatures (device possession continuity)
	•	Periodic Passkey assertions (strong real-time anchor)
	•	Optional worker wallet binding to claim (ties into existing voucher/gas pipeline)

Controls (Configurable)
	•	Maximum score delta per window
	•	Allowed state transitions (init -> playing -> dead/end)
	•	Minimum validated windows required
	•	Strictness tiers by game mode (casual vs tournament vs degen)

## 12. Configuration
```json
{
  "windowDurationMs": 5000,
  "dpopEveryWindow": true,
  "passkeyIntervalWindows": 6,
  "minValidatedWindows": 3,
  "maxScoreDeltaPerWindow": 500,
  "policy": {
    "onPasskeyFailure": "reject|downgrade",
    "onDPoPFailure": "clamp_time",
    "onAnchorUnavailable": "unverified"
  }
}
```

## 13. Examples

### 13.1 Example Session
Config:
	•	W = 5s
	•	P = 6 (Passkey every 30s)

Session:
	•	Total duration: 60s -> 12 windows
	•	Required:
	•	12 DPoP checkpoints (one per window)
	•	2 Passkey checkpoints (windows 0-5, 6-11)

If the client only produces 8 DPoP checkpoints:
	•	claimedTimeMs = 8 * 5000 = 40000ms
	•	Any payout rule keyed to time uses 40s, not 60s.

### 13.2 Example JSON Payloads
Final score claim payload (off-chain / for relay)
```json
{
  "sessionId": "0xabc...",
  "gameId": 101,
  "sdkVersion": 7,
  "codeHash": "0xdef...",
  "rollingHash": "0x123...",
  "anchorsHash": "0x456...",
  "finalScore": 4200,
  "claimedTimeMs": 60000,
  "workerSig": "0x789..."
}
```

### 14. Backward Compatibility and Rollout
Requirements:
	•	Must ship in shadow mode first:
	•	collect transcript + anchors
	•	do not enforce
	•	compare enforcement outcomes vs current production outcomes
	•	Feature flags:
	•	per game
	•	per mode (casual/tournament/degen)
	•	per platform
	•	Gradual enforcement:
	1.	produce commitments only
	2.	clamp time only
	3.	require Passkey checkpoints for reward-bearing modes
	•	Legacy sessions remain valid under old rules.

End.