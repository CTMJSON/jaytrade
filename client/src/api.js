const BASE = '/api';
const TOKEN_KEY = 'jaytrade_token';
const NAME_KEY = 'jaytrade_name';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAccountName() {
  return localStorage.getItem(NAME_KEY);
}

function setSession(token, name) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, name);
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new Event('jaytrade:unauthorized'));
  }
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
  portfolioHistory: (range = '3mo') => request(`/portfolio/history?range=${encodeURIComponent(range)}`),
  stats: (symbol) => request(`/stats/${encodeURIComponent(symbol)}`),
};

export const auth = {
  isLoggedIn: () => !!getToken(),
  accountName: getAccountName,
  register: async (name, pin) => {
    const data = await request('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin }),
    });
    setSession(data.token, data.name);
    return data;
  },
  login: async (name, pin) => {
    const data = await request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin }),
    });
    setSession(data.token, data.name);
    return data;
  },
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // ignore - clear local session regardless
    }
    clearSession();
  },
};
