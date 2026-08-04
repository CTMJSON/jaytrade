import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatNumber } from '../format';

const ROLE_LABELS = {
  STOP_LOSS: 'Stop-Loss',
  TRIM_TARGET: 'Trim Target',
  DIP_BUY: 'Dip-Buy',
  BREAKOUT_BUY: 'Breakout-Buy',
};

const emptyForm = {
  symbol: '',
  side: 'BUY',
  condition: 'DROPS_BELOW',
  triggerPrice: '',
  amountUsd: '',
  quantity: '',
};

export default function OrdersPanel({ defaultSymbol }) {
  const [orders, setOrders] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => api.orders().then(setOrders).catch((err) => setError(err.message));

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (defaultSymbol) setForm((f) => ({ ...f, symbol: defaultSymbol }));
  }, [defaultSymbol]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = {
        symbol: form.symbol.toUpperCase().trim(),
        side: form.side,
        condition: form.condition,
        triggerPrice: Number(form.triggerPrice),
      };
      if (form.side === 'BUY') {
        payload.amountUsd = Number(form.amountUsd);
      } else if (form.quantity) {
        payload.quantity = Number(form.quantity);
      }
      await api.createOrder(payload);
      setForm({ ...emptyForm, symbol: form.symbol });
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id) {
    await api.cancelOrder(id);
    refresh();
  }

  const activeOrders = orders.filter((o) => o.status === 'ACTIVE');
  const pastOrders = orders.filter((o) => o.status !== 'ACTIVE');

  return (
    <div className="panel orders-panel">
      <h3>Automated Buy/Sell Triggers</h3>
      <form className="order-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Symbol"
          value={form.symbol}
          onChange={(e) => setForm({ ...form, symbol: e.target.value })}
          required
        />
        <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
          <option value="BUY">Buy</option>
          <option value="SELL">Sell</option>
        </select>
        <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
          <option value="DROPS_BELOW">when price drops below</option>
          <option value="RISES_ABOVE">when price rises above</option>
        </select>
        <input
          type="number"
          step="0.01"
          placeholder="Trigger price ($)"
          value={form.triggerPrice}
          onChange={(e) => setForm({ ...form, triggerPrice: e.target.value })}
          required
        />
        {form.side === 'BUY' ? (
          <input
            type="number"
            step="0.01"
            placeholder="Spend up to ($)"
            value={form.amountUsd}
            onChange={(e) => setForm({ ...form, amountUsd: e.target.value })}
            required
          />
        ) : (
          <input
            type="number"
            step="1"
            placeholder="Shares (blank = all)"
            value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: e.target.value })}
          />
        )}
        <button type="submit" disabled={busy}>Create Trigger</button>
      </form>
      {error && <p className="error-text">{error}</p>}

      {activeOrders.length > 0 && (
        <>
          <h4>Active</h4>
          <table className="orders-table">
            <tbody>
              {activeOrders.map((o) => (
                <tr key={o.id}>
                  <td className="symbol-cell">{o.symbol}</td>
                  <td>
                    {o.role && o.role !== 'MANUAL' ? (
                      <span className="auto-trigger-badge">{ROLE_LABELS[o.role] || o.role}</span>
                    ) : (
                      <span className="manual-trigger-label">Manual</span>
                    )}
                  </td>
                  <td className={o.side === 'BUY' ? 'positive' : 'negative'}>{o.side}</td>
                  <td>
                    {o.condition === 'DROPS_BELOW' ? 'drops below' : 'rises above'} {formatCurrency(o.trigger_price)}
                    {!o.armed && <span className="unarmed-note"> (arms after trim)</span>}
                  </td>
                  <td>{o.side === 'BUY' ? `up to ${formatCurrency(o.amount_usd)}` : (o.quantity ? `${formatNumber(o.quantity, 0)} sh` : 'all shares')}</td>
                  <td><button className="cancel-button" onClick={() => handleCancel(o.id)}>Cancel</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {pastOrders.length > 0 && (
        <>
          <h4>History</h4>
          <table className="orders-table">
            <tbody>
              {pastOrders.map((o) => (
                <tr key={o.id}>
                  <td className="symbol-cell">{o.symbol}</td>
                  <td>
                    {o.role && o.role !== 'MANUAL' ? (
                      <span className="auto-trigger-badge">{ROLE_LABELS[o.role] || o.role}</span>
                    ) : (
                      <span className="manual-trigger-label">Manual</span>
                    )}
                  </td>
                  <td className={o.side === 'BUY' ? 'positive' : 'negative'}>{o.side}</td>
                  <td>{o.status}</td>
                  <td>{o.note || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {orders.length === 0 && <p className="empty-hint">No triggers set up yet.</p>}
    </div>
  );
}
