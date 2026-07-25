import { cached } from './cache.js';
import { withRetry, fetchWithTimeout } from './retry.js';

const BASE_URL = 'https://finnhub.io/api/v1';

function apiKey() {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error('FINNHUB_API_KEY is not set');
  return key;
}

async function finnhubFetch(path) {
  // Retries only network-level failures, not 429/4xx/5xx HTTP responses (those are real,
  // non-transient answers from Finnhub and retrying them would just add to rate pressure).
  const res = await withRetry(() => fetchWithTimeout(`${BASE_URL}${path}&token=${apiKey()}`));
  if (res.status === 429) throw new Error('Finnhub rate limit reached, try again shortly');
  if (!res.ok) throw new Error(`Finnhub request failed: ${res.status}`);
  return res.json();
}

export async function searchSymbols(query) {
  return cached(`search:${query.toLowerCase()}`, 45 * 1000, async () => {
    const data = await finnhubFetch(`/search?q=${encodeURIComponent(query)}`);
    return (data.result || [])
      .filter((r) => r.symbol && !r.symbol.includes('.'))
      .slice(0, 15)
      .map((r) => ({ symbol: r.symbol, description: r.description, type: r.type }));
  });
}

export async function getQuote(symbol) {
  return cached(`quote:${symbol}`, 15 * 1000, async () => {
    const data = await finnhubFetch(`/quote?symbol=${encodeURIComponent(symbol)}`);
    if (data.c === 0 && data.h === 0 && data.l === 0) return null;
    return {
      symbol,
      current: data.c,
      change: data.d,
      percentChange: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
    };
  });
}

export async function getProfile(symbol) {
  return cached(`profile:${symbol}`, 24 * 60 * 60 * 1000, async () => {
    try {
      const data = await finnhubFetch(`/stock/profile2?symbol=${encodeURIComponent(symbol)}`);
      if (!data || !data.name) return null;
      return {
        name: data.name,
        logo: data.logo,
        industry: data.finnhubIndustry,
        marketCapitalization: data.marketCapitalization ?? null,
        shareOutstanding: data.shareOutstanding ?? null,
        floatingShare: data.floatingShare ?? null,
      };
    } catch {
      return null;
    }
  });
}

export async function getRecommendationTrends(symbol) {
  const data = await finnhubFetch(`/stock/recommendation?symbol=${encodeURIComponent(symbol)}`);
  return data && data.length ? data[0] : null;
}
