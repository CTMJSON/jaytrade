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
