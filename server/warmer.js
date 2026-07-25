import { computeMovers, computeIndices, computeHistory } from './dashboard.js';

// Chart symbols the frontend's Market Summary panel defaults to, kept warm so switching
// between them (or a cold page load) never has to wait on a live upstream fetch.
const WARM_HISTORY_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'NVDA', 'META', 'TSLA', 'GOOGL', 'AMD', 'SPY', 'QQQ', 'DIA', 'IWM'];

const LOOP_INTERVAL_MS = 20 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Each compute*() call already checks its own cache TTL and returns instantly if still
// fresh, so calling all of these every tick is cheap. What matters is that the *work*
// (the actual upstream fetches, when due) happens one step at a time in a single loop
// rather than on independent timers - overlapping bursts of concurrent connections are
// what overwhelmed this hardware/network path in practice, not the request volume itself.
async function warmOnce() {
  try {
    await computeMovers();
  } catch (err) {
    console.error('[warmer] movers refresh failed:', err.message);
  }

  try {
    await computeIndices();
  } catch (err) {
    console.error('[warmer] indices refresh failed:', err.message);
  }

  for (const symbol of WARM_HISTORY_SYMBOLS) {
    try {
      await computeHistory(symbol, '5d', '15m');
    } catch (err) {
      console.error(`[warmer] history refresh failed for ${symbol}:`, err.message);
    }
    await sleep(400);
  }
}

export function startCacheWarmer() {
  let running = false;

  async function tick() {
    if (running) return; // previous pass still in flight - skip rather than overlap
    running = true;
    try {
      await warmOnce();
    } finally {
      running = false;
    }
  }

  tick();
  setInterval(tick, LOOP_INTERVAL_MS);
}
