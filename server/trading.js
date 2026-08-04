import db from './db.js';
import { generateTriggerSet } from './auto-triggers.js';

export class TradeError extends Error {}

export function executeTrade(accountId, symbol, side, qty, price, source = 'MANUAL', triggerRole = null) {
  const total = price * qty;
  const account = db.prepare('SELECT cash FROM accounts WHERE id = ?').get(accountId);
  const holding = db.prepare('SELECT * FROM holdings WHERE account_id = ? AND symbol = ?').get(accountId, symbol);

  if (side === 'BUY') {
    if (total > account.cash) throw new TradeError('Insufficient cash for this purchase');

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE accounts SET cash = cash - ? WHERE id = ?').run(total, accountId);
      if (holding) {
        const newQty = holding.quantity + qty;
        const newAvgCost = (holding.avg_cost * holding.quantity + total) / newQty;
        db.prepare('UPDATE holdings SET quantity = ?, avg_cost = ? WHERE account_id = ? AND symbol = ?').run(
          newQty, newAvgCost, accountId, symbol
        );
      } else {
        db.prepare('INSERT INTO holdings (account_id, symbol, quantity, avg_cost) VALUES (?, ?, ?, ?)').run(
          accountId, symbol, qty, price
        );
      }
      db.prepare('INSERT INTO trades (account_id, symbol, side, quantity, price, total, source, trigger_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        accountId, symbol, 'BUY', qty, price, total, source, triggerRole
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } else {
    if (!holding || holding.quantity < qty) {
      throw new TradeError('Insufficient shares to sell');
    }

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE accounts SET cash = cash + ? WHERE id = ?').run(total, accountId);
      const newQty = holding.quantity - qty;
      if (newQty <= 0) {
        db.prepare('DELETE FROM holdings WHERE account_id = ? AND symbol = ?').run(accountId, symbol);
      } else {
        db.prepare('UPDATE holdings SET quantity = ? WHERE account_id = ? AND symbol = ?').run(newQty, accountId, symbol);
      }
      db.prepare('INSERT INTO trades (account_id, symbol, side, quantity, price, total, source, trigger_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        accountId, symbol, 'SELL', qty, price, total, source, triggerRole
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // Auto-trigger bracket regeneration only ever runs off a MANUAL fill (not an AUTO one - those
  // get their own narrower recompute in orders.js) - this is what makes "any manual buy/sell
  // regenerates the bracket from the new position state" true regardless of which route/UI
  // triggered the trade. Runs after commit since generateTriggerSet does its own writes and
  // this codebase's DB layer doesn't support nested transactions.
  if (source === 'MANUAL') {
    generateTriggerSet(accountId, symbol);
  }

  return { symbol, side, quantity: qty, price, total };
}
