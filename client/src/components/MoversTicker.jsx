import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';

export default function MoversTicker({ onSelectSymbol }) {
  const [movers, setMovers] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.movers();
        if (!cancelled) setMovers(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
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
        {[...items, ...items].map((m, i) => {
          const isGain = m.change >= 0;
          return (
            <button
              key={`${m.symbol}-${i}`}
              className={`ticker-item ${isGain ? 'positive' : 'negative'}`}
              onClick={() => onSelectSymbol(m.symbol)}
            >
              <span className="ticker-symbol">{m.symbol}</span>
              <span>{formatCurrency(m.current)}</span>
              <span>
                <span className="delta-arrow" aria-hidden="true">{isGain ? '▲' : '▼'}</span>
                {formatPercent(m.percentChange)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
