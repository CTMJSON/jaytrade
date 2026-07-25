import db from './db.js';

export class TradeError extends Error {}

export function executeTrade(symbol, side, qty, price, source = 'MANUAL') {
  const total = price * qty;
  const account = db.prepare('SELECT cash FROM account WHERE id = 1').get();
  const holding = db.prepare('SELECT * FROM holdings WHERE symbol = ?').get(symbol);

  if (side === 'BUY') {
    if (total > account.cash) throw new TradeError('Insufficient cash for this purchase');

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE account SET cash = cash - ? WHERE id = 1').run(total);
      if (holding) {
        const newQty = holding.quantity + qty;
        const newAvgCost = (holding.avg_cost * holding.quantity + total) / newQty;
        db.prepare('UPDATE holdings SET quantity = ?, avg_cost = ? WHERE symbol = ?').run(newQty, newAvgCost, symbol);
      } else {
        db.prepare('INSERT INTO holdings (symbol, quantity, avg_cost) VALUES (?, ?, ?)').run(symbol, qty, price);
      }
      db.prepare('INSERT INTO trades (symbol, side, quantity, price, total, source) VALUES (?, ?, ?, ?, ?, ?)').run(
        symbol, 'BUY', qty, price, total, source
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
      db.prepare('UPDATE account SET cash = cash + ? WHERE id = 1').run(total);
      const newQty = holding.quantity - qty;
      if (newQty <= 0) {
        db.prepare('DELETE FROM holdings WHERE symbol = ?').run(symbol);
      } else {
        db.prepare('UPDATE holdings SET quantity = ? WHERE symbol = ?').run(newQty, symbol);
      }
      db.prepare('INSERT INTO trades (symbol, side, quantity, price, total, source) VALUES (?, ?, ?, ?, ?, ?)').run(
        symbol, 'SELL', qty, price, total, source
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return { symbol, side, quantity: qty, price, total };
}
