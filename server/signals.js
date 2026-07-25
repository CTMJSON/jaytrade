import { getRecommendationTrends } from './finnhub.js';
import { getDailyHistory } from './marketdata.js';

const CONCENTRATION_THRESHOLD = 25;
const BIG_GAIN_THRESHOLD = 25;
const BIG_LOSS_THRESHOLD = -15;
const TREND_UP_THRESHOLD = 5;
const TREND_DOWN_THRESHOLD = -5;

async function getFiveDayTrend(symbol) {
  try {
    const history = await getDailyHistory(symbol, '5d');
    if (!history.points.length) return null;
    const first = history.points[0].close;
    const last = history.currentPrice ?? history.points[history.points.length - 1].close;
    if (!first) return null;
    return ((last - first) / first) * 100;
  } catch {
    return null;
  }
}

async function getAnalystTilt(symbol) {
  try {
    const rec = await getRecommendationTrends(symbol);
    if (!rec) return { tilt: 0, reason: null };
    const bullish = rec.strongBuy + rec.buy;
    const bearish = rec.sell + rec.strongSell;
    const total = bullish + bearish + rec.hold;
    if (total === 0) return { tilt: 0, reason: null };
    if (bullish > bearish * 2) {
      return { tilt: 1, reason: `Analysts lean bullish (${bullish} buy vs ${bearish} sell)` };
    }
    if (bearish > bullish) {
      return { tilt: -1, reason: `Analysts lean bearish (${bearish} sell vs ${bullish} buy)` };
    }
    return { tilt: 0, reason: null };
  } catch {
    return { tilt: 0, reason: null };
  }
}

// Rules-based signal, not a predictive model - combines analyst consensus, recent price
// trend, unrealized P/L, and position sizing into a plain-English action + reasons.
// This is a simulated/educational heuristic, not real investment advice.
export async function computeHoldingSignal(holding) {
  const [trendPercent, analyst] = await Promise.all([
    getFiveDayTrend(holding.symbol),
    getAnalystTilt(holding.symbol),
  ]);

  const reasons = [];

  if (holding.allocationPercent >= CONCENTRATION_THRESHOLD) {
    reasons.push(`Makes up ${holding.allocationPercent.toFixed(1)}% of the portfolio - a concentrated position`);
    return { action: 'TRIM', reasons };
  }

  if (holding.unrealizedPLPercent >= BIG_GAIN_THRESHOLD) {
    reasons.push(`Up ${holding.unrealizedPLPercent.toFixed(1)}% since purchase - a large unrealized gain`);
    if (analyst.reason) reasons.push(analyst.reason);
    return { action: 'TRIM', reasons };
  }

  const trendUp = trendPercent != null && trendPercent >= TREND_UP_THRESHOLD;
  const trendDown = trendPercent != null && trendPercent <= TREND_DOWN_THRESHOLD;

  if (holding.unrealizedPLPercent <= BIG_LOSS_THRESHOLD && trendDown) {
    reasons.push(`Down ${Math.abs(holding.unrealizedPLPercent).toFixed(1)}% since purchase with continued weakness (${trendPercent.toFixed(1)}% over 5 days)`);
    if (analyst.reason) reasons.push(analyst.reason);
    return { action: 'REVIEW', reasons };
  }

  let tilt = analyst.tilt;
  if (trendUp) tilt += 1;
  if (trendDown) tilt -= 1;

  if (analyst.reason) reasons.push(analyst.reason);
  if (trendUp) reasons.push(`Up ${trendPercent.toFixed(1)}% over the last 5 days`);
  if (trendDown) reasons.push(`Down ${Math.abs(trendPercent).toFixed(1)}% over the last 5 days`);

  if (tilt >= 1) {
    if (reasons.length === 0) reasons.push('Positive momentum with no conflicting signals');
    return { action: 'ADD', reasons };
  }
  if (tilt <= -1) {
    return { action: 'REVIEW', reasons };
  }

  if (reasons.length === 0) reasons.push('No strong signal in either direction');
  return { action: 'HOLD', reasons };
}

export async function computeHoldingSignals(holdings) {
  const results = await Promise.all(
    holdings.map(async (h) => {
      try {
        const signal = await computeHoldingSignal(h);
        return { symbol: h.symbol, ...signal };
      } catch {
        return { symbol: h.symbol, action: 'HOLD', reasons: ['Signal unavailable'] };
      }
    })
  );
  return results;
}
