import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatAge, formatCurrency, formatPercent } from '../format';
import { PanelError, SkeletonRows } from './Skeleton';
import { useLiveQuote, mergeLiveQuote } from '../store/useLiveQuote';

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

function MoverRow({ r, onSelectSymbol }) {
  const live = useLiveQuote(r.symbol);
  const row = mergeLiveQuote(r, live);
  return (
    <tr
      className="clickable-row"
      tabIndex={0}
      role="button"
      aria-label={`Open ${row.symbol} details and trade ticket`}
      onClick={() => onSelectSymbol?.(row.symbol)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelectSymbol?.(row.symbol);
        }
      }}
    >
      <td className="symbol-cell">{row.symbol}</td>
      <td>
        {formatCurrency(row.current)}
        {row.asOf && (
          <span className="asof-hint" title={`Price as of ${formatAge(row.asOf)}${row.source === 'ws' ? ' (live)' : ''}`}>
            {' '}
            · {row.source === 'ws' ? 'live' : formatAge(row.asOf)}
          </span>
        )}
      </td>
      <td className={row.percentChange >= 0 ? 'positive' : 'negative'}>{formatPercent(row.percentChange)}</td>
      <td title={row.volumeAsOf ? `Volume as of ${formatAge(row.volumeAsOf)}` : undefined}>
        {formatVolume(row.volume)}
      </td>
      <td>{row.relativeVolume != null ? `${row.relativeVolume.toFixed(2)}x` : '—'}</td>
      <td>{formatCompact(row.floatShares)}</td>
      <td>{formatCompact(row.marketCap)}</td>
    </tr>
  );
}

function MoversTable({ title, rows, loading, onSelectSymbol }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows]);

  if (loading) {
    return (
      <div className="panel movers-table-panel">
        <div className="movers-table-header">
          <h3>{title}</h3>
        </div>
        <SkeletonRows rows={8} height={18} gap={10} />
      </div>
    );
  }

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
              <th><abbr title="Trading volume today">Vol</abbr></th>
              <th><abbr title="Relative Volume: today's volume vs. the average. 2x means twice the usual trading activity.">RVol</abbr></th>
              <th><abbr title="Float: shares available for public trading (excludes insider lockups)">Float</abbr></th>
              <th><abbr title="Market Cap: total company value = share price × total shares">MCap</abbr></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <MoverRow key={r.symbol} r={r} onSelectSymbol={onSelectSymbol} />
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
  const [movers, setMovers] = useState(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // Guards against an overlapping request (e.g. the 60s tick fires again before a slow prior
  // request resolves) applying an older response after a newer one already landed.
  const requestId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    function load() {
      const id = ++requestId.current;
      api
        .movers()
        .then((data) => {
          if (cancelled || id !== requestId.current) return;
          setMovers(data);
          setError('');
        })
        .catch((err) => {
          if (cancelled || id !== requestId.current) return;
          setError(err.message);
        });
    }
    load();
    const interval = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [reloadKey]);

  if (error && !movers) {
    return (
      <div>
        <h3 className="subsection-title">Active Stocks</h3>
        <div className="panel">
          <PanelError message={error} onRetry={() => setReloadKey((k) => k + 1)} />
        </div>
      </div>
    );
  }

  const loading = !movers;
  const staleCount = movers?.stale?.length || 0;

  return (
    <div>
      <h3 className="subsection-title">
        Active Stocks
        {movers?.asOf && <span className="asof-hint"> · updated {formatAge(movers.asOf)}</span>}
      </h3>
      {movers?.degraded && (
        <div className="banner warning">
          Live data lookup is degraded right now - showing the last good snapshot instead of a partial refresh.
        </div>
      )}
      {!movers?.degraded && staleCount > 0 && (
        <div className="banner warning">
          {staleCount} symbol{staleCount === 1 ? '' : 's'} couldn't be refreshed this cycle and {staleCount === 1 ? 'is' : 'are'} temporarily excluded: {movers.stale.join(', ')}
        </div>
      )}
      <div className="active-stocks-grid">
        <MoversTable
          title="Biggest Gainers"
          rows={movers?.gainers || []}
          loading={loading}
          onSelectSymbol={onSelectSymbol}
        />
        <MoversTable
          title="Biggest Losers"
          rows={movers?.losers || []}
          loading={loading}
          onSelectSymbol={onSelectSymbol}
        />
      </div>
    </div>
  );
}
