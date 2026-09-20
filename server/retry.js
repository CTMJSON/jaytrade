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
// An optional externally-supplied `signal` (e.g. from `createSemaphore`'s watchdog) is
// combined with the timeout so either one can abort the request.
export function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...options, signal });
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
//
// `limit` was previously hardcoded to 1 for the Yahoo gate, which meant a single background
// warm pass over dozens of symbols fully serialized every other caller (including interactive,
// user-triggered requests) behind it. A small limit (2-3) still bounds concurrent TLS
// handshakes but no longer turns the whole app into a single-file queue.
export function createSemaphore(limit, watchdogMs = 20000) {
  let active = 0;
  const queue = [];

  function next() {
    if (active >= limit || queue.length === 0) return;
    active++;
    const resolve = queue.shift();
    resolve();
  }

  // `fn` is called with an AbortController; pass its `.signal` down to `fetchWithTimeout` (via
  // `options.signal`) so that force-releasing a wedged permit also cancels the underlying
  // request instead of merely abandoning it. An abandoned-but-still-running fetch could
  // otherwise resolve long after its permit was reassigned and write a stale value into the
  // cache after a fresher one - see `cache.js`'s single-flight fix, which this closes the loop on.
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
    const controller = new AbortController();
    // fetchWithTimeout's AbortSignal is supposed to guarantee every call here settles within
    // seconds, but in practice a handful of calls have hung past it entirely (observed twice:
    // the entire gate stayed locked for 30+ minutes with nothing ever running again). Since
    // this gate is shared app-wide, one such call otherwise wedges every future caller
    // permanently. This watchdog both frees the slot for others AND aborts the underlying
    // call via `controller`, so it can't keep running in the background and land a late,
    // stale write after being abandoned.
    const watchdog = setTimeout(() => {
      console.error('[semaphore] permit held past watchdog limit - aborting and force-releasing');
      controller.abort(new Error('semaphore watchdog timeout'));
      release();
    }, watchdogMs);
    try {
      return await fn(controller);
    } finally {
      clearTimeout(watchdog);
      release();
    }
  };
}
