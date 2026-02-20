---
name: SDK Worker Refactor
overview: Refactor the SDK security module into a thin iframe shim (no crypto, no processing) and a standalone Security Worker (all crypto, hashing, sketch building). Both artifacts are built from this repo. GameBox loads the worker separately.
todos:
  - id: worker-types
    content: Create `src/worker/types.ts` - Define worker message protocol interfaces (InitSession, ProcessCheckpoint, ComputeFinalHash, and their response types)
    status: completed
  - id: worker-crypto
    content: Create `src/worker/crypto.ts` - Move all keccak256 functions, rolling hash, encoding utils from `security/utils.ts`. Add `computeInputDigest()` and `computeCanvasHash()` functions.
    status: completed
  - id: worker-sketch
    content: Move `src/security/SketchBuilder.ts` to `src/worker/SketchBuilder.ts` - Adapt to accept raw event tuples instead of RawInputEvent objects
    status: completed
  - id: worker-entry
    content: Create `src/worker/index.ts` - Worker entry point with `self.onmessage` handler. Processes INIT_SESSION (creates rolling hash state), PROCESS_CHECKPOINT (computes digest + hash + sketch + rolling hash), COMPUTE_FINAL_HASH (session end)
    status: completed
  - id: slim-input
    content: Simplify `src/security/InputCapture.ts` - Remove normalization. `flush()` returns raw compact tuples. Remove digest computation.
    status: completed
  - id: slim-canvas
    content: Simplify `src/security/CanvasHandler.ts` - Remove all crypto imports. `sample()` returns raw Uint8Array pixels. Remove embed/extract. Keep WebGL snapshot + canvas finder.
    status: completed
  - id: slim-bridge
    content: "Rewrite `src/security/SecurityBridge.ts` as thin shim (~80 lines). Remove all crypto imports, rolling hash state, sketch building. On checkpoint request: read raw buffer from InputCapture, read raw pixels from CanvasReader, send raw data to parent."
    status: completed
  - id: slim-cleanup
    content: Clean up `src/security/` - Update index.ts exports, delete or gut utils.ts (remove crypto, keep minimal encoding if needed), delete SketchBuilder.ts from security/
    status: completed
  - id: update-sdk
    content: Update `src/index.ts` - Remove computeStateHash calls from setLevelUp/setPlayerFailed, remove stateHash from progress payloads
    status: completed
  - id: update-types
    content: Update `src/types/index.ts` - Simplify CheckpointResponse to raw data, add compact event tuple type, remove computed hash fields from SDK responses
    status: completed
  - id: update-webpack
    content: Update `webpack.config.js` - Add worker entry point, produce `security-worker.min.js` alongside `main.min.4.js`, configure separate optimization for worker bundle
    status: completed
  - id: verify-build
    content: Run build, verify both artifacts compile, check bundle sizes
    status: completed
isProject: false
---

# SDK Security: Web Worker Refactor

## Problem

1. All security code runs on game's main thread (same JS context = fully bypassable)
2. Crypto/hashing disabled because it kills Android performance
3. Rolling hash, input digest, canvas hash, sketch all return `0x0`

## Solution

Split into two build artifacts from this repo:

- **SDK shim** (`main.min.4.js`) - ultra-thin, no crypto, just captures raw data
- **Security Worker** (`security-worker.min.js`) - all crypto, runs in GameBox's worker thread

## Architecture

```mermaid
flowchart TB
  subgraph iframe ["Game Iframe"]
    Game["Game Code"]
    Shim["SDK Security Shim"]
    IC["InputCapture (raw buffer)"]
    CR["CanvasReader (raw pixels)"]
    MC["MetadataCollector"]
    Shim --> IC
    Shim --> CR
    Shim --> MC
  end

  subgraph gamebox ["GameBox (Parent)"]
    Orch["Security Orchestrator"]
    subgraph worker ["Security Worker (separate thread)"]
      WE["Worker Entry"]
      RH["RollingHash Engine"]
      SB["SketchBuilder"]
      Crypto["keccak256 / crypto"]
      WE --> RH
      WE --> SB
      WE --> Crypto
    end
    Orch -->|"Worker.postMessage"| WE
  end

  Shim -->|"postMessage (raw bytes)"| Orch
```



## File Changes

### New Files (Worker)

- **[src/worker/types.ts](src/worker/types.ts)** - Worker message protocol (GameBox main thread <-> Worker thread)
- **[src/worker/crypto.ts](src/worker/crypto.ts)** - All keccak256 functions, rolling hash computation, encoding utils (moved from `security/utils.ts`)
- **[src/worker/SketchBuilder.ts](src/worker/SketchBuilder.ts)** - Moved from `security/SketchBuilder.ts` (unchanged logic, runs in worker now)
- **[src/worker/index.ts](src/worker/index.ts)** - Worker entry point: `self.onmessage` handler that processes `INIT_SESSION`, `PROCESS_CHECKPOINT`, `COMPUTE_FINAL_HASH`

### Rewritten Files (SDK Shim)

- **[src/security/SecurityBridge.ts](src/security/SecurityBridge.ts)** - Gutted to ~80 lines. No crypto imports. On `SDK_CHECKPOINT_REQUEST`: reads raw event buffer from InputCapture, reads raw pixels from CanvasReader, forwards raw bytes to parent. No hashing, no sketch, no rolling state.
- **[src/security/InputCapture.ts](src/security/InputCapture.ts)** - Simplified. Removes normalization logic. `flush()` returns raw `{t, x, y, e}` tuples as a `Float32Array` (compact, transferable). No digest computation.
- **[src/security/CanvasHandler.ts](src/security/CanvasHandler.ts)** - Renamed conceptually to "CanvasReader". Removes `keccak256Bytes` import, `sample()` returns raw `Uint8Array` pixel data (no hashing). Removes `embed()`/`extract()` (steganography moves to worker or GameBox). Keeps WebGL snapshot logic.

### Updated Files

- **[src/security/index.ts](src/security/index.ts)** - Remove `SketchBuilder` export (moved to worker). Remove `MetadataCollector` if folded into shim.
- **[src/security/utils.ts](src/security/utils.ts)** - DELETE or reduce to just `bytesToHex`/`hexToBytes` if shim needs encoding. All crypto moves to `worker/crypto.ts`.
- **[src/index.ts](src/index.ts)** - Remove `computeStateHash()` calls from `setLevelUp()` and `setPlayerFailed()`. Remove `stateHash` from progress. The shim's `computeStateHash` method is removed entirely.
- **[src/types/index.ts](src/types/index.ts)** - Simplify `CheckpointResponse` to carry raw data (events as typed array, pixels as `Uint8Array`). Remove `inputDigest`, `canvasHash`, `rollingHash`, `sketch` from SDK response (worker computes these).
- **[webpack.config.js](webpack.config.js)** - Add second entry point for worker. Produce `security-worker.min.js` with same Terser config but WITHOUT `webpack-obfuscator` domain lock (worker runs in GameBox origin, not game iframe origin).

### Deleted Files

- **[src/security/SketchBuilder.ts](src/security/SketchBuilder.ts)** - Moved to `src/worker/SketchBuilder.ts`

## Key Design Decisions

- **Raw data transfer**: SDK shim sends `Float32Array` for events and `Uint8Array` for pixels. These are [Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects) so `postMessage` uses zero-copy transfer.
- **Worker is a separate webpack entry**: produces a standalone `.js` file. GameBox can load it as `new Worker(url)` or inline it as a Blob.
- **No `@noble/hashes` in SDK bundle**: the SDK shim has zero crypto dependencies. Smaller bundle, faster load, less attack surface.
- **MetadataCollector stays in SDK**: it's 44 lines, no crypto, just reads `screen.width` etc. Stays in shim.
- **Canvas embed/extract (steganography)**: moves to worker conceptually, but actual pixel writing still requires DOM access. Will be handled via a two-step flow: worker computes watermark bytes, sends to shim via GameBox, shim writes pixels. This is a follow-up concern - checkpoint flow is priority.

