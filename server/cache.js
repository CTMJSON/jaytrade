const store = new Map();

// Search queries and one-off symbol lookups mean keys are effectively unbounded over time
// (every keystroke of a search box, every symbol ever glanced at). Without eviction this Map
// grows forever and eventually OOMs a memory-constrained host, so cap it and sweep expired
// entries periodically.
const MAX_ENTRIES = 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export async function cached(key, ttlMs, fn) {
  const entry = store.get(key);
  const now = Date.now();
  if (entry && now - entry.time < ttlMs) return entry.value;
  const value = await fn();
  store.set(key, { value, time: now, ttlMs });
  if (store.size > MAX_ENTRIES) {
    const oldestKey = store.keys().next().value;
    store.delete(oldestKey);
  }
  return value;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.time >= entry.ttlMs) store.delete(key);
  }
}, SWEEP_INTERVAL_MS).unref();
