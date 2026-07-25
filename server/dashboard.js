import { getQuote, getProfile } from './finnhub.js';
import { getDailyHistory, getIntradayHistory, getVolumeStats } from './marketdata.js';
import { MOVERS_WATCHLIST, INDEX_PROXIES } from './watchlist.js';
import { cached } from './cache.js';
import { mapLimit } from './retry.js';

// Caps how many symbols are looked up concurrently. Firing 50+ simultaneous HTTPS
// connections at once (one per watchlist symbol) can overwhelm modest hardware/networks
// far more easily than it troubles the remote APIs, causing connections to stall.
const MOVERS_CONCURRENCY = 8;

export const MOVERS_CACHE_TTL_MS = 3 * 60 * 1000;
export const INDICES_CACHE_TTL_MS = 5 * 60 * 1000;
export const HISTORY_CACHE_TTL_MS = 60 * 1000;

let moversCache = { data: null, time: 0 };

export async function computeMovers() {
  const now = Date.now();
  if (moversCache.data && now - moversCache.time < MOVERS_CACHE_TTL_MS) {
    return moversCache.data;
  }

  const results = await mapLimit(MOVERS_WATCHLIST, MOVERS_CONCURRENCY, async (symbol) => {
    try {
      const [quote, profile, volStats] = await Promise.all([
        getQuote(symbol),
        getProfile(symbol).catch(() => null),
        getVolumeStats(symbol).catch(() => null),
      ]);
      if (!quote) return null;
      return {
        symbol,
        ...quote,
        volume: volStats?.volume ?? null,
        avgVolume: volStats?.avgVolume ?? null,
        relativeVolume: volStats?.relativeVolume ?? null,
        marketCap: profile?.marketCapitalization ?? null,
        floatShares: profile?.floatingShare ?? null,
      };
    } catch {
      return null;
    }
  });
  const valid = results.filter(Boolean).filter((q) => q.percentChange != null);

  // A cold-start burst (e.g. right after restart) can transiently fail most/all lookups.
  // Prefer stale-but-good data over caching a mostly-empty result for the full TTL.
  const coverage = valid.length / MOVERS_WATCHLIST.length;
  if (coverage < 0.5 && moversCache.data) {
    return moversCache.data;
  }

  const gainers = valid.filter((q) => q.percentChange >= 0).sort((a, b) => b.percentChange - a.percentChange);
  const losers = valid.filter((q) => q.percentChange < 0).sort((a, b) => a.percentChange - b.percentChange);
  const data = { gainers, losers };
  moversCache = { data, time: now };
  return data;
}

let indicesCache = { data: null, time: 0 };

export async function computeIndices() {
  const now = Date.now();
  if (indicesCache.data && now - indicesCache.time < INDICES_CACHE_TTL_MS) {
    return indicesCache.data;
  }

  const results = await Promise.all(
    INDEX_PROXIES.map(async ({ symbol, label }) => {
      try {
        const history = await getDailyHistory(symbol, '5d');
        return { ...history, label };
      } catch (err) {
        return { symbol, label, error: err.message, points: [] };
      }
    })
  );

  const allFailed = results.every((r) => r.error);
  if (allFailed && indicesCache.data) {
    // Transient failure - keep serving the last good data instead of "Unavailable"
    return indicesCache.data;
  }

  indicesCache = { data: results, time: now };
  return results;
}

const historyFallback = new Map();

export async function computeHistory(symbol, range, interval) {
  const fallbackKey = `${symbol}:${range}:${interval}`;
  try {
    const data = await cached(fallbackKey, HISTORY_CACHE_TTL_MS, () => getIntradayHistory(symbol, range, interval));
    historyFallback.set(fallbackKey, data);
    return data;
  } catch (err) {
    const fallback = historyFallback.get(fallbackKey);
    if (fallback) return fallback;
    throw err;
  }
}
