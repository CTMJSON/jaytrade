import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';

const PAGE_SIZE = 15;

function formatCompact(value) {
  if (value == null) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}B`;
  return `${value.toFixed(2)}M`;
}

function formatVolume(value) {
  if (value == null) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function MoversTable({ title, rows, onSelectSymbol }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="panel movers-table-panel">
      <div className="movers-table-header">
        <h3>{title}</h3>
      </div>
      <div className="movers-table-scroll">
        <table className="movers-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Price</th>
              <th>Change</th>
              <th>Vol</th>
              <th>RVol</th>
              <th>Float</th>
              <th>MCap</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.symbol} className="clickable-row" onClick={() => onSelectSymbol?.(r.symbol)}>
                <td className="symbol-cell">{r.symbol}</td>
                <td>{formatCurrency(r.current)}</td>
                <td className={r.percentChange >= 0 ? 'positive' : 'negative'}>{formatPercent(r.percentChange)}</td>
                <td>{formatVolume(r.volume)}</td>
                <td>{r.relativeVolume != null ? `${r.relativeVolume.toFixed(2)}x` : '—'}</td>
                <td>{formatCompact(r.floatShares)}</td>
                <td>{formatCompact(r.marketCap)}</td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={7} className="empty-hint">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span className="pagination-hint">
          {rows.length === 0
            ? 'Showing 0 entries'
            : `Showing ${page * PAGE_SIZE + 1} to ${Math.min(rows.length, (page + 1) * PAGE_SIZE)} of ${rows.length} entries`}
        </span>
        <div className="pagination-buttons">
          <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
          {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
            <button key={i} className={i === page ? 'active' : ''} onClick={() => setPage(i)}>{i + 1}</button>
          ))}
          <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>Next</button>
        </div>
      </div>
    </div>
  );
}

export default function ActiveStocks({ onSelectSymbol }) {
  const [movers, setMovers] = useState({ gainers: [], losers: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    function load() {
      api.movers().then((data) => !cancelled && setMovers(data)).catch((err) => !cancelled && setError(err.message));
    }
    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) return null;

  return (
    <div>
      <h3 className="section-title">Active Stocks</h3>
      <div className="active-stocks-grid">
        <MoversTable title="Biggest Gainers" rows={movers.gainers} onSelectSymbol={onSelectSymbol} />
        <MoversTable title="Biggest Losers" rows={movers.losers} onSelectSymbol={onSelectSymbol} />
      </div>
    </div>
  );
}
