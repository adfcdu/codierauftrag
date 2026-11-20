/**
 * In-memory fixed-window rate limiter per IP, one window per configured frame.
 * IPs are held in memory only — never logged, never persisted; stale windows are
 * replaced on next access (no timer needed).
 */

export interface RateLimiter {
  /** true = allowed; false = over the limit of at least one window. */
  check(ip: string): boolean;
}

export interface RateWindow {
  /** window length in ms */
  windowMs: number;
  /** max requests per window; <= 0 disables this window */
  limit: number;
}

interface WindowState {
  windowStart: number;
  count: number;
}

export function createRateLimiter(
  windows: RateWindow[],
  now: () => number = Date.now,
): RateLimiter {
  const active = windows.filter((w) => w.limit > 0);
  if (active.length === 0) {
    return { check: () => true };
  }
  const byIp = new Map<string, WindowState[]>();
  return {
    check(ip: string): boolean {
      const t = now();
      let states = byIp.get(ip);
      if (!states) {
        states = active.map(() => ({ windowStart: t, count: 0 }));
        byIp.set(ip, states);
      }
      // every window is advanced, even after one rejects — otherwise a rejected
      // request would leave the other windows under-counted
      let allowed = true;
      for (let i = 0; i < active.length; i++) {
        const state = states[i];
        const window = active[i];
        if (t - state.windowStart >= window.windowMs) {
          state.windowStart = t;
          state.count = 1;
        } else {
          state.count += 1;
        }
        if (state.count > window.limit) allowed = false;
      }
      return allowed;
    },
  };
}
