/**
 * Development Logger
 * 
 * Only logs in development mode. Completely stripped in production.
 * Use: log.info('message'), log.warn('message'), log.error('message')
 */

// Check if we're in development mode
const isDev = process.env.NODE_ENV !== 'production';

const PREFIX = '[SDK Security]';
const STYLE_INFO = 'color: #4CAF50; font-weight: bold;';
const STYLE_WARN = 'color: #FF9800; font-weight: bold;';
const STYLE_ERROR = 'color: #f44336; font-weight: bold;';
const STYLE_EVENT = 'color: #2196F3; font-weight: bold;';

export const log = {
  info: (message: string, ...data: any[]) => {
    if (isDev) {
      console.log(`%c${PREFIX} ${message}`, STYLE_INFO, ...data);
    }
  },

  warn: (message: string, ...data: any[]) => {
    if (isDev) {
      console.warn(`%c${PREFIX} ${message}`, STYLE_WARN, ...data);
    }
  },

  error: (message: string, ...data: any[]) => {
    if (isDev) {
      console.error(`%c${PREFIX} ${message}`, STYLE_ERROR, ...data);
    }
  },

  event: (message: string, ...data: any[]) => {
    if (isDev) {
      console.log(`%c${PREFIX} 📨 ${message}`, STYLE_EVENT, ...data);
    }
  },

  request: (type: string, data?: any) => {
    if (isDev) {
      console.log(`%c${PREFIX} ⬇️ REQUEST: ${type}`, 'color: #9C27B0; font-weight: bold;', data ?? '');
    }
  },

  response: (type: string, data?: any) => {
    if (isDev) {
      console.log(`%c${PREFIX} ⬆️ RESPONSE: ${type}`, 'color: #00BCD4; font-weight: bold;', data ?? '');
    }
  },

  table: (data: any) => {
    if (isDev) {
      console.table(data);
    }
  }
};
