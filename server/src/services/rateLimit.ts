/**
 * In-memory fixed-window rate limiter per IP.
 * IPs are held in memory only — never logged, never persisted; stale windows are
 * replaced on next access (no timer needed).
 */

export interface RateLimiter {
  /** true = allowed; false = over the limit. */
  check(ip: string): boolean;
}

export function createRateLimiter(perMinute: number, now: () => number = Date.now): RateLimiter {
  if (perMinute <= 0) {
    return { check: () => true };
  }
  const windows = new Map<string, { windowStart: number; count: number }>();
  return {
    check(ip: string): boolean {
      const t = now();
      const w = windows.get(ip);
      if (!w || t - w.windowStart >= 60_000) {
        windows.set(ip, { windowStart: t, count: 1 });
        return true;
      }
      w.count += 1;
      return w.count <= perMinute;
    },
  };
}
