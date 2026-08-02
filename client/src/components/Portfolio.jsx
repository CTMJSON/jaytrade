import { formatCurrency, formatPercent, formatNumber } from '../format';
import { SkeletonRows } from './Skeleton';

function DeltaArrow({ value }) {
  if (!value) return null;
  return (
    <span className="delta-arrow" aria-hidden="true">
      {value > 0 ? '▲' : '▼'}
    </span>
  );
}

export default function Portfolio({ portfolio, onSelectSymbol }) {
  if (!portfolio) {
    return (
      <div className="panel portfolio-panel">
        <h3>Holdings</h3>
        <SkeletonRows rows={4} height={20} />
      </div>
    );
  }

  // Summary numbers now live solely in PortfolioSummary — showing Total Value
  // and Total P/L in two places on one page made them read as different metrics.
  return (
    <div className="panel portfolio-panel">
      <h3>Holdings</h3>
      {portfolio.holdings.length === 0 ? (
        <p className="empty-hint">No positions yet. Search above to make your first trade.</p>
      ) : (
        <table className="holdings-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Qty</th>
              <th scope="col">Bought → Now</th>
              <th scope="col">Market Value</th>
              <th scope="col">P/L</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((h) => {
              const plClass = h.unrealizedPL > 0 ? 'positive' : h.unrealizedPL < 0 ? 'negative' : '';
              const barPercent = Math.min(100, Math.abs(h.unrealizedPLPercent) * 4);
              const open = () => onSelectSymbol(h.symbol);
              return (
                <tr
                  key={h.symbol}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  }}
                  className="clickable-row"
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${h.symbol} details and trade ticket`}
                >
                  <td className="symbol-cell">{h.symbol}</td>
                  <td>{formatNumber(h.quantity, 0)}</td>
                  <td>
                    <div className="cost-compare">
                      <span className="cost-compare-bought">{formatCurrency(h.avgCost)}</span>
                      <span className="cost-compare-arrow">→</span>
                      <span className={plClass}>{formatCurrency(h.currentPrice)}</span>
                    </div>
                    <div className="cost-compare-bar">
                      <div className={`cost-compare-fill ${plClass}`} style={{ width: `${barPercent}%` }} />
                    </div>
                  </td>
                  <td>{formatCurrency(h.marketValue)}</td>
                  <td className={plClass}>
                    <DeltaArrow value={h.unrealizedPL} />
                    {formatCurrency(h.unrealizedPL)} ({formatPercent(h.unrealizedPLPercent)})
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
