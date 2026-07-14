/**
 * Master Environment and Gating Controller
 * Central source of truth for Development vs Production environments.
 * Prevents development-only tools, backdoors, and cheats from being compiled or accessible in production.
 */

export const IS_DEV: boolean = (() => {
  if (typeof window !== 'undefined') {
    // Client-side Vite environment
    return !!(import.meta as any).env?.DEV;
  }
  // Server-side Node.js environment
  return process.env.NODE_ENV !== 'production';
})();

/**
 * Helper to assert development-only execution.
 * Throws an error or returns false if accessed in production.
 */
export function assertDev(featureName: string): boolean {
  if (!IS_DEV) {
    console.warn(`[SECURITY WARNING] Access to dev feature "${featureName}" was denied in production environment.`);
    return false;
  }
  return true;
}
