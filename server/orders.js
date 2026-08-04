import db from './db.js';
import { getQuote } from './finnhub.js';
import { executeTrade, TradeError } from './trading.js';
import { recomputeAfterFire } from './auto-triggers.js';

export function createOrder(accountId, { symbol, side, condition, triggerPrice, amountUsd, quantity }) {
  const info = db
    .prepare(
      `INSERT INTO orders (account_id, symbol, side, condition, trigger_price, amount_usd, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(accountId, symbol, side, condition, triggerPrice, amountUsd ?? null, quantity ?? null);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
}

export function listOrders(accountId) {
  return db.prepare('SELECT * FROM orders WHERE account_id = ? ORDER BY id DESC').all(accountId);
}

export function cancelOrder(accountId, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND account_id = ?').get(id, accountId);
  if (!order) return null;
  if (order.status !== 'ACTIVE') return order;
  db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(id);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function conditionMet(condition, price, triggerPrice) {
  return condition === 'DROPS_BELOW' ? price <= triggerPrice : price >= triggerPrice;
}

// Runs across every account's orders in one pass, sharing quote lookups by symbol - this is
// what keeps N accounts cheap: one poll, one set of Finnhub calls, regardless of how many
// separate portfolios have triggers waiting on the same symbol.
export async function checkAndExecuteOrders() {
  // Unarmed orders (a breakout-buy waiting on its first trim) aren't live yet.
  const active = db.prepare("SELECT * FROM orders WHERE status = 'ACTIVE' AND armed = 1").all();
  if (active.length === 0) return;

  const symbols = [...new Set(active.map((o) => o.symbol))];
  const quotes = {};
  for (const symbol of symbols) {
    try {
      quotes[symbol] = await getQuote(symbol);
    } catch {
      quotes[symbol] = null;
    }
  }

  // Guardrail: a stop-loss beats a same-cycle dip-buy on the same symbol (never average into a
  // position that just got fully stopped out). Evaluating STOP_LOSS orders first, then tracking
  // every id a stop-loss cancels, means later orders in this same pass get skipped even though
  // the in-memory `active` snapshot still shows them as ACTIVE.
  const rolePriority = (role) => (role === 'STOP_LOSS' ? 0 : 1);
  active.sort((a, b) => rolePriority(a.role) - rolePriority(b.role));
  const skipIds = new Set();

  for (const order of active) {
    if (skipIds.has(order.id)) continue;
    const quote = quotes[order.symbol];
    if (!quote) continue;
    if (!conditionMet(order.condition, quote.current, order.trigger_price)) continue;

    const isAutoTrigger = order.role && order.role !== 'MANUAL';
    const triggerRole = isAutoTrigger ? order.role : null;

    try {
      if (order.side === 'BUY') {
        const qty = Math.floor((order.amount_usd || 0) / quote.current);
        if (qty < 1) continue;
        executeTrade(order.account_id, order.symbol, 'BUY', qty, quote.current, 'AUTO', triggerRole);
        db.prepare("UPDATE orders SET status = 'EXECUTED', executed_at = datetime('now'), note = ? WHERE id = ?").run(
          `Bought ${qty} @ $${quote.current.toFixed(2)}`, order.id
        );
      } else {
        const holding = db.prepare('SELECT * FROM holdings WHERE account_id = ? AND symbol = ?').get(order.account_id, order.symbol);
        if (!holding || holding.quantity <= 0) {
          db.prepare("UPDATE orders SET status = 'FAILED', note = 'No shares held to sell' WHERE id = ?").run(order.id);
          continue;
        }
        const qty = order.quantity ? Math.min(order.quantity, holding.quantity) : holding.quantity;
        executeTrade(order.account_id, order.symbol, 'SELL', qty, quote.current, 'AUTO', triggerRole);
        db.prepare("UPDATE orders SET status = 'EXECUTED', executed_at = datetime('now'), note = ? WHERE id = ?").run(
          `Sold ${qty} @ $${quote.current.toFixed(2)}`, order.id
        );
      }

      if (isAutoTrigger) {
        const cancelledIds = recomputeAfterFire(order.account_id, order.symbol, order.role, quote.current);
        cancelledIds.forEach((id) => skipIds.add(id));
      }
    } catch (err) {
      if (err instanceof TradeError) {
        db.prepare("UPDATE orders SET status = 'FAILED', note = ? WHERE id = ?").run(err.message, order.id);
      } else {
        console.error(`Order ${order.id} execution error:`, err);
      }
    }
  }
}
