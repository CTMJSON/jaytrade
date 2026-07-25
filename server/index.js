import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';
import { searchSymbols, getQuote, getProfile, getRecommendationTrends } from './finnhub.js';
import { getDailyHistory, getIntradayHistory, getVolumeStats } from './marketdata.js';
import { MOVERS_WATCHLIST, INDEX_PROXIES } from './watchlist.js';
import { executeTrade, TradeError } from './trading.js';
import { createOrder, listOrders, cancelOrder, checkAndExecuteOrders } from './orders.js';
import { cached } from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const STARTING_CASH = Number(process.env.STARTING_CASH || 100000);

app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const results = await searchSymbols(q);
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/quote/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const quote = await getQuote(symbol);
    if (!quote) return res.status(404).json({ error: 'Symbol not found' });
    const profile = await getProfile(symbol);
    res.json({ ...quote, name: profile?.name || symbol, logo: profile?.logo || null });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/recommendation/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  try {
    const data = await cached(`rec:${symbol}`, 6 * 60 * 60 * 1000, () => getRecommendationTrends(symbol));
    if (!data) return res.status(404).json({ error: 'No recommendation data' });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/movers', async (req, res) => {
  try {
    const data = await cached('movers', 3 * 60 * 1000, async () => {
      const results = await Promise.all(
        MOVERS_WATCHLIST.map(async (symbol) => {
          try {
            const [quote, profile, volStats] = await Promise.all([
              getQuote(symbol),
              getProfile(symbol).catch(() => null),
              getVolumeStats(symbol).catch(() => null),
            ]);
            if (!quote) return null;
            return {
              symbol,
              ...quote,
              volume: volStats?.volume ?? null,
              avgVolume: volStats?.avgVolume ?? null,
              relativeVolume: volStats?.relativeVolume ?? null,
              marketCap: profile?.marketCapitalization ?? null,
              floatShares: profile?.floatingShare ?? null,
            };
          } catch {
            return null;
          }
        })
      );
      const valid = results.filter(Boolean).filter((q) => q.percentChange != null);
      const gainers = valid.filter((q) => q.percentChange >= 0).sort((a, b) => b.percentChange - a.percentChange);
      const losers = valid.filter((q) => q.percentChange < 0).sort((a, b) => a.percentChange - b.percentChange);
      return { gainers, losers };
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const historyFallback = new Map();

app.get('/api/history/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const range = req.query.range || '5d';
  const interval = req.query.interval || '15m';
  const fallbackKey = `${symbol}:${range}:${interval}`;
  try {
    const data = await cached(fallbackKey, 60 * 1000, () => getIntradayHistory(symbol, range, interval));
    historyFallback.set(fallbackKey, data);
    res.json(data);
  } catch (err) {
    const fallback = historyFallback.get(fallbackKey);
    if (fallback) return res.json(fallback);
    res.status(502).json({ error: err.message });
  }
});

let indicesCache = { data: null, time: 0 };

app.get('/api/indices', async (req, res) => {
  const now = Date.now();
  if (indicesCache.data && now - indicesCache.time < 5 * 60 * 1000) {
    return res.json(indicesCache.data);
  }

  const results = await Promise.all(
    INDEX_PROXIES.map(async ({ symbol, label }) => {
      try {
        const history = await getDailyHistory(symbol, '5d');
        return { ...history, label };
      } catch (err) {
        return { symbol, label, error: err.message, points: [] };
      }
    })
  );

  const allFailed = results.every((r) => r.error);
  if (allFailed && indicesCache.data) {
    // Transient failure (e.g. right after restart) - serve last good data instead of "Unavailable"
    return res.json(indicesCache.data);
  }

  indicesCache = { data: results, time: now };
  res.json(results);
});

app.get('/api/portfolio', async (req, res) => {
  const account = db.prepare('SELECT cash FROM account WHERE id = 1').get();
  const holdings = db.prepare('SELECT symbol, quantity, avg_cost FROM holdings WHERE quantity > 0').all();

  const enriched = await Promise.all(
    holdings.map(async (h) => {
      let quote = null;
      try {
        quote = await getQuote(h.symbol);
      } catch {
        quote = null;
      }
      const currentPrice = quote?.current ?? h.avg_cost;
      const marketValue = currentPrice * h.quantity;
      const costBasis = h.avg_cost * h.quantity;
      const unrealizedPL = marketValue - costBasis;
      const unrealizedPLPercent = costBasis > 0 ? (unrealizedPL / costBasis) * 100 : 0;
      return {
        symbol: h.symbol,
        quantity: h.quantity,
        avgCost: h.avg_cost,
        currentPrice,
        marketValue,
        costBasis,
        unrealizedPL,
        unrealizedPLPercent,
      };
    })
  );

  const holdingsValue = enriched.reduce((sum, h) => sum + h.marketValue, 0);
  const totalValue = account.cash + holdingsValue;
  const totalPL = totalValue - STARTING_CASH;
  const totalPLPercent = (totalPL / STARTING_CASH) * 100;

  res.json({
    cash: account.cash,
    startingCash: STARTING_CASH,
    holdingsValue,
    totalValue,
    totalPL,
    totalPLPercent,
    holdings: enriched,
  });
});

app.get('/api/trades', (req, res) => {
  const trades = db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 100').all();
  res.json(trades);
});

app.post('/api/trade', async (req, res) => {
  const { symbol: rawSymbol, side, quantity } = req.body;
  const symbol = String(rawSymbol || '').toUpperCase().trim();
  const qty = Number(quantity);

  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  if (!['BUY', 'SELL'].includes(side)) return res.status(400).json({ error: 'Side must be BUY or SELL' });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be a positive number' });

  let quote;
  try {
    quote = await getQuote(symbol);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
  if (!quote) return res.status(404).json({ error: 'Symbol not found' });

  try {
    const result = executeTrade(symbol, side, qty, quote.current, 'MANUAL');
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof TradeError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.get('/api/orders', (req, res) => {
  res.json(listOrders());
});

app.post('/api/orders', (req, res) => {
  const { symbol: rawSymbol, side, condition, triggerPrice, amountUsd, quantity } = req.body;
  const symbol = String(rawSymbol || '').toUpperCase().trim();
  const price = Number(triggerPrice);

  if (!symbol) return res.status(400).json({ error: 'Symbol is required' });
  if (!['BUY', 'SELL'].includes(side)) return res.status(400).json({ error: 'Side must be BUY or SELL' });
  if (!['DROPS_BELOW', 'RISES_ABOVE'].includes(condition)) {
    return res.status(400).json({ error: 'Condition must be DROPS_BELOW or RISES_ABOVE' });
  }
  if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: 'Trigger price must be positive' });

  if (side === 'BUY') {
    const amount = Number(amountUsd);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amountUsd must be a positive number for BUY orders' });
    }
    const order = createOrder({ symbol, side, condition, triggerPrice: price, amountUsd: amount });
    return res.json(order);
  }

  const qty = quantity != null ? Number(quantity) : null;
  if (qty != null && (!Number.isFinite(qty) || qty <= 0)) {
    return res.status(400).json({ error: 'quantity must be a positive number or omitted to sell all holdings' });
  }
  const order = createOrder({ symbol, side, condition, triggerPrice: price, quantity: qty });
  res.json(order);
});

app.post('/api/orders/:id/cancel', (req, res) => {
  const order = cancelOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.post('/api/reset', (req, res) => {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM holdings').run();
    db.prepare('DELETE FROM trades').run();
    db.prepare('DELETE FROM orders').run();
    db.prepare('UPDATE account SET cash = ? WHERE id = 1').run(STARTING_CASH);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  res.json({ success: true });
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^\/(?!api).*/, (req, res, next) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

const ORDER_POLL_INTERVAL = Number(process.env.ORDER_POLL_INTERVAL_MS || 60000);
setInterval(() => {
  checkAndExecuteOrders().catch((err) => console.error('Order poll error:', err));
}, ORDER_POLL_INTERVAL);

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Stock simulator API listening on http://${HOST}:${PORT}`);
});
