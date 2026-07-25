import { formatCurrency, formatPercent, formatNumber } from '../format';

export default function Portfolio({ portfolio, onSelectSymbol }) {
  if (!portfolio) return null;

  const totalPLClass = portfolio.totalPL > 0 ? 'positive' : portfolio.totalPL < 0 ? 'negative' : '';

  return (
    <div className="panel portfolio-panel">
      <div className="summary-cards">
        <div className="summary-card">
          <span className="summary-label">Cash</span>
          <span className="summary-value">{formatCurrency(portfolio.cash)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Holdings Value</span>
          <span className="summary-value">{formatCurrency(portfolio.holdingsValue)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total Value</span>
          <span className="summary-value">{formatCurrency(portfolio.totalValue)}</span>
        </div>
        <div className="summary-card">
          <span className="summary-label">Total P/L</span>
          <span className={`summary-value ${totalPLClass}`}>
            {formatCurrency(portfolio.totalPL)} ({formatPercent(portfolio.totalPLPercent)})
          </span>
        </div>
      </div>

      <h3>Holdings</h3>
      {portfolio.holdings.length === 0 ? (
        <p className="empty-hint">No positions yet. Search for a stock to make your first trade.</p>
      ) : (
        <table className="holdings-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Qty</th>
              <th>Bought → Now</th>
              <th>Market Value</th>
              <th>P/L</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((h) => {
              const plClass = h.unrealizedPL > 0 ? 'positive' : h.unrealizedPL < 0 ? 'negative' : '';
              const barPercent = Math.min(100, Math.abs(h.unrealizedPLPercent) * 4);
              return (
                <tr key={h.symbol} onClick={() => onSelectSymbol(h.symbol)} className="clickable-row">
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
