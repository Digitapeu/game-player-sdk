/**
 * Security Module Exports (SDK Shim)
 *
 * Only exports the thin shim modules that run inside the game iframe.
 * All crypto/hashing/sketch logic lives in src/worker/ (Security Worker).
 */

export { SecurityBridge } from './SecurityBridge';
export { InputCapture } from './InputCapture';
export { CanvasHandler } from './CanvasHandler';
export { MetadataCollector } from './MetadataCollector';
export { log } from './logger';
