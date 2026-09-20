const store = new Map();

// Search queries and one-off symbol lookups mean keys are effectively unbounded over time
// (every keystroke of a search box, every symbol ever glanced at). Without eviction this Map
// grows forever and eventually OOMs a memory-constrained host, so cap it and sweep expired
// entries periodically.
const MAX_ENTRIES = 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

// Calls for the same key currently awaiting an upstream fetch. Single-flighting these means
// concurrent callers (an overlapping poll tick, a warmer pass racing a live request, etc.)
// share one upstream call instead of each starting their own - which also removes the only
// way two writes for the same key could ever land out of order.
const inFlight = new Map();

export async function cached(key, ttlMs, fn) {
  const entry = store.get(key);
  const now = Date.now();
  if (entry && now - entry.time < ttlMs) return entry.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await fn();
      // Stamp `time` with the moment the value actually landed, not when the call started.
      // Two overlapping calls for the same key are now impossible (see `inFlight` above), but
      // this also keeps freshness honest if that ever changes, and lets `Date.now() - time`
      // be reported to callers as an accurate "as of" age.
      const time = Date.now();
      store.set(key, { value, time, ttlMs });
      if (store.size > MAX_ENTRIES) {
        const oldestKey = store.keys().next().value;
        store.delete(oldestKey);
      }
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Like `cached`, but also returns when the value was last actually fetched, so callers can
 * surface freshness ("as of Xs ago") to the client instead of presenting every field as if it
 * were current-instant.
 */
export async function cachedWithMeta(key, ttlMs, fn) {
  const value = await cached(key, ttlMs, fn);
  const entry = store.get(key);
  return { value, updatedAt: entry ? entry.time : Date.now() };
}

export function cacheEntryAge(key) {
  const entry = store.get(key);
  return entry ? Date.now() - entry.time : null;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.time >= entry.ttlMs) store.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();
