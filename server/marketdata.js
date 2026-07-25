import { cached } from './cache.js';
import { withRetry, fetchWithTimeout, createSemaphore } from './retry.js';

const YAHOO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// On constrained/low-core hardware, concurrent TLS handshakes to the same host can genuinely
// starve each other for CPU (crypto work competes for libuv's threadpool) badly enough that
// some time out entirely - something separate OS processes making the same calls never hit,
// since those get scheduled across cores independently. This gate serializes every Yahoo
// fetch application-wide (movers/indices/history/warmer alike) so that never happens.
const yahooGate = createSemaphore(1);

async function fetchChart(symbol, range, interval) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  // Retries only network-level failures (e.g. transient DNS/connect blips) - a bad HTTP
  // status is not retried since that indicates a real, non-transient response from Yahoo.
  // 'Connection: close' avoids reusing a pooled keep-alive socket that can go stale/dead
  // and then hang every subsequent request against it until the timeout fires.
  const res = await yahooGate(() =>
    withRetry(() => fetchWithTimeout(url, { headers: { 'User-Agent': YAHOO_UA, Connection: 'close' } }))
  );
  if (!res.ok) throw new Error(`Yahoo chart failed for ${symbol}: ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  return result;
}

export async function getDailyHistory(symbol, range = '5d') {
  return cached(`daily:${symbol}:${range}`, 15 * 60 * 1000, async () => {
    const result = await fetchChart(symbol, range, '1d');
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    const points = timestamps
      .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
      .filter((p) => p.close != null);

    return {
      symbol,
      name: result.meta?.longName || result.meta?.shortName || symbol,
      currentPrice: result.meta?.regularMarketPrice,
      previousClose: result.meta?.chartPreviousClose,
      points,
    };
  });
}

export async function getIntradayHistory(symbol, range = '5d', interval = '15m') {
  const result = await fetchChart(symbol, range, interval);
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const points = timestamps
    .map((t, i) => ({ time: t * 1000, close: quote.close?.[i], volume: quote.volume?.[i] }))
    .filter((p) => p.close != null);

  return {
    symbol,
    name: result.meta?.longName || result.meta?.shortName || symbol,
    currentPrice: result.meta?.regularMarketPrice,
    previousClose: result.meta?.chartPreviousClose,
    points,
  };
}

export async function getVolumeStats(symbol) {
  return cached(`volstats:${symbol}`, 3 * 60 * 1000, async () => {
    const result = await fetchChart(symbol, '5d', '1d');
    const volumes = (result.indicators?.quote?.[0]?.volume || []).filter((v) => v != null);
    if (volumes.length === 0) {
      return { volume: result.meta?.regularMarketVolume ?? null, avgVolume: null, relativeVolume: null };
    }
    const today = volumes[volumes.length - 1];
    const priorDays = volumes.slice(0, -1);
    const avgVolume = priorDays.length ? priorDays.reduce((sum, v) => sum + v, 0) / priorDays.length : null;
    return {
      volume: result.meta?.regularMarketVolume ?? today,
      avgVolume,
      relativeVolume: avgVolume ? today / avgVolume : null,
    };
  });
}
