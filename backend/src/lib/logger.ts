/**
 * Simple logger module for backend services
 */

export const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO] ${message}`, data || '');
  },
  warn: (message: string, data?: any) => {
    console.warn(`[WARN] ${message}`, data || '');
  },
  error: (message: string, data?: any) => {
    console.error(`[ERROR] ${message}`, data || '');
  },
  debug: (message: string, data?: any) => {
    if (process.env.DEBUG) {
      console.debug(`[DEBUG] ${message}`, data || '');
    }
  },
};
