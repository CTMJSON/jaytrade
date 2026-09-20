import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';
import { useLiveQuote, mergeLiveQuote } from '../store/useLiveQuote';

function TickerItem({ m, onSelectSymbol }) {
  const live = useLiveQuote(m.symbol);
  const row = mergeLiveQuote(m, live);
  const isGain = row.change >= 0;
  return (
    <button
      className={`ticker-item ${isGain ? 'positive' : 'negative'}`}
      onClick={() => onSelectSymbol(row.symbol)}
    >
      <span className="ticker-symbol">{row.symbol}</span>
      <span>{formatCurrency(row.current)}</span>
      <span>
        <span className="delta-arrow" aria-hidden="true">{isGain ? '▲' : '▼'}</span>
        {formatPercent(row.percentChange)}
      </span>
    </button>
  );
}

export default function MoversTicker({ onSelectSymbol }) {
  const [movers, setMovers] = useState(null);
  const [error, setError] = useState('');
  // Guards against an overlapping request applying an older response after a newer one landed.
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const id = ++requestId.current;
      try {
        const data = await api.movers();
        if (!cancelled && id === requestId.current) setMovers(data);
      } catch (err) {
        if (!cancelled && id === requestId.current) setError(err.message);
      }
    }
    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error && !movers) {
    return (
      <div className="ticker-wrap ticker-placeholder">
        <span className="ticker-placeholder-text">Live market data unavailable right now</span>
      </div>
    );
  }

  if (!movers) {
    return (
      <div className="ticker-wrap ticker-placeholder">
        <span className="ticker-placeholder-text">Loading market movers…</span>
      </div>
    );
  }

  const items = [...movers.gainers.slice(0, 8), ...movers.losers.slice(0, 8)];
  if (items.length === 0) return null;

  return (
    <div className="ticker-wrap">
      <div className="ticker-track">
        {[...items, ...items].map((m, i) => (
          <TickerItem key={`${m.symbol}-${i}`} m={m} onSelectSymbol={onSelectSymbol} />
        ))}
      </div>
    </div>
  );
}
