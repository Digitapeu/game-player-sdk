/**
 * Security Worker Entry Point
 *
 * Runs in a dedicated Web Worker thread spawned by GameBox.
 * Handles all cryptographic operations off the main thread:
 *   - Rolling hash chain (keccak256)
 *   - Input digest computation
 *   - Canvas hash computation
 *   - Behavioral sketch building (64-byte fingerprint)
 *
 * GameBox loads this as: new Worker('security-worker.min.js')
 */

import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerCheckpointResult,
} from './types';

import {
  computeInitialHash,
  computeRollingHash,
  computeInputDigest,
  computeCanvasHash,
  computeFinalHash,
} from './crypto';

import { SketchBuilder } from './SketchBuilder';

// ============================================================
// Worker State
// ============================================================

let sessionId = '';
let rollingHash = '';
let windowIndex = 0;
const sketch = new SketchBuilder();

function send(msg: WorkerOutboundMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

// ============================================================
// Message Handler
// ============================================================

self.onmessage = (e: MessageEvent<WorkerInboundMessage>) => {
  const msg = e.data;

  try {
    switch (msg.type) {

      case 'INIT_SESSION': {
        sessionId = msg.sessionId;
        windowIndex = 0;
        sketch.reset();

        rollingHash = computeInitialHash(
          msg.sessionId,
          msg.screenW,
          msg.screenH,
          msg.ts
        );

        send({ type: 'SESSION_READY', initialHash: rollingHash });
        break;
      }

      case 'PROCESS_CHECKPOINT': {
        if (!sessionId) {
          send({ type: 'ERROR', message: 'No active session', context: msg.type });
          return;
        }

        const inputDigest = computeInputDigest(msg.events);
        const canvasHash = computeCanvasHash(msg.pixels);

        sketch.ingest(msg.events, msg.screenW, msg.screenH);
        const sketchHex = sketch.build();
        sketch.reset();

        rollingHash = computeRollingHash(
          rollingHash,
          msg.nonceW,
          inputDigest,
          canvasHash,
          msg.score
        );

        windowIndex = msg.windowIndex + 1;

        const result: WorkerCheckpointResult = {
          type: 'CHECKPOINT_RESULT',
          windowIndex: msg.windowIndex,
          inputDigest,
          canvasHash,
          rollingHash,
          sketch: sketchHex,
          eventCount: msg.events.length,
        };

        send(result);
        break;
      }

      case 'COMPUTE_FINAL_HASH': {
        if (!sessionId) {
          send({ type: 'ERROR', message: 'No active session', context: msg.type });
          return;
        }

        const finalHash = computeFinalHash(
          sessionId,
          rollingHash,
          msg.finalScore
        );

        send({
          type: 'FINAL_HASH_RESULT',
          finalHash,
          rollingHash,
          totalWindows: windowIndex,
        });
        break;
      }

      case 'RESET': {
        sessionId = '';
        rollingHash = '';
        windowIndex = 0;
        sketch.reset();
        break;
      }
    }
  } catch (err) {
    send({
      type: 'ERROR',
      message: err instanceof Error ? err.message : String(err),
      context: msg.type,
    });
  }
};
