import test from 'node:test';
import assert from 'node:assert/strict';
import db from './db.js';
import { getTier, generateTriggerSet, recomputeAfterFire } from './auto-triggers.js';

// Integration-style against the real db module (not pure-function unit tests) because this
// module's behavior IS a small state machine over the orders/holdings/trades tables - the bug
// this caught during development (a fired trim silently deleting the "next" trim target instead
// of re-arming it) only shows up when you look at what ends up in the DB after a sequence of
// events, not in isolated price-formula math.

let accountId;

function makeAccount(name) {
  db.prepare(
    'INSERT INTO accounts (name, pin_hash, pin_salt, cash, starting_cash) VALUES (?, ?, ?, ?, ?)'
  ).run(name, 'x', 'x', 1_000_000, 1_000_000);
  return db.prepare('SELECT id FROM accounts WHERE name = ?').get(name).id;
}

function setHolding(symbol, quantity, avgCost) {
  db.prepare(
    `INSERT INTO holdings (account_id, symbol, quantity, avg_cost) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, symbol) DO UPDATE SET quantity = excluded.quantity, avg_cost = excluded.avg_cost`
  ).run(accountId, symbol, quantity, avgCost);
}

function activeOrders(symbol) {
  return db
    .prepare(`SELECT * FROM orders WHERE account_id = ? AND symbol = ? AND status = 'ACTIVE' ORDER BY role`)
    .all(accountId, symbol);
}

function byRole(symbol, role) {
  return activeOrders(symbol).find((o) => o.role === role);
}

test.beforeEach(() => {
  accountId = makeAccount(`test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
});

test.afterEach(() => {
  db.prepare('DELETE FROM orders WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM trades WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM holdings WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
});

test('tier lookup defaults to standard and honors the seeded overrides', () => {
  assert.equal(getTier('NFLX').name, 'standard');
  assert.equal(getTier('AAPL').name, 'low');
  assert.equal(getTier('SPCX').name, 'high');
});

test('generateTriggerSet produces the full standard bracket off avg cost', () => {
  setHolding('NFLX', 100, 100);
  generateTriggerSet(accountId, 'NFLX');

  const stop = byRole('NFLX', 'STOP_LOSS');
  const trim = byRole('NFLX', 'TRIM_TARGET');
  const dip = byRole('NFLX', 'DIP_BUY');
  const breakout = byRole('NFLX', 'BREAKOUT_BUY');

  assert.equal(stop.side, 'SELL');
  assert.equal(stop.trigger_price, 91); // -9%
  assert.equal(stop.quantity, 100);

  assert.equal(trim.side, 'SELL');
  assert.equal(trim.trigger_price, 127); // +27%
  assert.equal(trim.quantity, 25); // 25% of position

  assert.equal(dip.side, 'BUY');
  assert.equal(dip.trigger_price, 90); // -10%
  assert.equal(dip.amount_usd, 2000); // 20% of $10,000 opening value

  assert.equal(breakout.side, 'BUY');
  assert.equal(breakout.trigger_price, 105); // +5%
  assert.equal(breakout.amount_usd, 2000);
  assert.equal(breakout.armed, 0); // unarmed until a trim fires
});

test('generateTriggerSet applies tighter/wider bands by volatility tier', () => {
  setHolding('AAPL', 100, 200);
  generateTriggerSet(accountId, 'AAPL');
  assert.equal(byRole('AAPL', 'STOP_LOSS').trigger_price, 186); // -7%
  assert.equal(byRole('AAPL', 'TRIM_TARGET').trigger_price, 240); // +20%

  setHolding('SPCX', 100, 100);
  generateTriggerSet(accountId, 'SPCX');
  assert.equal(byRole('SPCX', 'STOP_LOSS').trigger_price, 88); // -12%
  assert.equal(byRole('SPCX', 'TRIM_TARGET').trigger_price, 135); // +35%
});

test('generateTriggerSet cancels a prior auto bracket and leaves manual orders alone', () => {
  setHolding('NFLX', 100, 100);
  generateTriggerSet(accountId, 'NFLX');
  const firstStopId = byRole('NFLX', 'STOP_LOSS').id;

  db.prepare(
    `INSERT INTO orders (account_id, symbol, side, condition, trigger_price, amount_usd, role)
     VALUES (?, 'NFLX', 'BUY', 'DROPS_BELOW', 50, 500, 'MANUAL')`
  ).run(accountId);

  setHolding('NFLX', 100, 110); // position state "changed" (e.g. averaged up)
  generateTriggerSet(accountId, 'NFLX');

  const stop = byRole('NFLX', 'STOP_LOSS');
  assert.notEqual(stop.id, firstStopId, 'old auto bracket should be replaced, not reused');
  assert.equal(activeOrders('NFLX').filter((o) => o.role === 'MANUAL').length, 1, 'manual order untouched');
});

test('generateTriggerSet omits a fresh dip-buy inside the 30-day re-entry cooldown', () => {
  setHolding('NFLX', 100, 100);
  db.prepare(
    `INSERT INTO trades (account_id, symbol, side, quantity, price, total, source, trigger_role)
     VALUES (?, 'NFLX', 'BUY', 10, 90, 900, 'AUTO', 'DIP_BUY')`
  ).run(accountId);

  generateTriggerSet(accountId, 'NFLX');
  assert.equal(byRole('NFLX', 'DIP_BUY'), undefined);
});

test('stop-loss firing cancels every other active auto order for that symbol', () => {
  setHolding('NFLX', 100, 100);
  generateTriggerSet(accountId, 'NFLX');
  db.prepare("DELETE FROM holdings WHERE account_id = ? AND symbol = ?").run(accountId, 'NFLX'); // simulate the stop-loss sale closing the position

  const cancelled = recomputeAfterFire(accountId, 'NFLX', 'STOP_LOSS', 91);
  assert.ok(cancelled.length >= 3);
  assert.equal(activeOrders('NFLX').length, 0);
});

test('trim-target firing re-arms a fresh trim, updates the trailing stop, and arms breakout-buy', () => {
  setHolding('NFLX', 100, 100);
  generateTriggerSet(accountId, 'NFLX');
  const originalTrimId = byRole('NFLX', 'TRIM_TARGET').id;

  // Simulate the 25-share trim fill: holding shrinks, trim order elsewhere gets marked EXECUTED.
  setHolding('NFLX', 75, 100);
  db.prepare("UPDATE orders SET status = 'EXECUTED' WHERE id = ?").run(originalTrimId);

  recomputeAfterFire(accountId, 'NFLX', 'TRIM_TARGET', 127);

  const newTrim = byRole('NFLX', 'TRIM_TARGET');
  assert.notEqual(newTrim.id, originalTrimId, 'a fresh trim order should replace the fired one');
  assert.equal(newTrim.trigger_price, round2(127 * 1.27));
  assert.equal(newTrim.quantity, Math.floor(75 * 0.25));

  const stop = byRole('NFLX', 'STOP_LOSS');
  assert.equal(stop.trigger_price, round2(127 * 0.91));
  assert.equal(stop.quantity, 75, 'stop-loss should track the reduced position size');

  const breakout = byRole('NFLX', 'BREAKOUT_BUY');
  assert.equal(breakout.armed, 1);
  assert.equal(breakout.trigger_price, round2(127 * 1.05));
});

test('dip-buy firing recalculates both stop-loss and trim off the new blended cost/size', () => {
  setHolding('NFLX', 100, 100);
  generateTriggerSet(accountId, 'NFLX');
  const dipId = byRole('NFLX', 'DIP_BUY').id;

  // Simulate the dip-buy fill: 20 more shares at $90, blending the average cost down.
  const newQty = 120;
  const newAvgCost = (100 * 100 + 20 * 90) / newQty;
  setHolding('NFLX', newQty, newAvgCost);
  db.prepare("UPDATE orders SET status = 'EXECUTED' WHERE id = ?").run(dipId);

  recomputeAfterFire(accountId, 'NFLX', 'DIP_BUY', 90);

  const stop = byRole('NFLX', 'STOP_LOSS');
  assert.equal(stop.trigger_price, round2(newAvgCost * 0.91));
  assert.equal(stop.quantity, newQty);

  const trim = byRole('NFLX', 'TRIM_TARGET');
  assert.equal(trim.trigger_price, round2(newAvgCost * 1.27));
  assert.equal(trim.quantity, Math.floor(newQty * 0.25));
});

test('breakout-buy firing recalculates only the trim target, not the stop-loss', () => {
  setHolding('NFLX', 100, 100);
  generateTriggerSet(accountId, 'NFLX');
  const stopBefore = byRole('NFLX', 'STOP_LOSS');
  const breakoutId = byRole('NFLX', 'BREAKOUT_BUY').id;

  const newQty = 120;
  const newAvgCost = (100 * 100 + 20 * 105) / newQty;
  setHolding('NFLX', newQty, newAvgCost);
  db.prepare("UPDATE orders SET status = 'EXECUTED' WHERE id = ?").run(breakoutId);

  recomputeAfterFire(accountId, 'NFLX', 'BREAKOUT_BUY', 105);

  const stopAfter = byRole('NFLX', 'STOP_LOSS');
  assert.equal(stopAfter.id, stopBefore.id);
  assert.equal(stopAfter.trigger_price, stopBefore.trigger_price, 'breakout-buy fire should not touch the stop-loss');

  const trim = byRole('NFLX', 'TRIM_TARGET');
  assert.equal(trim.trigger_price, round2(newAvgCost * 1.27));
});

function round2(n) {
  return Math.round(n * 100) / 100;
}
