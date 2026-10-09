/**
 * Fixed-window rate limiter held in memory.
 *
 * The hub is one Node process per tier on Hostinger, so memory is the shared
 * state. If it is ever run as several processes, each gets its own budget;
 * the per-account lockout (in the database) still holds across all of them.
 */
function createLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();
  let lastSweep = now();

  function sweep(t) {
    if (t - lastSweep < 60_000) return;
    lastSweep = t;
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }

  /** Counts one hit. Returns { ok, retryAfter } (seconds). */
  function hit(key, limit, windowMs) {
    const t = now();
    sweep(t);
    let b = buckets.get(key);
    if (!b || b.resetAt <= t) { b = { count: 0, resetAt: t + windowMs }; buckets.set(key, b); }
    b.count += 1;
    return { ok: b.count <= limit, retryAfter: Math.ceil((b.resetAt - t) / 1000) };
  }

  function reset(key) { buckets.delete(key); }
  function clear() { buckets.clear(); }

  return { hit, reset, clear };
}

module.exports = { createLimiter };
