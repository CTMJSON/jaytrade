import { useEffect, useState } from 'react';
import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';
import TimeframeToggle, { EQUITY_TIMEFRAMES } from './TimeframeToggle';
import { PanelError, Skeleton } from './Skeleton';

const GREEN = '#00e676';
const RED = '#ff3b5c';
const BENCHMARK_COLOR = '#8b93a3';

function formatAxisDate(date, rangeKey) {
  const [y, m, d] = date.split('-');
  if (rangeKey === '1y' || rangeKey === 'all') return `${Number(m)}/${y.slice(2)}`;
  return `${Number(m)}/${Number(d)}`;
}

function formatFullDate(date) {
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function compactCurrency(value) {
  if (value == null) return '';
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

export default function EquityCurve({ refreshKey }) {
  const [timeframe, setTimeframe] = useState(() => EQUITY_TIMEFRAMES[0]); // 1W
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showBenchmark, setShowBenchmark] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .portfolioHistory(timeframe.range)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError('');
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [timeframe.range, reloadKey, refreshKey]);

  const points = data?.points || [];
  const isGain = (data?.changeValue ?? 0) >= 0;
  const lineColor = isGain ? GREEN : RED;
  const beatBenchmark =
    data?.changePercent != null && data?.benchmarkChangePercent != null
      ? data.changePercent - data.benchmarkChangePercent
      : null;

  return (
    <div className="panel equity-panel">
      <div className="equity-header">
        <div className="equity-heading">
          <h3>Portfolio Value</h3>
          {data && !data.insufficientHistory && (
            <div className="equity-headline">
              <span className="equity-value">{formatCurrency(data.endValue)}</span>
              <span className={`equity-change ${isGain ? 'positive' : 'negative'}`}>
                <span className="delta-arrow" aria-hidden="true">{isGain ? '▲' : '▼'}</span>
                {formatCurrency(data.changeValue)} ({formatPercent(data.changePercent)})
                <span className="equity-change-period"> this {timeframe.key === 'ALL' ? 'account' : timeframe.key}</span>
              </span>
            </div>
          )}
        </div>
        <TimeframeToggle options={EQUITY_TIMEFRAMES} value={timeframe.key} onChange={setTimeframe} />
      </div>

      {error && <PanelError message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {!error && loading && !data && <Skeleton height={240} radius={8} />}

      {!error && data?.insufficientHistory && (
        <p className="empty-hint equity-empty">
          Not enough history to chart yet — your portfolio curve builds as the market moves and
          you place trades. Check back tomorrow.
        </p>
      )}

      {!error && points.length > 1 && (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={points} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#232a38" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatAxisDate(d, timeframe.range)}
                tick={{ fontSize: 11, fill: '#8b93a3' }}
                minTickGap={40}
                axisLine={{ stroke: '#232a38' }}
                tickLine={{ stroke: '#232a38' }}
              />
              <YAxis
                domain={['auto', 'auto']}
                tickFormatter={compactCurrency}
                tick={{ fontSize: 11, fill: '#8b93a3' }}
                width={54}
                axisLine={{ stroke: '#232a38' }}
                tickLine={{ stroke: '#232a38' }}
              />
              <Tooltip
                labelFormatter={formatFullDate}
                formatter={(value, name) => [
                  formatCurrency(value),
                  name === 'benchmark' ? `${data.benchmarkSymbol} equivalent` : 'Portfolio',
                ]}
                contentStyle={{
                  background: '#171d29',
                  border: '1px solid #313c50',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#e7eaf1',
                }}
                labelStyle={{ color: '#8b93a3' }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2.5}
                fill="url(#equityFill)"
                dot={false}
                isAnimationActive={false}
              />
              {showBenchmark && (
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  stroke={BENCHMARK_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          <div className="equity-footer">
            <label className="equity-benchmark-toggle">
              <input
                type="checkbox"
                checked={showBenchmark}
                onChange={(e) => setShowBenchmark(e.target.checked)}
              />
              Compare to {data.benchmarkSymbol}
            </label>

            {beatBenchmark != null && (
              <span className="equity-verdict">
                You&rsquo;re{' '}
                <strong className={beatBenchmark >= 0 ? 'positive' : 'negative'}>
                  {formatPercent(data.changePercent)}
                </strong>{' '}
                vs {data.benchmarkSymbol} at{' '}
                <strong>{formatPercent(data.benchmarkChangePercent)}</strong> —{' '}
                {beatBenchmark >= 0 ? 'ahead by' : 'behind by'}{' '}
                {Math.abs(beatBenchmark).toFixed(2)} pts
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
