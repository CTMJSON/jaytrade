import db from './db.js';
import { getDailyHistory } from './marketdata.js';
import { cached } from './cache.js';

export const BENCHMARK_SYMBOL = 'SPY';

// null = "since the account started"
const RANGE_LOOKBACK_DAYS = {
  '1w': 7,
  '1mo': 30,
  '3mo': 90,
  '1y': 365,
  all: null,
};

export const VALID_RANGES = Object.keys(RANGE_LOOKBACK_DAYS);

const HISTORY_CACHE_TTL_MS = 30 * 1000;
const DAY_MS = 86400000;

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Pick the smallest Yahoo range that still covers the window. Fewer distinct ranges means
 * more cache hits in getDailyHistory, which is what keeps this cheap across accounts.
 */
function yahooRangeForDays(days) {
  if (days <= 25) return '1mo';
  if (days <= 80) return '3mo';
  if (days <= 170) return '6mo';
  if (days <= 350) return '1y';
  if (days <= 700) return '2y';
  return '5y';
}

/**
 * Forward-filling price lookup. Stateful and monotonic: it assumes it will be called with
 * dates in ascending order, which lets the whole walk stay O(dates + points) instead of
 * doing a binary search per symbol per day.
 */
function makeForwardFillLookup(points) {
  let i = 0;
  let last = null;
  return (date) => {
    while (i < points.length && points[i].date <= date) {
      if (Number.isFinite(points[i].close)) last = points[i].close;
      i += 1;
    }
    return last;
  };
}

function tradeDay(trade) {
  return String(trade.created_at || '').slice(0, 10);
}

export async function buildPortfolioHistory(accountId, rangeKey = '3mo') {
  const range = RANGE_LOOKBACK_DAYS[rangeKey] !== undefined ? rangeKey : '3mo';
  return cached(`pfhist:${accountId}:${range}`, HISTORY_CACHE_TTL_MS, () =>
    computePortfolioHistory(accountId, range)
  );
}

async function computePortfolioHistory(accountId, rangeKey) {
  const account = db
    .prepare('SELECT cash, starting_cash, created_at FROM accounts WHERE id = ?')
    .get(accountId);
  if (!account) throw new Error('Account not found');

  const trades = db
    .prepare(
      `SELECT symbol, side, quantity, price, total, created_at
       FROM trades WHERE account_id = ?
       ORDER BY datetime(created_at) ASC, id ASC`
    )
    .all(accountId);

  const startingCash = account.starting_cash;
  const accountStart = String(account.created_at || '').slice(0, 10) || isoDay(new Date());
  const firstTradeDay = trades.length ? tradeDay(trades[0]) : null;
  // Guard against a first trade predating created_at (possible for migrated legacy data).
  const inceptionDay = firstTradeDay && firstTradeDay < accountStart ? firstTradeDay : accountStart;

  const lookbackDays = RANGE_LOOKBACK_DAYS[rangeKey];
  let windowStart = inceptionDay;
  if (lookbackDays != null) {
    const from = isoDay(new Date(Date.now() - lookbackDays * DAY_MS));
    windowStart = from > inceptionDay ? from : inceptionDay;
  }

  const spanDays = Math.max(
    1,
    Math.ceil((Date.now() - Date.parse(`${windowStart}T00:00:00Z`)) / DAY_MS)
  );
  const yahooRange = yahooRangeForDays(spanDays);

  const symbols = [...new Set(trades.map((t) => t.symbol))];

  // getDailyHistory is gated to one Yahoo request at a time upstream, so these queue
  // rather than burst — and each is cached for 15 minutes.
  const fetched = await Promise.all(
    [...symbols, BENCHMARK_SYMBOL].map(async (symbol) => {
      try {
        const history = await getDailyHistory(symbol, yahooRange);
        return [symbol, history.points || []];
      } catch {
        return [symbol, []];
      }
    })
  );
  const seriesBySymbol = new Map(fetched);

  return reconstructCurve({
    rangeKey,
    windowStart,
    inceptionDay,
    startingCash,
    trades,
    seriesBySymbol,
  });
}

/**
 * Pure portfolio-value reconstruction — no DB, no network. Exported so the walk can be
 * tested against known trade sequences.
 */
export function reconstructCurve({ rangeKey, windowStart, inceptionDay, startingCash, trades, seriesBySymbol }) {
  const benchmarkPoints = seriesBySymbol.get(BENCHMARK_SYMBOL) || [];

  // Use the benchmark's dates as the trading calendar. If it's unavailable, fall back to
  // the union of every held symbol's dates so the curve still renders.
  let calendar = benchmarkPoints.map((p) => p.date);
  if (calendar.length === 0) {
    const union = new Set();
    for (const [symbol, points] of seriesBySymbol) {
      if (symbol === BENCHMARK_SYMBOL) continue;
      points.forEach((p) => union.add(p.date));
    }
    calendar = [...union].sort();
  }
  const dates = calendar.filter((d) => d >= windowStart);

  if (dates.length === 0) {
    return {
      range: rangeKey,
      points: [],
      startValue: null,
      endValue: null,
      changeValue: null,
      changePercent: null,
      benchmarkSymbol: BENCHMARK_SYMBOL,
      benchmarkChangePercent: null,
      inceptionDate: inceptionDay,
      insufficientHistory: true,
    };
  }

  const lookups = new Map();
  for (const [symbol, points] of seriesBySymbol) {
    lookups.set(symbol, makeForwardFillLookup(points));
  }
  const benchmarkLookup = lookups.get(BENCHMARK_SYMBOL);

  let cash = startingCash;
  const quantities = new Map();
  const lastTradePrice = new Map();
  let tradeIndex = 0;

  const points = [];
  for (const date of dates) {
    // Apply every trade up to and including this day. On the first iteration this also
    // replays all trades that happened before the window, which is what makes a mid-history
    // window (e.g. "1 month") start from the correct holdings and cash.
    while (tradeIndex < trades.length && tradeDay(trades[tradeIndex]) <= date) {
      const t = trades[tradeIndex];
      tradeIndex += 1;
      const signedQty = t.side === 'BUY' ? t.quantity : -t.quantity;
      cash += t.side === 'BUY' ? -t.total : t.total;
      quantities.set(t.symbol, (quantities.get(t.symbol) || 0) + signedQty);
      lastTradePrice.set(t.symbol, t.price);
    }

    let holdingsValue = 0;
    for (const [symbol, qty] of quantities) {
      if (qty <= 0) continue;
      const lookup = lookups.get(symbol);
      const price = (lookup ? lookup(date) : null) ?? lastTradePrice.get(symbol) ?? 0;
      holdingsValue += qty * price;
    }

    points.push({
      date,
      value: round2(cash + holdingsValue),
      benchmarkClose: benchmarkLookup ? benchmarkLookup(date) : null,
    });
  }

  // Normalise the benchmark so it starts at the same dollar value as the portfolio does
  // at the left edge of the window: "what if I'd put this in the S&P instead, that day".
  const firstBenchmarkClose = points.find((p) => Number.isFinite(p.benchmarkClose))?.benchmarkClose ?? null;
  const baseValue = points[0].value;
  for (const p of points) {
    p.benchmark =
      firstBenchmarkClose && Number.isFinite(p.benchmarkClose)
        ? round2(baseValue * (p.benchmarkClose / firstBenchmarkClose))
        : null;
    delete p.benchmarkClose;
  }

  const startValue = points[0].value;
  const endValue = points[points.length - 1].value;
  const changeValue = round2(endValue - startValue);
  const changePercent = startValue > 0 ? round2(((endValue - startValue) / startValue) * 100) : null;

  const lastBenchmark = [...points].reverse().find((p) => p.benchmark != null)?.benchmark ?? null;
  const benchmarkChangePercent =
    lastBenchmark != null && startValue > 0 ? round2(((lastBenchmark - startValue) / startValue) * 100) : null;

  return {
    range: rangeKey,
    points,
    startValue,
    endValue,
    changeValue,
    changePercent,
    benchmarkSymbol: BENCHMARK_SYMBOL,
    benchmarkChangePercent,
    inceptionDate: inceptionDay,
    insufficientHistory: points.length < 2,
  };
}
