export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatNumber(value, decimals = 2) {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// SQLite's datetime('now') stores "YYYY-MM-DD HH:MM:SS" in UTC with no timezone marker, so a
// plain `new Date(str)` would get parsed as local time by the browser - append the 'Z' explicitly
// before converting to the account's Eastern display time.
export function formatDateTime(sqliteUtcString) {
  if (!sqliteUtcString) return '--';
  const date = new Date(sqliteUtcString.replace(' ', 'T') + 'Z');
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }) + ' ET';
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

// Renders an `asOf`/`updatedAt` epoch-ms timestamp (as now threaded through /api/movers,
// /api/quote, /api/indices, /api/history) as a short relative age, so mixed-freshness fields
// (e.g. a 15s-fresh price next to a 3min-old volume figure) read as honestly-labeled instead of
// implying everything on the page is one current instant.
export function formatAge(asOfMs) {
  if (!asOfMs) return null;
  const seconds = Math.max(0, Math.round((Date.now() - asOfMs) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}
