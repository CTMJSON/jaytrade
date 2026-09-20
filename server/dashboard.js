import { getQuoteWithMeta, getProfile } from './finnhub.js';
import { getDailyHistory, getIntradayHistory, getVolumeStatsWithMeta } from './marketdata.js';
import { MOVERS_WATCHLIST, INDEX_PROXIES } from './watchlist.js';
import { cached, cachedWithMeta } from './cache.js';
import { mapLimit } from './retry.js';
import { getLiveQuote } from './live-quotes.js';

// Caps how many symbols are looked up concurrently. Firing 50+ simultaneous HTTPS
// connections at once (one per watchlist symbol) can overwhelm modest hardware/networks
// far more easily than it troubles the remote APIs, causing connections to stall.
const MOVERS_CONCURRENCY = 8;

export const MOVERS_CACHE_TTL_MS = 3 * 60 * 1000;
export const INDICES_CACHE_TTL_MS = 5 * 60 * 1000;
export const HISTORY_CACHE_TTL_MS = 60 * 1000;

// Last known-good payloads, kept OUTSIDE the TTL cache so serving them as a fallback never
// pretends to be a fresh value (their own `asOf`/`degraded` metadata reflects when they were
// really computed, not "just now").
let moversFallback = null;
let indicesFallback = null;

async function fetchMoverRow(symbol) {
  try {
    const [quoteMeta, profile, volMeta] = await Promise.all([
      getQuoteWithMeta(symbol),
      getProfile(symbol).catch(() => null),
      getVolumeStatsWithMeta(symbol).catch(() => null),
    ]);
    if (!quoteMeta.value) return { symbol, ok: false };

    // Prefer the WebSocket-pushed live price when it's fresher than the last REST poll -
    // this is what actually makes movers rows update in real time instead of only every 15s.
    const live = getLiveQuote(symbol);
    const usingLive = live && live.asOf > quoteMeta.updatedAt;
    const priceFields = usingLive
      ? { current: live.current, change: live.change ?? quoteMeta.value.change,
          percentChange: live.percentChange ?? quoteMeta.value.percentChange }
      : {};

    return {
      symbol,
      ok: true,
      row: {
        symbol,
        ...quoteMeta.value,
        ...priceFields,
        // Price/volume come from different upstream sources on very different refresh
        // cadences (Finnhub quote ~15s vs. Yahoo volume ~3min) - report them separately
        // instead of implying the whole row is one instant.
        asOf: usingLive ? live.asOf : quoteMeta.updatedAt,
        volume: volMeta?.value?.volume ?? null,
        avgVolume: volMeta?.value?.avgVolume ?? null,
        relativeVolume: volMeta?.value?.relativeVolume ?? null,
        volumeAsOf: volMeta?.updatedAt ?? null,
        marketCap: profile?.marketCapitalization ?? null,
        floatShares: profile?.floatingShare ?? null,
      },
    };
  } catch {
    return { symbol, ok: false };
  }
}

async function computeMoversUncached() {
  const results = await mapLimit(MOVERS_WATCHLIST, MOVERS_CONCURRENCY, fetchMoverRow);
  const rows = results.filter((r) => r.ok && r.row.percentChange != null).map((r) => r.row);
  const failedSymbols = results.filter((r) => !r.ok).map((r) => r.symbol);

  // A cold-start burst (e.g. right after restart) can transiently fail most/all lookups.
  // Prefer stale-but-good data over caching a mostly-empty result for the full TTL - but say
  // so explicitly (`degraded`) instead of silently pretending the old payload is fresh.
  const coverage = rows.length / MOVERS_WATCHLIST.length;
  if (coverage < 0.5 && moversFallback) {
    return { ...moversFallback, degraded: true };
  }

  const gainers = rows.filter((q) => q.percentChange >= 0).sort((a, b) => b.percentChange - a.percentChange);
  const losers = rows.filter((q) => q.percentChange < 0).sort((a, b) => a.percentChange - b.percentChange);
  const data = { gainers, losers, stale: failedSymbols, asOf: Date.now(), degraded: false };
  moversFallback = data;
  return data;
}

export async function computeMovers() {
  return cached('movers:watchlist', MOVERS_CACHE_TTL_MS, computeMoversUncached);
}

async function computeIndicesUncached() {
  const results = await Promise.all(
    INDEX_PROXIES.map(async ({ symbol, label }) => {
      try {
        const history = await getDailyHistory(symbol, '5d');
        return { ...history, label, asOf: Date.now() };
      } catch (err) {
        return { symbol, label, error: err.message, points: [] };
      }
    })
  );

  const allFailed = results.every((r) => r.error);
  if (allFailed && indicesFallback) {
    // Transient failure - keep serving the last good data instead of "Unavailable", but flag it.
    return { data: indicesFallback, degraded: true };
  }

  indicesFallback = results;
  return { data: results, degraded: false };
}

export async function computeIndices() {
  const { data, degraded } = await cached('indices:proxies', INDICES_CACHE_TTL_MS, computeIndicesUncached);
  return degraded ? data.map((r) => ({ ...r, degraded: true })) : data;
}

const historyFallback = new Map();

export async function computeHistory(symbol, range, interval) {
  const fallbackKey = `${symbol}:${range}:${interval}`;
  try {
    const { value, updatedAt } = await cachedWithMeta(fallbackKey, HISTORY_CACHE_TTL_MS, () =>
      getIntradayHistory(symbol, range, interval)
    );
    const data = { ...value, asOf: updatedAt };
    historyFallback.set(fallbackKey, data);
    return data;
  } catch (err) {
    const fallback = historyFallback.get(fallbackKey);
    if (fallback) return { ...fallback, degraded: true };
    throw err;
  }
}
