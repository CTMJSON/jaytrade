import db from './db.js';
import { getQuote } from './finnhub.js';
import { executeTrade, TradeError } from './trading.js';

export function createOrder({ symbol, side, condition, triggerPrice, amountUsd, quantity }) {
  const info = db
    .prepare(
      `INSERT INTO orders (symbol, side, condition, trigger_price, amount_usd, quantity)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(symbol, side, condition, triggerPrice, amountUsd ?? null, quantity ?? null);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
}

export function listOrders() {
  return db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
}

export function cancelOrder(id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return null;
  if (order.status !== 'ACTIVE') return order;
  db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE id = ?").run(id);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

function conditionMet(condition, price, triggerPrice) {
  return condition === 'DROPS_BELOW' ? price <= triggerPrice : price >= triggerPrice;
}

export async function checkAndExecuteOrders() {
  const active = db.prepare("SELECT * FROM orders WHERE status = 'ACTIVE'").all();
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

  for (const order of active) {
    const quote = quotes[order.symbol];
    if (!quote) continue;
    if (!conditionMet(order.condition, quote.current, order.trigger_price)) continue;

    try {
      if (order.side === 'BUY') {
        const qty = Math.floor((order.amount_usd || 0) / quote.current);
        if (qty < 1) continue;
        executeTrade(order.symbol, 'BUY', qty, quote.current, 'AUTO');
        db.prepare("UPDATE orders SET status = 'EXECUTED', executed_at = datetime('now'), note = ? WHERE id = ?").run(
          `Bought ${qty} @ $${quote.current.toFixed(2)}`, order.id
        );
      } else {
        const holding = db.prepare('SELECT * FROM holdings WHERE symbol = ?').get(order.symbol);
        if (!holding || holding.quantity <= 0) {
          db.prepare("UPDATE orders SET status = 'FAILED', note = 'No shares held to sell' WHERE id = ?").run(order.id);
          continue;
        }
        const qty = order.quantity ? Math.min(order.quantity, holding.quantity) : holding.quantity;
        executeTrade(order.symbol, 'SELL', qty, quote.current, 'AUTO');
        db.prepare("UPDATE orders SET status = 'EXECUTED', executed_at = datetime('now'), note = ? WHERE id = ?").run(
          `Sold ${qty} @ $${quote.current.toFixed(2)}`, order.id
        );
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
