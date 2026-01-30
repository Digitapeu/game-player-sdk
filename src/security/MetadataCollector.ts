/**
 * MetadataCollector Module
 * 
 * Collects session metadata for trajectory replay normalization.
 */

import type { SessionMeta } from '../types';

export class MetadataCollector {
  /**
   * Collect current session metadata.
   */
  collect(): SessionMeta {
    return {
      screenW: screen.width,
      screenH: screen.height,
      dpr: Math.round(window.devicePixelRatio * 10) / 10,
      orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
      platform: this._detectPlatform(),
      touchCapable: 'ontouchstart' in window || navigator.maxTouchPoints > 0
    };
  }

  /**
   * Detect the current platform.
   */
  private _detectPlatform(): 'ios' | 'android' | 'web' | 'desktop' {
    const ua = navigator.userAgent.toLowerCase();
    
    if (/iphone|ipad|ipod/.test(ua)) {
      return 'ios';
    }
    
    if (/android/.test(ua)) {
      return 'android';
    }
    
    if (/mobile|tablet/.test(ua)) {
      return 'web';
    }
    
    return 'desktop';
  }
}
