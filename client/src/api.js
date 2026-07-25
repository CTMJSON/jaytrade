const BASE = '/api';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export const api = {
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),
  quote: (symbol) => request(`/quote/${encodeURIComponent(symbol)}`),
  portfolio: () => request('/portfolio'),
  trades: () => request('/trades'),
  trade: (symbol, side, quantity) =>
    request('/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, side, quantity }),
    }),
  reset: () => request('/reset', { method: 'POST' }),
  movers: () => request('/movers'),
  indices: () => request('/indices'),
  recommendation: (symbol) => request(`/recommendation/${encodeURIComponent(symbol)}`),
  orders: () => request('/orders'),
  createOrder: (order) =>
    request('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(order),
    }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST' }),
  history: (symbol, range = '5d', interval = '15m') =>
    request(`/history/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`),
  portfolioSignals: () => request('/portfolio/signals'),
};
