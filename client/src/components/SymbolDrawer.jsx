import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, ComposedChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { api } from '../api';
import { formatCurrency, formatNumber, formatPercent } from '../format';
import RecommendationBadge from './RecommendationBadge';
import { PanelError, Skeleton } from './Skeleton';
import { useToast } from './Toast';
import TimeframeToggle, { CHART_TIMEFRAMES } from './TimeframeToggle';
import RangeBar from './RangeBar';
import { useFlash } from '../useFlash';

const GREEN = '#00e676';
const RED = '#ff3b5c';
const QUICK_SIZES = [0.25, 0.5, 1];
const DEFAULT_TIMEFRAME = CHART_TIMEFRAMES[1]; // 1W

export default function SymbolDrawer({ symbol, open, onClose, portfolio, onTradeComplete }) {
  const [quote, setQuote] = useState(null);
  const [chart, setChart] = useState(null);
  const [quantity, setQuantity] = useState('1');
  const [pending, setPending] = useState(null); // { side, quantity, total }
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [timeframe, setTimeframe] = useState(DEFAULT_TIMEFRAME);
  const [range52, setRange52] = useState(null);
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  const toast = useToast();
  const priceFlash = useFlash(quote?.current);

  const holding = useMemo(
    () => portfolio?.holdings?.find((h) => h.symbol === symbol) || null,
    [portfolio, symbol]
  );

  // Reset per-symbol state whenever the drawer targets a new ticker.
  useEffect(() => {
    setQuote(null);
    setChart(null);
    setQuantity('1');
    setPending(null);
    setError('');
    setLoadError('');
    setRange52(null);
    setTimeframe(DEFAULT_TIMEFRAME);
  }, [symbol]);

  // Quote, polled while open.
  useEffect(() => {
    if (!open || !symbol) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await api.quote(symbol);
        if (!cancelled) {
          setQuote(data);
          setLoadError('');
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      }
    }

    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [open, symbol, reloadKey]);

  // Context chart at the selected timeframe.
  useEffect(() => {
    if (!open || !symbol) return;
    let cancelled = false;
    setChart(null);
    api
      .history(symbol, timeframe.range, timeframe.interval)
      .then((data) => !cancelled && setChart(data))
      .catch(() => !cancelled && setChart({ points: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, symbol, reloadKey, timeframe.range, timeframe.interval]);

  // 52-week range. Optional context — a failure here must not disturb the trade ticket.
  useEffect(() => {
    if (!open || !symbol) return;
    let cancelled = false;
    api
      .stats(symbol)
      .then((data) => !cancelled && setRange52(data))
      .catch(() => !cancelled && setRange52(null));
    return () => {
      cancelled = true;
    };
  }, [open, symbol, reloadKey]);

  // Escape to close, focus management, and background scroll lock.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => closeRef.current?.focus(), 50);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open || !symbol) return null;

  const cash = portfolio?.cash ?? 0;
  const qtyNumber = Number(quantity) || 0;
  const estimatedTotal = quote ? quote.current * qtyNumber : 0;
  const exceedsCash = estimatedTotal > cash;
  const ownedShares = holding?.quantity ?? 0;
  const exceedsShares = qtyNumber > ownedShares;
  const changeClass = quote?.change > 0 ? 'positive' : quote?.change < 0 ? 'negative' : '';
  const maxAffordable = quote?.current ? Math.floor(cash / quote.current) : 0;

  const chartPoints = chart?.points || [];
  const chartUp = chartPoints.length
    ? (chart.currentPrice ?? chartPoints[chartPoints.length - 1].close) >= chartPoints[0].close
    : true;
  const chartColor = chartUp ? GREEN : RED;

  function requestTrade(side) {
    setError('');
    if (qtyNumber <= 0) {
      setError('Enter a quantity of at least 1 share.');
      return;
    }
    if (side === 'BUY' && exceedsCash) {
      setError(`That costs ${formatCurrency(estimatedTotal)} but you only have ${formatCurrency(cash)}.`);
      return;
    }
    if (side === 'SELL' && exceedsShares) {
      setError(
        ownedShares === 0
          ? `You don't own any ${symbol}.`
          : `You only own ${formatNumber(ownedShares, 0)} share${ownedShares === 1 ? '' : 's'} of ${symbol}.`
      );
      return;
    }
    setPending({ side, quantity: qtyNumber, total: estimatedTotal });
  }

  async function confirmTrade() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.trade(symbol, pending.side, pending.quantity);
      const fillPrice = result?.price ?? quote?.current;
      const filledTotal = result?.total ?? pending.total;
      toast({
        tone: 'success',
        title: `${pending.side === 'BUY' ? 'Bought' : 'Sold'} ${formatNumber(pending.quantity, 0)} ${symbol}`,
        detail: `${formatCurrency(fillPrice)} per share · ${formatCurrency(filledTotal)} total`,
      });
      setPending(null);
      setQuantity('1');
      onTradeComplete?.();
      const updated = await api.quote(symbol);
      setQuote(updated);
    } catch (err) {
      setError(err.message);
      toast({ tone: 'error', title: 'Trade failed', detail: err.message });
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function setQuickSize(fraction) {
    if (fraction === 'position') {
      setQuantity(String(Math.floor(ownedShares)));
      return;
    }
    setQuantity(String(Math.max(1, Math.floor(maxAffordable * fraction))));
  }

  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`${symbol} details and trade ticket`}
        ref={panelRef}
      >
        <header className="drawer-header">
          <div className="drawer-heading">
            {quote?.logo && <img src={quote.logo} alt="" className="drawer-logo" />}
            <div className="drawer-titles">
              <span className="drawer-symbol">{symbol}</span>
              <span className="drawer-name">{quote?.name || <Skeleton width={140} height={12} />}</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} ref={closeRef} aria-label="Close panel">
            ×
          </button>
        </header>

        <div className="drawer-scroll">
          {loadError && !quote && (
            <PanelError message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
          )}

          <section className="drawer-price-block">
            {quote ? (
              <div className={`drawer-price-row ${changeClass}`}>
                <span className={`drawer-price ${priceFlash}`}>{formatCurrency(quote.current)}</span>
                <span className="drawer-change">
                  <span className="delta-arrow" aria-hidden="true">{quote.change >= 0 ? '▲' : '▼'}</span>
                  {quote.change >= 0 ? '+' : ''}
                  {quote.change?.toFixed(2)} ({formatPercent(quote.percentChange)})
                </span>
              </div>
            ) : (
              <Skeleton width={220} height={30} />
            )}
          </section>

          <section className="drawer-chart">
            <TimeframeToggle
              options={CHART_TIMEFRAMES}
              value={timeframe.key}
              onChange={setTimeframe}
              label="Chart time range"
            />

            {!chart && <Skeleton height={140} radius={8} />}

            {chart && chartPoints.length === 0 && (
              <p className="empty-hint drawer-chart-empty">No chart data for this range.</p>
            )}

            {chartPoints.length > 0 && (
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={chartPoints}>
                  <defs>
                    <linearGradient id="drawerFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={chartColor} stopOpacity={0.32} />
                      <stop offset="100%" stopColor={chartColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={['dataMin', 'dataMax']} hide />
                  <Tooltip
                    formatter={(value) => [formatCurrency(value), 'Price']}
                    labelFormatter={() => ''}
                    contentStyle={{
                      background: '#171d29',
                      border: '1px solid #313c50',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#e7eaf1',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="close"
                    stroke={chartColor}
                    strokeWidth={2}
                    fill="url(#drawerFill)"
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </section>

          {range52 && (
            <RangeBar
              low={range52.low}
              high={range52.high}
              current={quote?.current ?? range52.current}
              basis={range52.basis}
            />
          )}

          {quote && (
            <section className="drawer-stats">
              <div><span>Open</span>{formatCurrency(quote.open)}</div>
              <div><span>High</span>{formatCurrency(quote.high)}</div>
              <div><span>Low</span>{formatCurrency(quote.low)}</div>
              <div><span>Prev Close</span>{formatCurrency(quote.previousClose)}</div>
            </section>
          )}

          {holding && (
            <section className="drawer-position">
              <span className="drawer-section-label">Your position</span>
              <div className="drawer-position-grid">
                <div>
                  <span>Shares</span>
                  {formatNumber(holding.quantity, 0)}
                </div>
                <div>
                  <span>Avg cost</span>
                  {formatCurrency(holding.avgCost)}
                </div>
                <div>
                  <span>Market value</span>
                  {formatCurrency(holding.marketValue)}
                </div>
                <div className={holding.unrealizedPL > 0 ? 'positive' : holding.unrealizedPL < 0 ? 'negative' : ''}>
                  <span>Unrealized P/L</span>
                  {formatCurrency(holding.unrealizedPL)} ({formatPercent(holding.unrealizedPLPercent)})
                </div>
              </div>
            </section>
          )}

          <RecommendationBadge symbol={symbol} />

          <section className="drawer-ticket">
            <span className="drawer-section-label">Place a trade</span>

            <label className="drawer-qty-label">
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setPending(null);
                }}
                disabled={busy}
              />
            </label>

            <div className="drawer-quick-sizes">
              {QUICK_SIZES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setQuickSize(f)}
                  disabled={!quote || maxAffordable < 1}
                >
                  {f === 1 ? 'Max' : `${f * 100}%`}
                </button>
              ))}
              {ownedShares > 0 && (
                <button type="button" onClick={() => setQuickSize('position')}>
                  All {formatNumber(ownedShares, 0)} sh
                </button>
              )}
            </div>

            <div className={`drawer-estimate ${exceedsCash ? 'over-budget' : ''}`}>
              <span>Estimated total</span>
              <strong>{formatCurrency(estimatedTotal)}</strong>
            </div>
            <div className="drawer-cash-note">
              Available cash: {formatCurrency(cash)}
              {quote && maxAffordable > 0 && ` · up to ${formatNumber(maxAffordable, 0)} shares`}
            </div>

            {pending ? (
              <div className="drawer-confirm">
                <p className="drawer-confirm-text">
                  {pending.side === 'BUY' ? 'Buy' : 'Sell'} <strong>{formatNumber(pending.quantity, 0)}</strong>{' '}
                  {symbol} for about <strong>{formatCurrency(pending.total)}</strong>?
                  {pending.side === 'BUY' && (
                    <span className="drawer-confirm-after">
                      You&rsquo;ll have {formatCurrency(cash - pending.total)} left in cash.
                    </span>
                  )}
                </p>
                <div className="drawer-confirm-buttons">
                  <button className="drawer-cancel" onClick={() => setPending(null)} disabled={busy}>
                    Cancel
                  </button>
                  <button
                    className={pending.side === 'BUY' ? 'buy-button' : 'sell-button'}
                    onClick={confirmTrade}
                    disabled={busy}
                  >
                    {busy ? 'Placing…' : `Confirm ${pending.side === 'BUY' ? 'Buy' : 'Sell'}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="trade-buttons">
                <button
                  className="buy-button"
                  disabled={busy || !quote || qtyNumber <= 0}
                  onClick={() => requestTrade('BUY')}
                >
                  Buy
                </button>
                <button
                  className="sell-button"
                  disabled={busy || !quote || ownedShares === 0}
                  onClick={() => requestTrade('SELL')}
                  title={ownedShares === 0 ? `You don't own any ${symbol}` : undefined}
                >
                  Sell
                </button>
              </div>
            )}

            {error && <p className="error-text">{error}</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}
