import 'dotenv/config';
import dns from 'node:dns';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

// Some networks have a dead/blackholed IPv6 route that doesn't reject fast (unlike IPv4
// refusals), so undici's happy-eyeballs can hang on it until timeout before falling back.
// Preferring IPv4 first avoids that stall entirely for hosts that support both.
dns.setDefaultResultOrder('ipv4first');
import { searchSymbols, getQuote, getProfile, getRecommendationTrends } from './finnhub.js';
import { executeTrade, TradeError } from './trading.js';
import { createOrder, listOrders, cancelOrder, checkAndExecuteOrders } from './orders.js';
import { computeMovers, computeIndices, computeHistory } from './dashboard.js';
import { startCacheWarmer } from './warmer.js';
import { buildPortfolioSummary } from './portfolio-analytics.js';
import { computeHoldingSignals } from './signals.js';
import { register, login, logout, requireAuth, AuthError } from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const STARTING_CASH = Number(process.env.STARTING_CASH || 100000);

// The apex domain gets a static marketing page; every other hostname (app.jaytrade.vip,
// localhost, the LAN hostname, etc.) gets the actual trading app below.
const LANDING_HOST = process.env.LANDING_HOST || null;
if (LANDING_HOST) {
  const landingDir = path.join(__dirname, 'landing');
  app.use('/landing/assets', express.static(path.join(landingDir, 'assets')));
  app.get('/', (req, res, next) => {
    if (req.hostname === LANDING_HOST) return res.sendFile(path.join(landingDir, 'index.html'));
    next();
  });
}

// --- Auth (name + PIN accounts) ---

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body.name || '').trim();
  const pin = String(req.body.pin || '').trim();
  try {
    const token = register(name, pin, STARTING_CASH);
    res.json({ token, name });
  } catch (err) {
    if (err instanceof AuthError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.post('/api/auth/login', (req, res) => {
  const name = String(req.body.name || '').trim();
  const pin = String(req.body.pin || '').trim();
  try {
    const token = login(name, pin);
    res.json({ token, name });
  } catch (err) {
    if (err instanceof AuthError) return res.status(401).json({ error: err.message });
    throw err;
  }
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  logout(token);
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ name: req.account.name });
});

// --- Shared market data (no auth - same for every account) ---

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
    const data = await getRecommendationTrends(symbol);
    if (!data) return res.status(404).json({ error: 'No recommendation data' });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/movers', async (req, res) => {
  try {
    res.json(await computeMovers());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/history/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const range = req.query.range || '5d';
  const interval = req.query.interval || '15m';
  try {
    res.json(await computeHistory(symbol, range, interval));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/indices', async (req, res) => {
  res.json(await computeIndices());
});

// --- Account-scoped routes (require login) ---

app.get('/api/portfolio', requireAuth, async (req, res) => {
  res.json(await buildPortfolioSummary(req.account.id));
});

app.get('/api/portfolio/signals', requireAuth, async (req, res) => {
  try {
    const portfolio = await buildPortfolioSummary(req.account.id);
    const signals = await computeHoldingSignals(portfolio.holdings);
    res.json(signals);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/trades', requireAuth, (req, res) => {
  const trades = db.prepare('SELECT * FROM trades WHERE account_id = ? ORDER BY id DESC LIMIT 100').all(req.account.id);
  res.json(trades);
});

app.post('/api/trade', requireAuth, async (req, res) => {
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
    const result = executeTrade(req.account.id, symbol, side, qty, quote.current, 'MANUAL');
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof TradeError) return res.status(400).json({ error: err.message });
    throw err;
  }
});

app.get('/api/orders', requireAuth, (req, res) => {
  res.json(listOrders(req.account.id));
});

app.post('/api/orders', requireAuth, (req, res) => {
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
    const order = createOrder(req.account.id, { symbol, side, condition, triggerPrice: price, amountUsd: amount });
    return res.json(order);
  }

  const qty = quantity != null ? Number(quantity) : null;
  if (qty != null && (!Number.isFinite(qty) || qty <= 0)) {
    return res.status(400).json({ error: 'quantity must be a positive number or omitted to sell all holdings' });
  }
  const order = createOrder(req.account.id, { symbol, side, condition, triggerPrice: price, quantity: qty });
  res.json(order);
});

app.post('/api/orders/:id/cancel', requireAuth, (req, res) => {
  const order = cancelOrder(req.account.id, Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.post('/api/reset', requireAuth, (req, res) => {
  const accountId = req.account.id;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM holdings WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM trades WHERE account_id = ?').run(accountId);
    db.prepare('DELETE FROM orders WHERE account_id = ?').run(accountId);
    db.prepare('UPDATE accounts SET cash = starting_cash WHERE id = ?').run(accountId);
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

startCacheWarmer();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Stock simulator API listening on http://${HOST}:${PORT}`);
});
