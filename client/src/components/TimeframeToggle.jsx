export const CHART_TIMEFRAMES = [
  { key: '1D', range: '1d', interval: '5m' },
  { key: '1W', range: '5d', interval: '15m' },
  { key: '1M', range: '1mo', interval: '60m' },
  { key: '3M', range: '3mo', interval: '1d' },
  { key: '1Y', range: '1y', interval: '1d' },
];

export const EQUITY_TIMEFRAMES = [
  { key: '1W', range: '1w' },
  { key: '1M', range: '1mo' },
  { key: '3M', range: '3mo' },
  { key: '1Y', range: '1y' },
  { key: 'ALL', range: 'all' },
];

export default function TimeframeToggle({ options, value, onChange, label = 'Time range' }) {
  return (
    <div className="timeframe-toggle" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={option.key === value ? 'timeframe-option active' : 'timeframe-option'}
          aria-pressed={option.key === value}
          onClick={() => onChange(option)}
        >
          {option.key}
        </button>
      ))}
    </div>
  );
}
