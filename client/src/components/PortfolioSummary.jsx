import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';
import { SkeletonCards } from './Skeleton';

const STARTER_IDEAS = ['AAPL', 'MSFT', 'NVDA', 'SPY'];

const ALLOCATION_COLORS = ['#004080', '#00c853', '#0077cc', '#66bb6a', '#f0a500', '#8e6fce', '#e57373', '#26a69a'];
const CONCENTRATION_THRESHOLD = 25;
const CASH_DRAG_THRESHOLD = 50;

function pctClass(value) {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
}

// Colour alone can't carry gain/loss meaning — add a shape cue.
function Delta({ value }) {
  if (!value) return null;
  return (
    <span className="delta-arrow" aria-hidden="true">
      {value > 0 ? '▲' : '▼'}
    </span>
  );
}

function useOrders(refreshKey) {
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    let cancelled = false;
    api.orders().then((data) => !cancelled && setOrders(data)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return orders;
}

function useSignals(refreshKey) {
  const [signals, setSignals] = useState([]);
  useEffect(() => {
    if (!refreshKey) {
      setSignals([]);
      return;
    }
    let cancelled = false;
    api.portfolioSignals().then((data) => !cancelled && setSignals(data)).catch(() => {});
    const interval = setInterval(() => {
      api.portfolioSignals().then((data) => !cancelled && setSignals(data)).catch(() => {});
    }, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshKey]);
  return signals;
}

const ACTION_LABELS = {
  ADD: 'Consider Adding',
  HOLD: 'Hold',
  TRIM: 'Consider Trimming',
  REVIEW: 'Review Position',
};

const ACTION_CLASS = {
  ADD: 'ps-action-add',
  HOLD: 'ps-action-hold',
  TRIM: 'ps-action-trim',
  REVIEW: 'ps-action-review',
};

const RECOMMENDATION_CONCURRENCY = 3;

function useRecommendations(symbols) {
  const [recs, setRecs] = useState({});
  useEffect(() => {
    let cancelled = false;
    const pending = symbols.filter((symbol) => recs[symbol] === undefined);
    // A portfolio with a dozen holdings firing a dozen simultaneous recommendation
    // requests (times every logged-in account) is what pushed Finnhub past its 60/min
    // limit and surfaced as 502s. A small concurrency cap smooths that burst out.
    let next = 0;
    async function worker() {
      while (!cancelled && next < pending.length) {
        const symbol = pending[next++];
        try {
          const data = await api.recommendation(symbol);
          if (!cancelled) setRecs((prev) => ({ ...prev, [symbol]: data }));
        } catch {
          if (!cancelled) setRecs((prev) => ({ ...prev, [symbol]: null }));
        }
      }
    }
    Array.from({ length: Math.min(RECOMMENDATION_CONCURRENCY, pending.length) }, worker);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')]);
  return recs;
}

export default function PortfolioSummary({ portfolio, onSelectSymbol }) {
  const symbols = (portfolio?.holdings || []).map((h) => h.symbol);
  const orders = useOrders(symbols.join(','));
  const recs = useRecommendations(symbols);
  const signals = useSignals(symbols.join(','));

  if (!portfolio) {
    return (
      <div className="panel portfolio-summary-panel">
        <h3>Portfolio Summary</h3>
        <SkeletonCards count={6} />
      </div>
    );
  }

  // Previously this returned null, so a brand-new account saw no personalized
  // content at all. Now it's the onboarding moment instead.
  if (portfolio.holdings.length === 0) {
    return (
      <div className="panel portfolio-summary-panel ps-empty">
        <h3>Welcome to JayTrade</h3>
        <p className="ps-empty-lead">
          You have <strong>{formatCurrency(portfolio.cash)}</strong> in simulated cash. Nothing is
          real, nothing is at risk — buy something and see what happens.
        </p>
        <ol className="ps-empty-steps">
          <li>Search for a company using the bar above.</li>
          <li>Review the price, chart, and analyst consensus.</li>
          <li>Place a buy — your position and P/L show up right here.</li>
        </ol>
        <div className="ps-empty-ideas">
          <span className="ps-allocation-label">Popular starting points</span>
          <div className="ps-empty-chips">
            {STARTER_IDEAS.map((symbol) => (
              <button key={symbol} className="ps-empty-chip" onClick={() => onSelectSymbol?.(symbol)}>
                {symbol}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const { holdings, totalValue, totalPL, totalPLPercent, dayChange, dayChangePercent, realizedPL, unrealizedPL } = portfolio;

  const activeStopLossSymbols = new Set(
    orders.filter((o) => o.status === 'ACTIVE' && o.side === 'SELL').map((o) => o.symbol)
  );
  const unprotected = holdings.filter((h) => !activeStopLossSymbols.has(h.symbol));

  const bearishHoldings = holdings.filter((h) => {
    const rec = recs[h.symbol];
    if (!rec) return false;
    const bullish = rec.strongBuy + rec.buy;
    const bearish = rec.sell + rec.strongSell;
    return bearish > bullish;
  });

  const insights = [];
  if (portfolio.largestPosition && portfolio.largestPosition.allocationPercent >= CONCENTRATION_THRESHOLD) {
    insights.push({
      tone: 'warn',
      text: `${portfolio.largestPosition.symbol} makes up ${portfolio.largestPosition.allocationPercent.toFixed(1)}% of the portfolio — concentration risk if it moves against you.`,
    });
  }
  if (portfolio.cashAllocationPercent >= CASH_DRAG_THRESHOLD) {
    insights.push({
      tone: 'info',
      text: `${portfolio.cashAllocationPercent.toFixed(1)}% of the portfolio is sitting in cash, uninvested.`,
    });
  }
  if (unprotected.length > 0) {
    insights.push({
      tone: 'warn',
      text: `${unprotected.length} of ${holdings.length} position${holdings.length === 1 ? '' : 's'} have no active sell/stop-loss trigger set: ${unprotected.map((h) => h.symbol).join(', ')}.`,
    });
  }
  if (bearishHoldings.length > 0) {
    insights.push({
      tone: 'warn',
      text: `Analysts lean bearish on ${bearishHoldings.map((h) => h.symbol).join(', ')}.`,
    });
  }
  if (Math.abs(realizedPL) > 0.01) {
    insights.push({
      tone: 'info',
      text: `Of the total ${formatCurrency(totalPL)} P/L, ${formatCurrency(realizedPL)} is realized (locked in) and ${formatCurrency(unrealizedPL)} is still unrealized.`,
    });
  }

  const allocationSegments = [...holdings]
    .sort((a, b) => b.allocationPercent - a.allocationPercent)
    .map((h, i) => ({ ...h, color: ALLOCATION_COLORS[i % ALLOCATION_COLORS.length] }));
  const cashPercent = portfolio.cashAllocationPercent;

  return (
    <div className="panel portfolio-summary-panel">
      <h3>Portfolio Summary</h3>

      <div className="ps-stat-grid">
        <div className="ps-stat">
          <span className="ps-stat-label">Total Value</span>
          <span className="ps-stat-value">{formatCurrency(totalValue)}</span>
        </div>
        <div className="ps-stat">
          <span className="ps-stat-label">Today</span>
          <span className={`ps-stat-value ${pctClass(dayChange)}`}>
            <Delta value={dayChange} />
            {formatCurrency(dayChange)} ({formatPercent(dayChangePercent)})
          </span>
        </div>
        <div className="ps-stat">
          <span className="ps-stat-label">Total P/L (all-time)</span>
          <span className={`ps-stat-value ${pctClass(totalPL)}`}>
            <Delta value={totalPL} />
            {formatCurrency(totalPL)} ({formatPercent(totalPLPercent)})
          </span>
        </div>
        <div className="ps-stat">
          <span className="ps-stat-label">Cash</span>
          <span className="ps-stat-value">{formatCurrency(portfolio.cash)}</span>
        </div>
        <div className="ps-stat">
          <span className="ps-stat-label">Invested</span>
          <span className="ps-stat-value">{formatCurrency(portfolio.holdingsValue)}</span>
        </div>
        <div className="ps-stat">
          <span className="ps-stat-label">Win / Loss</span>
          <span className="ps-stat-value">
            <span className="positive">{portfolio.winCount}W</span> / <span className="negative">{portfolio.lossCount}L</span>
          </span>
        </div>
      </div>

      <div className="ps-highlight-row">
        {portfolio.dayBestPerformer && (
          <div className="ps-highlight">
            <span className="ps-highlight-label">Today's Best</span>
            <button className="ps-highlight-symbol" onClick={() => onSelectSymbol?.(portfolio.dayBestPerformer.symbol)}>
              {portfolio.dayBestPerformer.symbol}
            </button>
            <span className="positive">{formatPercent(portfolio.dayBestPerformer.dayChangePercent)}</span>
          </div>
        )}
        {portfolio.dayWorstPerformer && (
          <div className="ps-highlight">
            <span className="ps-highlight-label">Today's Worst</span>
            <button className="ps-highlight-symbol" onClick={() => onSelectSymbol?.(portfolio.dayWorstPerformer.symbol)}>
              {portfolio.dayWorstPerformer.symbol}
            </button>
            <span className="negative">{formatPercent(portfolio.dayWorstPerformer.dayChangePercent)}</span>
          </div>
        )}
        {portfolio.bestPerformer && (
          <div className="ps-highlight">
            <span className="ps-highlight-label">Best Since Purchase</span>
            <button className="ps-highlight-symbol" onClick={() => onSelectSymbol?.(portfolio.bestPerformer.symbol)}>
              {portfolio.bestPerformer.symbol}
            </button>
            <span className="positive">{formatPercent(portfolio.bestPerformer.unrealizedPLPercent)}</span>
          </div>
        )}
        {portfolio.worstPerformer && (
          <div className="ps-highlight">
            <span className="ps-highlight-label">Worst Since Purchase</span>
            <button className="ps-highlight-symbol" onClick={() => onSelectSymbol?.(portfolio.worstPerformer.symbol)}>
              {portfolio.worstPerformer.symbol}
            </button>
            <span className="negative">{formatPercent(portfolio.worstPerformer.unrealizedPLPercent)}</span>
          </div>
        )}
      </div>

      <div className="ps-allocation">
        <span className="ps-allocation-label">Allocation</span>
        <div className="ps-allocation-bar">
          {allocationSegments.map((h) => (
            <div
              key={h.symbol}
              className="ps-allocation-segment"
              style={{ width: `${h.allocationPercent}%`, background: h.color }}
              title={`${h.symbol}: ${h.allocationPercent.toFixed(1)}%`}
            />
          ))}
          <div className="ps-allocation-segment ps-allocation-cash" style={{ width: `${cashPercent}%` }} title={`Cash: ${cashPercent.toFixed(1)}%`} />
        </div>
        <div className="ps-allocation-legend">
          {allocationSegments.map((h) => (
            <span key={h.symbol} className="ps-legend-item">
              <span className="ps-legend-dot" style={{ background: h.color }} />
              {h.symbol} {h.allocationPercent.toFixed(1)}%
            </span>
          ))}
          <span className="ps-legend-item">
            <span className="ps-legend-dot ps-legend-cash" />
            Cash {cashPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="ps-insights">
          <span className="ps-allocation-label">Things to Know</span>
          <ul>
            {insights.map((insight, i) => (
              <li key={i} className={`ps-insight ps-insight-${insight.tone}`}>
                {insight.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {signals.length > 0 && (
        <div className="ps-signals">
          <span className="ps-allocation-label">
            Suggested Actions
            <span className="ps-signals-disclaimer"> — simulated signal for this app, not real investment advice</span>
          </span>
          <div className="ps-signals-list">
            {signals.map((s) => (
              <div key={s.symbol} className="ps-signal-row">
                <button className="ps-highlight-symbol" onClick={() => onSelectSymbol?.(s.symbol)}>
                  {s.symbol}
                </button>
                <span className={`ps-action-badge ${ACTION_CLASS[s.action] || ''}`}>
                  {ACTION_LABELS[s.action] || s.action}
                </span>
                <span className="ps-signal-reasons">{s.reasons.join(' · ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
