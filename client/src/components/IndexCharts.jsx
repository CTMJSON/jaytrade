import { useEffect, useState } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';

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
          return (
            <div key={idx.symbol} className="index-card">
              <div className="index-label">{idx.label}</div>
              <div className={`index-price ${isGain ? 'positive' : 'negative'}`}>
                {formatCurrency(last)} <span>{formatPercent(changePercent)}</span>
              </div>
              <ResponsiveContainer width="100%" height={60}>
                <LineChart data={idx.points}>
                  <YAxis domain={['dataMin', 'dataMax']} hide />
                  <Tooltip
                    formatter={(value) => formatCurrency(value)}
                    labelFormatter={(label) => label}
                    contentStyle={{ background: '#1e1e1e', border: 'none', fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="close"
                    stroke={isGain ? '#2fbf71' : '#ef4444'}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          );
        })}
      </div>
    </div>
  );
}
