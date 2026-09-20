import { useEffect, useState } from 'react';
import { getLastLiveQuote, subscribeLiveQuote } from './liveQuotes';

/** Live-updating quote for `symbol` via the shared SSE store, or null until the first push
 * arrives (or if `symbol` is falsy). Multiple components calling this for the same symbol share
 * one underlying connection/cache entry - see store/liveQuotes.js. */
export function useLiveQuote(symbol) {
  const [quote, setQuote] = useState(() => getLastLiveQuote(symbol));

  useEffect(() => {
    setQuote(getLastLiveQuote(symbol));
    if (!symbol) return undefined;
    return subscribeLiveQuote(symbol, setQuote);
  }, [symbol]);

  return quote;
}

/** Merges a live push (if any, and if newer) over a REST-sourced row that already has
 * `current`/`change`/`percentChange`/`asOf` fields - e.g. a `/api/movers` row - so the visible
 * price ticks in real time between REST poll cycles without losing the REST-only fields
 * (volume, market cap, etc.) that the live feed doesn't carry. */
export function mergeLiveQuote(row, live) {
  if (!row) return row;
  if (!live || (row.asOf && live.asOf <= row.asOf)) return row;
  return {
    ...row,
    current: live.current,
    change: live.change ?? row.change,
    percentChange: live.percentChange ?? row.percentChange,
    asOf: live.asOf,
    source: 'ws',
  };
}
