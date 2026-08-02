import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructCurve, BENCHMARK_SYMBOL } from './portfolio-history.js';

/** Build a daily close series from [date, close] pairs. */
function series(pairs) {
  return pairs.map(([date, close]) => ({ date, close }));
}

const SPY = series([
  ['2026-01-05', 100],
  ['2026-01-06', 101],
  ['2026-01-07', 102],
  ['2026-01-08', 99],
  ['2026-01-09', 110],
]);

function run(overrides = {}) {
  return reconstructCurve({
    rangeKey: 'all',
    windowStart: '2026-01-05',
    inceptionDay: '2026-01-05',
    startingCash: 10000,
    trades: [],
    seriesBySymbol: new Map([[BENCHMARK_SYMBOL, SPY]]),
    ...overrides,
  });
}

test('with no trades the curve is flat at starting cash', () => {
  const result = run();
  assert.equal(result.points.length, 5);
  assert.ok(result.points.every((p) => p.value === 10000));
  assert.equal(result.startValue, 10000);
  assert.equal(result.endValue, 10000);
  assert.equal(result.changePercent, 0);
});

test('a buy converts cash into position value at each day close', () => {
  const result = run({
    trades: [
      { symbol: 'AAA', side: 'BUY', quantity: 10, price: 50, total: 500, created_at: '2026-01-06 15:00:00' },
    ],
    seriesBySymbol: new Map([
      [BENCHMARK_SYMBOL, SPY],
      ['AAA', series([['2026-01-05', 49], ['2026-01-06', 50], ['2026-01-07', 60], ['2026-01-08', 40], ['2026-01-09', 55]])],
    ]),
  });

  const byDate = Object.fromEntries(result.points.map((p) => [p.date, p.value]));
  // Before the trade: untouched cash.
  assert.equal(byDate['2026-01-05'], 10000);
  // Day of trade: 9500 cash + 10 shares @ 50.
  assert.equal(byDate['2026-01-06'], 10000);
  // Position appreciates to 60.
  assert.equal(byDate['2026-01-07'], 9500 + 600);
  // ...and drops to 40.
  assert.equal(byDate['2026-01-08'], 9500 + 400);
  assert.equal(byDate['2026-01-09'], 9500 + 550);
});

test('a round trip locks in profit as cash', () => {
  const result = run({
    trades: [
      { symbol: 'AAA', side: 'BUY', quantity: 10, price: 50, total: 500, created_at: '2026-01-06 15:00:00' },
      { symbol: 'AAA', side: 'SELL', quantity: 10, price: 60, total: 600, created_at: '2026-01-07 15:00:00' },
    ],
    seriesBySymbol: new Map([
      [BENCHMARK_SYMBOL, SPY],
      ['AAA', series([['2026-01-06', 50], ['2026-01-07', 60], ['2026-01-08', 40], ['2026-01-09', 55]])],
    ]),
  });

  const byDate = Object.fromEntries(result.points.map((p) => [p.date, p.value]));
  assert.equal(byDate['2026-01-07'], 10100);
  // Position is closed, so the later crash to 40 must not affect the portfolio.
  assert.equal(byDate['2026-01-08'], 10100);
  assert.equal(byDate['2026-01-09'], 10100);
  assert.equal(result.endValue, 10100);
  assert.equal(result.changePercent, 1);
});

test('a window starting mid-history replays earlier trades into the opening balance', () => {
  const trades = [
    { symbol: 'AAA', side: 'BUY', quantity: 10, price: 50, total: 500, created_at: '2026-01-05 15:00:00' },
  ];
  const seriesBySymbol = new Map([
    [BENCHMARK_SYMBOL, SPY],
    ['AAA', series([['2026-01-05', 50], ['2026-01-06', 50], ['2026-01-07', 70], ['2026-01-08', 70], ['2026-01-09', 70]])],
  ]);

  const windowed = reconstructCurve({
    rangeKey: '1w',
    windowStart: '2026-01-07',
    inceptionDay: '2026-01-05',
    startingCash: 10000,
    trades,
    seriesBySymbol,
  });

  assert.equal(windowed.points.length, 3);
  assert.equal(windowed.points[0].date, '2026-01-07');
  // 9500 cash + 10 @ 70 — the pre-window purchase is reflected, not ignored.
  assert.equal(windowed.points[0].value, 10200);
});

test('benchmark is normalised to the portfolio value at the window open', () => {
  const result = run();
  const first = result.points[0];
  const last = result.points[result.points.length - 1];

  assert.equal(first.benchmark, 10000);
  // SPY 100 -> 110 is +10%, so the benchmark line ends at 11000.
  assert.equal(last.benchmark, 11000);
  assert.equal(result.benchmarkChangePercent, 10);
  // Flat portfolio vs +10% benchmark.
  assert.equal(result.changePercent, 0);
});

test('missing price data falls back to the last traded price instead of zeroing a position', () => {
  const result = run({
    trades: [
      { symbol: 'ZZZ', side: 'BUY', quantity: 4, price: 25, total: 100, created_at: '2026-01-06 15:00:00' },
    ],
    seriesBySymbol: new Map([
      [BENCHMARK_SYMBOL, SPY],
      ['ZZZ', []], // upstream had no data for this symbol
    ]),
  });

  const byDate = Object.fromEntries(result.points.map((p) => [p.date, p.value]));
  assert.equal(byDate['2026-01-09'], 9900 + 100);
});

test('forward-fills across a gap in the price series', () => {
  const result = run({
    trades: [
      { symbol: 'AAA', side: 'BUY', quantity: 10, price: 50, total: 500, created_at: '2026-01-05 15:00:00' },
    ],
    seriesBySymbol: new Map([
      [BENCHMARK_SYMBOL, SPY],
      // No bar on the 7th or 8th.
      ['AAA', series([['2026-01-05', 50], ['2026-01-06', 60], ['2026-01-09', 80]])],
    ]),
  });

  const byDate = Object.fromEntries(result.points.map((p) => [p.date, p.value]));
  assert.equal(byDate['2026-01-07'], 9500 + 600, 'holds the last known close');
  assert.equal(byDate['2026-01-08'], 9500 + 600);
  assert.equal(byDate['2026-01-09'], 9500 + 800);
});

test('falls back to the union of symbol dates when the benchmark is unavailable', () => {
  const result = run({
    seriesBySymbol: new Map([
      [BENCHMARK_SYMBOL, []],
      ['AAA', series([['2026-01-06', 10], ['2026-01-07', 20]])],
    ]),
    trades: [
      { symbol: 'AAA', side: 'BUY', quantity: 1, price: 10, total: 10, created_at: '2026-01-06 15:00:00' },
    ],
  });

  assert.equal(result.points.length, 2);
  assert.equal(result.points[0].benchmark, null);
  assert.equal(result.benchmarkChangePercent, null);
  assert.equal(result.points[1].value, 9990 + 20);
});

test('reports insufficient history rather than fabricating a curve', () => {
  const result = run({
    windowStart: '2030-01-01',
    seriesBySymbol: new Map([[BENCHMARK_SYMBOL, SPY]]),
  });
  assert.equal(result.points.length, 0);
  assert.equal(result.insufficientHistory, true);
  assert.equal(result.endValue, null);
});

test('sell-everything returns the portfolio to pure cash', () => {
  const result = run({
    trades: [
      { symbol: 'AAA', side: 'BUY', quantity: 10, price: 50, total: 500, created_at: '2026-01-05 15:00:00' },
      { symbol: 'AAA', side: 'SELL', quantity: 10, price: 45, total: 450, created_at: '2026-01-09 15:00:00' },
    ],
    seriesBySymbol: new Map([
      [BENCHMARK_SYMBOL, SPY],
      ['AAA', series([['2026-01-05', 50], ['2026-01-09', 45]])],
    ]),
  });

  assert.equal(result.endValue, 9950);
  assert.equal(result.changePercent, -0.5);
});
