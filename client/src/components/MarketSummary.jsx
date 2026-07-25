import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'NVDA', 'META', 'TSLA', 'GOOGL', 'AMD', 'SPY', 'QQQ'];
const SMA_WINDOW = 10;

function withMovingAverage(points) {
  return points.map((p, i) => {
    if (i < SMA_WINDOW - 1) return { ...p, sma: null };
    const window = points.slice(i - SMA_WINDOW + 1, i + 1);
    const avg = window.reduce((sum, w) => sum + w.close, 0) / window.length;
    return { ...p, sma: avg };
  });
}

function formatTick(time) {
  const d = new Date(time);
  const hh = d.getHours() % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

export default function MarketSummary({ onSelectSymbol }) {
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [quotes, setQuotes] = useState({});
  const [selected, setSelected] = useState('SPY');
  const [chart, setChart] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .movers()
      .then((data) => {
        const combined = [...data.gainers, ...data.losers];
        const bySymbol = {};
        combined.forEach((q) => { bySymbol[q.symbol] = q; });
        setQuotes(bySymbol);
        const top = combined
          .slice()
          .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
          .slice(0, 10)
          .map((q) => q.symbol);
        if (top.length) setSymbols(top);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError('');
    api
      .history(selected)
      .then((data) => {
        if (cancelled) return;
        setChart({ ...data, points: withMovingAverage(data.points) });
      })
      .catch((err) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const priceChange = useMemo(() => {
    if (!chart || !chart.points.length) return null;
    const first = chart.points[0].close;
    const last = chart.currentPrice ?? chart.points[chart.points.length - 1].close;
    return { last, percent: ((last - first) / first) * 100 };
  }, [chart]);

  function handleSearchSubmit(e) {
    e.preventDefault();
    const symbol = searchInput.trim().toUpperCase();
    if (!symbol) return;
    setSelected(symbol);
    setSearchInput('');
  }

  function handleSelect(symbol) {
    setSelected(symbol);
    onSelectSymbol?.(symbol);
  }

  const isGain = priceChange ? priceChange.percent >= 0 : true;

  return (
    <div className="panel market-summary">
      <h3>Market Summary</h3>
      <div className="market-summary-grid">
        <table className="symbol-list-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Price</th>
              <th>% Change</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => {
              const q = quotes[symbol];
              const gain = q ? q.percentChange >= 0 : true;
              return (
                <tr
                  key={symbol}
                  className={selected === symbol ? 'symbol-row selected' : 'symbol-row'}
                  onClick={() => handleSelect(symbol)}
                >
                  <td className="symbol-cell">{symbol}</td>
                  <td>{q ? formatCurrency(q.current) : '—'}</td>
                  <td className={gain ? 'positive' : 'negative'}>{q ? formatPercent(q.percentChange) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="chart-area">
          <div className="chart-header">
            <div className="chart-title">
              <span className="chart-symbol">{selected}</span>
              {priceChange && (
                <span className={isGain ? 'positive' : 'negative'}>
                  {formatCurrency(priceChange.last)} ({formatPercent(priceChange.percent)})
                </span>
              )}
            </div>
            <form onSubmit={handleSearchSubmit}>
              <input
                type="text"
                placeholder="Ticker & Press Enter…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </form>
          </div>

          {error && <p className="error-text">{error}</p>}

          {chart && (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chart.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis
                  dataKey="time"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={formatTick}
                  tick={{ fontSize: 11, fill: 'var(--accent-gray)' }}
                  minTickGap={60}
                />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--accent-gray)' }} width={60} />
                <Tooltip
                  labelFormatter={formatTick}
                  formatter={(value, name) => [formatCurrency(value), name === 'sma' ? `${SMA_WINDOW}-pt avg` : 'Price']}
                  contentStyle={{ background: '#fff', border: '1px solid var(--border-color)', fontSize: 12 }}
                />
                <Line type="monotone" dataKey="close" stroke={isGain ? '#00c853' : '#d32f2f'} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="sma" stroke="var(--accent-gray)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
