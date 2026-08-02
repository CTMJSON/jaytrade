import { formatCurrency } from '../format';

/**
 * 52-week position marker. `basis` distinguishes true intraday extremes from
 * close-derived ones so the label stays honest about what it's showing.
 */
export default function RangeBar({ low, high, current, basis }) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(current) || high <= low) {
    return null;
  }

  const clamped = Math.min(high, Math.max(low, current));
  const position = ((clamped - low) / (high - low)) * 100;
  const nearHigh = position >= 90;
  const nearLow = position <= 10;

  return (
    <section className="range-bar-block">
      <span className="drawer-section-label">
        52-week range
        {basis === 'close' && <span className="range-bar-basis"> · based on daily closes</span>}
      </span>

      <div className="range-bar-track">
        <div className="range-bar-fill" style={{ width: `${position}%` }} />
        <div
          className="range-bar-marker"
          style={{ left: `${position}%` }}
          title={`Current: ${formatCurrency(current)}`}
        />
      </div>

      <div className="range-bar-labels">
        <span>{formatCurrency(low)}</span>
        <span className="range-bar-position">
          {nearHigh ? 'Near 52-week high' : nearLow ? 'Near 52-week low' : `${position.toFixed(0)}% of range`}
        </span>
        <span>{formatCurrency(high)}</span>
      </div>
    </section>
  );
}
