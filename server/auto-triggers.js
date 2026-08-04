import db from './db.js';

// "Aggressive Auto-Trigger Strategy" - every manual buy generates a standard 4-order bracket
// (stop-loss / trim-target / dip-buy / breakout-buy) off the fill price, which then adjusts
// itself as the position changes. See DESIGN-REVIEW.md sibling doc / plan for the full spec;
// this module is the single place that knows the percentages and the recalculation rules.

const TIERS = {
  low: { stopPct: 0.07, trimPct: 0.20 },
  standard: { stopPct: 0.09, trimPct: 0.27 },
  high: { stopPct: 0.12, trimPct: 0.35 },
};

const TIER_BY_SYMBOL = {
  MCD: 'low', BAC: 'low', AAPL: 'low',
  SPCX: 'high', TWLO: 'high', SHOP: 'high', HIMS: 'high',
};

const DIP_BUY_PCT = 0.10;
const BREAKOUT_BUY_PCT = 0.05;
const TRIM_SIZE_PCT = 0.25;
const REENTRY_SPEND_PCT = 0.20;
const DIP_BUY_COOLDOWN_DAYS = 30;

export function getTier(symbol) {
  const key = TIER_BY_SYMBOL[symbol] || 'standard';
  return { name: key, ...TIERS[key] };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function insertOrder(accountId, { symbol, side, condition, triggerPrice, amountUsd, quantity, role, tier, armed }) {
  const info = db
    .prepare(
      `INSERT INTO orders (account_id, symbol, side, condition, trigger_price, amount_usd, quantity, role, tier, armed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(accountId, symbol, side, condition, triggerPrice, amountUsd ?? null, quantity ?? null, role, tier, armed ? 1 : 0);
  return info.lastInsertRowid;
}

function cancelAutoOrders(accountId, symbol) {
  db.prepare(
    `UPDATE orders SET status = 'CANCELLED'
     WHERE account_id = ? AND symbol = ? AND status = 'ACTIVE' AND role != 'MANUAL'`
  ).run(accountId, symbol);
}

function hasRecentDipBuy(accountId, symbol) {
  const row = db
    .prepare(
      `SELECT 1 FROM trades
       WHERE account_id = ? AND symbol = ? AND trigger_role = 'DIP_BUY'
         AND datetime(created_at) >= datetime('now', ?)
       LIMIT 1`
    )
    .get(accountId, symbol, `-${DIP_BUY_COOLDOWN_DAYS} days`);
  return !!row;
}

/**
 * Cancels any existing auto-managed (non-MANUAL) orders for this symbol and, if a position is
 * still held, generates a fresh 4-order bracket off the current avg_cost/quantity. This is the
 * "manual buy/sell always wins and regenerates from the new position state" rule - it's called
 * for every manual trade regardless of whether one existed before, which also covers the very
 * first buy (nothing to cancel yet).
 */
export function generateTriggerSet(accountId, symbol) {
  cancelAutoOrders(accountId, symbol);

  const holding = db.prepare('SELECT * FROM holdings WHERE account_id = ? AND symbol = ?').get(accountId, symbol);
  if (!holding || holding.quantity <= 0) return [];

  const tier = getTier(symbol);
  const avgCost = holding.avg_cost;
  const quantity = holding.quantity;
  const positionValue = avgCost * quantity;
  const reentrySpend = round2(positionValue * REENTRY_SPEND_PCT);
  const trimQty = Math.floor(quantity * TRIM_SIZE_PCT);

  const created = [];

  created.push(
    insertOrder(accountId, {
      symbol,
      side: 'SELL',
      condition: 'DROPS_BELOW',
      triggerPrice: round2(avgCost * (1 - tier.stopPct)),
      quantity,
      role: 'STOP_LOSS',
      tier: tier.name,
      armed: true,
    })
  );

  if (trimQty >= 1) {
    created.push(
      insertOrder(accountId, {
        symbol,
        side: 'SELL',
        condition: 'RISES_ABOVE',
        triggerPrice: round2(avgCost * (1 + tier.trimPct)),
        quantity: trimQty,
        role: 'TRIM_TARGET',
        tier: tier.name,
        armed: true,
      })
    );
  }

  if (!hasRecentDipBuy(accountId, symbol)) {
    created.push(
      insertOrder(accountId, {
        symbol,
        side: 'BUY',
        condition: 'DROPS_BELOW',
        triggerPrice: round2(avgCost * (1 - DIP_BUY_PCT)),
        amountUsd: reentrySpend,
        role: 'DIP_BUY',
        tier: tier.name,
        armed: true,
      })
    );
  }

  created.push(
    insertOrder(accountId, {
      symbol,
      side: 'BUY',
      condition: 'RISES_ABOVE',
      triggerPrice: round2(avgCost * (1 + BREAKOUT_BUY_PCT)),
      amountUsd: reentrySpend,
      role: 'BREAKOUT_BUY',
      tier: tier.name,
      armed: false, // arms once a TRIM_TARGET fires - see recomputeAfterFire
    })
  );

  return created;
}

function activeAutoOrder(accountId, symbol, role) {
  return db
    .prepare(`SELECT * FROM orders WHERE account_id = ? AND symbol = ? AND role = ? AND status = 'ACTIVE'`)
    .get(accountId, symbol, role);
}

function armBreakoutBuy(accountId, symbol, fromPrice) {
  const order = activeAutoOrder(accountId, symbol, 'BREAKOUT_BUY');
  if (!order) return;
  db.prepare('UPDATE orders SET armed = 1, trigger_price = ? WHERE id = ?').run(round2(fromPrice * (1 + BREAKOUT_BUY_PCT)), order.id);
}

// Both stop-loss and trim-target protect/cash-out the CURRENT position size, so any event that
// changes the share count (a dip-buy/breakout-buy adding shares, a trim itself removing some)
// has to update quantity here too, not just price - otherwise a stop-loss sized for the original
// 100 shares silently stays at 100 after a trim sold 25 of them.
function updateStopLoss(accountId, symbol, baseCost, quantity) {
  const tier = getTier(symbol);
  const order = activeAutoOrder(accountId, symbol, 'STOP_LOSS');
  if (!order) return;
  db.prepare('UPDATE orders SET trigger_price = ?, quantity = ? WHERE id = ?').run(
    round2(baseCost * (1 - tier.stopPct)), quantity, order.id
  );
}

function updateTrimTargetInPlace(accountId, symbol, baseCost, quantity) {
  const tier = getTier(symbol);
  const order = activeAutoOrder(accountId, symbol, 'TRIM_TARGET');
  if (!order) return;
  const trimQty = Math.floor(quantity * TRIM_SIZE_PCT);
  db.prepare('UPDATE orders SET trigger_price = ?, quantity = ? WHERE id = ?').run(
    round2(baseCost * (1 + tier.trimPct)), Math.max(trimQty, 1), order.id
  );
}

// A trim firing consumes its own order row (it's EXECUTED now, not ACTIVE), so re-arming the
// "next" trim target for further gains means replacing it with a fresh row, not updating one
// that no longer exists in the ACTIVE set.
function replaceTrimTarget(accountId, symbol, baseCost, quantity) {
  const tier = getTier(symbol);
  const existing = activeAutoOrder(accountId, symbol, 'TRIM_TARGET');
  if (existing) db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(existing.id);

  const trimQty = Math.floor(quantity * TRIM_SIZE_PCT);
  if (trimQty >= 1) {
    insertOrder(accountId, {
      symbol,
      side: 'SELL',
      condition: 'RISES_ABOVE',
      triggerPrice: baseCost * (1 + tier.trimPct),
      quantity: trimQty,
      role: 'TRIM_TARGET',
      tier: tier.name,
      armed: true,
    });
  }
}

/**
 * Narrower, event-driven recalculation after an *auto* trigger fires (as opposed to
 * generateTriggerSet's full regenerate, which only runs on manual trades). Returns the list of
 * order IDs cancelled, if any, so the caller's poll loop can skip them for the rest of its pass.
 */
export function recomputeAfterFire(accountId, symbol, role, fillPrice) {
  if (role === 'STOP_LOSS') {
    // Position is closed - nothing left to protect or re-enter with.
    const cancelled = db
      .prepare(`SELECT id FROM orders WHERE account_id = ? AND symbol = ? AND status = 'ACTIVE' AND role != 'MANUAL'`)
      .all(accountId, symbol)
      .map((o) => o.id);
    cancelAutoOrders(accountId, symbol);
    return cancelled;
  }

  const holding = db.prepare('SELECT * FROM holdings WHERE account_id = ? AND symbol = ?').get(accountId, symbol);

  if (role === 'TRIM_TARGET') {
    // "Post-trim high" is read as the price at the moment of the trim fill - a one-time
    // recalculation anchor, matching the spec's own pseudocode (on_trigger_fired runs once per
    // event, not a continuously-updated trailing stop).
    if (holding && holding.quantity > 0) {
      updateStopLoss(accountId, symbol, fillPrice, holding.quantity);
      replaceTrimTarget(accountId, symbol, fillPrice, holding.quantity);
    }
    armBreakoutBuy(accountId, symbol, fillPrice);
    return [];
  }

  if (!holding) return [];

  if (role === 'DIP_BUY') {
    updateStopLoss(accountId, symbol, holding.avg_cost, holding.quantity);
    updateTrimTargetInPlace(accountId, symbol, holding.avg_cost, holding.quantity);
  } else if (role === 'BREAKOUT_BUY') {
    // Per spec: breakout-buy firing only recalculates the trim target, not the stop-loss.
    updateTrimTargetInPlace(accountId, symbol, holding.avg_cost, holding.quantity);
  }
  return [];
}
