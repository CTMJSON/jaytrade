import { EventEmitter } from 'node:events';
import { getQuote } from './finnhub.js';

// Push-based live quotes over Finnhub's free WebSocket feed. This replaces client-side REST
// polling for price as the primary path: the server holds ONE upstream connection and fans
// updates out to every connected browser over SSE (see `/api/quotes/stream` in index.js), so
// there is no client poll interval to race, no per-client cache TTL to go stale independently,
// and no way for two overlapping requests to land out of order (there's only one writer: the
// trade stream itself, applied in the order Finnhub sent it).
//
// REST (`getQuote`/`getQuoteWithMeta` in finnhub.js) remains the fallback: outside market hours,
// for symbols with no recent trade, or if FINNHUB_API_KEY is unset / the socket is down.

const FINNHUB_WS_URL = 'wss://ws.finnhub.io';

// Finnhub's free tier caps WebSocket subscriptions at 50 symbols. Above that, additional
// symbols simply won't get live pushes and fall back to REST polling - not a crash, but worth
// surfacing loudly since it silently degrades exactly the thing this module exists to fix.
const MAX_WS_SYMBOLS = 50;

// A live price we haven't heard an update for in this long is treated as unusable (rather than
// confidently "live") and callers should fall back to REST - low-liquidity names can legitimately
// go quiet for a while without the feed being broken.
const STALE_AFTER_MS = 60 * 1000;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const subscribed = new Set();
const latest = new Map(); // symbol -> { symbol, current, change, percentChange, previousClose, asOf }

let ws = null;
let connecting = false;
let reconnectDelayMs = 1000;
const RECONNECT_MAX_MS = 30000;

function apiKey() {
  return process.env.FINNHUB_API_KEY || null;
}

export function isLiveFeedEnabled() {
  return Boolean(apiKey());
}

function sendSubscribe(symbol) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', symbol }));
  }
}

async function applyTrade(symbol, price, tradeTimeMs) {
  if (!Number.isFinite(price)) return;
  const prior = latest.get(symbol);
  let previousClose = prior?.previousClose ?? null;
  if (previousClose == null) {
    // Trade messages only carry price/volume/time, not a reference close - fetch it once (REST,
    // itself cached 15s) so we can report change/%change alongside the live price.
    try {
      const restQuote = await getQuote(symbol);
      previousClose = restQuote?.previousClose ?? null;
    } catch {
      previousClose = null;
    }
  }
  const change = previousClose != null ? price - previousClose : null;
  const percentChange = previousClose ? (change / previousClose) * 100 : null;
  const entry = {
    symbol,
    current: price,
    change,
    percentChange,
    previousClose,
    asOf: tradeTimeMs || Date.now(),
    source: 'ws',
  };
  latest.set(symbol, entry);
  emitter.emit('quote', entry);
}

function connect() {
  const key = apiKey();
  if (!key || connecting || (ws && ws.readyState === WebSocket.OPEN)) return;
  connecting = true;

  ws = new WebSocket(`${FINNHUB_WS_URL}?token=${key}`);

  ws.addEventListener('open', () => {
    connecting = false;
    reconnectDelayMs = 1000;
    console.log(`[live-quotes] Finnhub WebSocket connected (${subscribed.size} symbols)`);
    for (const symbol of subscribed) sendSubscribe(symbol);
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'error') {
      console.error('[live-quotes] Finnhub WS error message:', msg.msg);
      return;
    }
    if (msg.type !== 'trade' || !Array.isArray(msg.data)) return;
    for (const trade of msg.data) {
      applyTrade(trade.s, trade.p, trade.t);
    }
  });

  ws.addEventListener('close', () => {
    connecting = false;
    ws = null;
    scheduleReconnect();
  });

  ws.addEventListener('error', (err) => {
    console.error('[live-quotes] Finnhub WS connection error:', err?.message || err);
    // 'close' always follows 'error' on a WebSocket, which schedules the reconnect - avoid
    // double-scheduling here.
  });
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelayMs).unref();
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
}

/** Ensure the given symbols are subscribed on the shared live feed. Safe to call repeatedly -
 * already-subscribed symbols are a no-op. Silently caps at MAX_WS_SYMBOLS (logs once per
 * rejected symbol) rather than failing the caller; REST remains the fallback for the overflow. */
export function subscribeQuotes(symbols) {
  if (!isLiveFeedEnabled()) return;
  connect();
  for (const symbol of symbols) {
    if (!symbol || subscribed.has(symbol)) continue;
    if (subscribed.size >= MAX_WS_SYMBOLS) {
      console.warn(`[live-quotes] symbol cap (${MAX_WS_SYMBOLS}) reached - "${symbol}" stays on REST-only fallback`);
      continue;
    }
    subscribed.add(symbol);
    sendSubscribe(symbol);
  }
}

/** Returns the last live trade for `symbol`, or null if we've never seen one / it's gone stale
 * (caller should fall back to REST via `getQuote`/`getQuoteWithMeta`). */
export function getLiveQuote(symbol) {
  const entry = latest.get(symbol);
  if (!entry) return null;
  if (Date.now() - entry.asOf > STALE_AFTER_MS) return null;
  return entry;
}

/** Subscribe to every live quote update as it arrives (used by the SSE endpoint to fan out to
 * connected clients). Returns an unsubscribe function. */
export function onQuoteUpdate(handler) {
  emitter.on('quote', handler);
  return () => emitter.off('quote', handler);
}
