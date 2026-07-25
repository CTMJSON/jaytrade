export function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatNumber(value, decimals = 2) {
  if (value == null || Number.isNaN(value)) return '--';
  return value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}
