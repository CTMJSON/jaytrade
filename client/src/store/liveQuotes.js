// Minimal shared client-side store for server-pushed live quotes (see server/live-quotes.js +
// the `/api/quotes/stream` SSE endpoint). This exists so that N components interested in the
// same symbol's price share ONE upstream connection and ONE cache entry, instead of each
// panel polling `/api/quote`/`/api/movers` on its own independent timer - which is what let the
// same symbol show different prices in different parts of the page at the same moment (see
// jaytrade-audit.md root cause #4).
//
// This intentionally stays small and quote-focused rather than a full React Query/SWR
// replacement for every endpoint - see the overhaul PR description for what's still on
// independent polling (movers/indices list composition, portfolio, orders) and why.

const listeners = new Map(); // symbol -> Set<(entry) => void>
const latestBySymbol = new Map(); // symbol -> last live entry seen
let eventSource = null;
let currentSymbolsKey = '';

function reconnect() {
  const symbols = [...listeners.keys()];
  const key = symbols.slice().sort().join(',');
  if (key === currentSymbolsKey) return;
  currentSymbolsKey = key;

  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (!symbols.length) return;

  eventSource = new EventSource(`/api/quotes/stream?symbols=${encodeURIComponent(symbols.join(','))}`);
  eventSource.onmessage = (event) => {
    let entry;
    try {
      entry = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!entry?.symbol) return;
    latestBySymbol.set(entry.symbol, entry);
    listeners.get(entry.symbol)?.forEach((fn) => fn(entry));
  };
  // EventSource retries transient drops on its own; if the whole watchlist changes we just
  // reconnect with the new symbol set via the next subscribe/unsubscribe call above.
  eventSource.onerror = () => {};
}

/** Subscribe to live pushes for `symbol`. Calls `handler` immediately with the last known value
 * (if any), then again on every update. Returns an unsubscribe function. */
export function subscribeLiveQuote(symbol, handler) {
  if (!symbol) return () => {};
  let set = listeners.get(symbol);
  if (!set) {
    set = new Set();
    listeners.set(symbol, set);
  }
  set.add(handler);
  reconnect();

  const cached = latestBySymbol.get(symbol);
  if (cached) handler(cached);

  return () => {
    set.delete(handler);
    if (set.size === 0) listeners.delete(symbol);
    reconnect();
  };
}

export function getLastLiveQuote(symbol) {
  return symbol ? latestBySymbol.get(symbol) || null : null;
}
