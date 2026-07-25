import db from './db.js';
import { getQuote, getProfile } from './finnhub.js';

function pick(arr, keyFn, better) {
  return arr.reduce((best, item) => (best == null || better(keyFn(item), keyFn(best)) ? item : best), null);
}

export async function buildPortfolioSummary(startingCash) {
  const account = db.prepare('SELECT cash FROM account WHERE id = 1').get();
  const rows = db.prepare('SELECT symbol, quantity, avg_cost FROM holdings WHERE quantity > 0').all();

  const enriched = await Promise.all(
    rows.map(async (h) => {
      let quote = null;
      let profile = null;
      try {
        [quote, profile] = await Promise.all([getQuote(h.symbol), getProfile(h.symbol).catch(() => null)]);
      } catch {
        quote = null;
      }
      const currentPrice = quote?.current ?? h.avg_cost;
      const marketValue = currentPrice * h.quantity;
      const costBasis = h.avg_cost * h.quantity;
      const unrealizedPL = marketValue - costBasis;
      const unrealizedPLPercent = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;
      const dayChange = (quote?.change ?? 0) * h.quantity;
      const dayChangePercent = quote?.percentChange ?? 0;
      return {
        symbol: h.symbol,
        quantity: h.quantity,
        avgCost: h.avg_cost,
        currentPrice,
        marketValue,
        costBasis,
        unrealizedPL,
        unrealizedPLPercent,
        dayChange,
        dayChangePercent,
        industry: profile?.industry ?? null,
      };
    })
  );

  const holdingsValue = enriched.reduce((sum, h) => sum + h.marketValue, 0);
  const totalValue = account.cash + holdingsValue;
  const totalPL = totalValue - startingCash;
  const totalPLPercent = startingCash > 0 ? (totalPL / startingCash) * 100 : 0;

  const unrealizedPL = enriched.reduce((sum, h) => sum + h.unrealizedPL, 0);
  // The rest of totalPL - anything not sitting in an open position's unrealized gain/loss -
  // must have come from cash movements on past closed trades, i.e. it's already "locked in".
  const realizedPL = totalPL - unrealizedPL;

  const dayChange = enriched.reduce((sum, h) => sum + h.dayChange, 0);
  const priorDayValue = totalValue - dayChange;
  const dayChangePercent = priorDayValue > 0 ? (dayChange / priorDayValue) * 100 : 0;

  const withAllocation = enriched.map((h) => ({
    ...h,
    allocationPercent: totalValue > 0 ? (h.marketValue / totalValue) * 100 : 0,
  }));

  const winCount = withAllocation.filter((h) => h.unrealizedPL > 0).length;
  const lossCount = withAllocation.filter((h) => h.unrealizedPL < 0).length;

  const bestPerformer = pick(withAllocation, (h) => h.unrealizedPLPercent, (a, b) => a > b);
  const worstPerformer = pick(withAllocation, (h) => h.unrealizedPLPercent, (a, b) => a < b);
  const dayBestPerformer = pick(withAllocation, (h) => h.dayChangePercent, (a, b) => a > b);
  const dayWorstPerformer = pick(withAllocation, (h) => h.dayChangePercent, (a, b) => a < b);
  const largestPosition = pick(withAllocation, (h) => h.allocationPercent, (a, b) => a > b);

  return {
    cash: account.cash,
    startingCash,
    holdingsValue,
    totalValue,
    totalPL,
    totalPLPercent,
    realizedPL,
    unrealizedPL,
    dayChange,
    dayChangePercent,
    cashAllocationPercent: totalValue > 0 ? (account.cash / totalValue) * 100 : 100,
    winCount,
    lossCount,
    holdingsCount: withAllocation.length,
    bestPerformer,
    worstPerformer,
    dayBestPerformer,
    dayWorstPerformer,
    largestPosition,
    holdings: withAllocation,
  };
}
