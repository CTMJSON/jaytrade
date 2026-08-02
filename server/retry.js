function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry(fn, { attempts = 3, baseDelayMs = 300 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

// Node's fetch has no default timeout - a stalled connection would otherwise hang for the
// OS-level TCP timeout (~30s+) before we ever got a chance to retry. Fail fast instead.
export function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// Runs `fn` over `items` with at most `limit` in flight at once. Firing dozens of concurrent
// HTTPS connections at once can overwhelm modest hardware/networks (more than it can overwhelm
// the remote API) - this keeps background refreshes from ever bursting like that.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// A simple counting semaphore. On slow/low-core hardware, concurrent TLS handshakes can
// genuinely starve each other for CPU (crypto work competes for libuv's threadpool) in a way
// separate OS processes making the same requests never would - so unlike mapLimit (which only
// bounds concurrency *within* one call site), this is meant to be shared as a single global gate
// in front of a given remote host, regardless of which code path is calling it.
export function createSemaphore(limit, watchdogMs = 20000) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= limit || queue.length === 0) return;
    active++;
    const resolve = queue.shift();
    resolve();
  }

  return async function withPermit(fn) {
    if (active >= limit) {
      await new Promise((resolve) => queue.push(resolve));
    } else {
      active++;
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      next();
    };
    // fetchWithTimeout's AbortSignal is supposed to guarantee every call here settles within
    // seconds, but in practice a handful of calls have hung past it entirely (observed twice:
    // the entire gate stayed locked for 30+ minutes with nothing ever running again). Since
    // this gate is shared app-wide, one such call otherwise wedges every future caller
    // permanently. This watchdog frees the slot for others regardless - it can't cancel the
    // stuck call itself, but it stops one bad call from taking the whole app down with it.
    const watchdog = setTimeout(() => {
      console.error('[semaphore] permit held past watchdog limit - force-releasing');
      release();
    }, watchdogMs);
    try {
      return await fn();
    } finally {
      clearTimeout(watchdog);
      release();
    }
  };
}
