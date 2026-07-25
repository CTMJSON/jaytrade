import { formatCurrency, formatNumber } from '../format';

export default function TradeHistory({ trades }) {
  if (!trades || trades.length === 0) {
    return (
      <div className="panel history-panel">
        <h3>Trade History</h3>
        <p className="empty-hint">No trades yet.</p>
      </div>
    );
  }

  return (
    <div className="panel history-panel">
      <h3>Trade History</h3>
      <table className="history-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id}>
              <td>{new Date(`${t.created_at}Z`).toLocaleString()}</td>
              <td className="symbol-cell">{t.symbol}</td>
              <td className={t.side === 'BUY' ? 'positive' : 'negative'}>{t.side}</td>
              <td>{formatNumber(t.quantity, 0)}</td>
              <td>{formatCurrency(t.price)}</td>
              <td>{formatCurrency(t.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
