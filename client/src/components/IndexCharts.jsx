import { useEffect, useState } from 'react';
import { ComposedChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';

const GREEN = '#00e676';
const RED = '#ff3b5c';

export default function IndexCharts() {
  const [indices, setIndices] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.indices();
        if (!cancelled) setIndices(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    load();
    const interval = setInterval(load, 5 * 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) return null;
  if (indices.length === 0) return null;

  return (
    <div className="panel index-panel">
      <h3>Markets (5-Day)</h3>
      <div className="index-grid">
        {indices.map((idx) => {
          if (idx.error || !idx.points?.length) {
            return (
              <div key={idx.symbol} className="index-card">
                <div className="index-label">{idx.label}</div>
                <div className="empty-hint">Unavailable</div>
              </div>
            );
          }
          const first = idx.points[0].close;
          const last = idx.currentPrice ?? idx.points[idx.points.length - 1].close;
          const changePercent = ((last - first) / first) * 100;
          const isGain = changePercent >= 0;
          const color = isGain ? GREEN : RED;
          const gradientId = `idx-fill-${idx.symbol}`;
          return (
            <div key={idx.symbol} className="index-card">
              <div className="index-label">{idx.label}</div>
              <div className={`index-price ${isGain ? 'positive' : 'negative'}`}>
                {formatCurrency(last)} <span>{formatPercent(changePercent)}</span>
              </div>
              <ResponsiveContainer width="100%" height={60}>
                <ComposedChart data={idx.points}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={['dataMin', 'dataMax']} hide />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    labelFormatter={(label) => label}
                    contentStyle={{
                      background: '#171d29',
                      border: '1px solid #313c50',
                      borderRadius: 6,
                      fontSize: 12,
                      color: '#e7eaf1',
                    }}
                  />
                  <Area type="monotone" dataKey="close" stroke={color} strokeWidth={2} fill={`url(#${gradientId})`} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
    </div>
  );
}
