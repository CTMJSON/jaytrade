const store = new Map();

export async function cached(key, ttlMs, fn) {
  const entry = store.get(key);
  const now = Date.now();
  if (entry && now - entry.time < ttlMs) return entry.value;
  const value = await fn();
  store.set(key, { value, time: now });
  return value;
}
