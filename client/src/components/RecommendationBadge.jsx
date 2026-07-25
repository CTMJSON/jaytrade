import { useEffect, useState } from 'react';
import { api } from '../api';

export default function RecommendationBadge({ symbol }) {
  const [rec, setRec] = useState(null);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    api
      .recommendation(symbol)
      .then((data) => !cancelled && setRec(data))
      .catch(() => !cancelled && setRec(null));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (!rec) return null;

  const total = rec.strongBuy + rec.buy + rec.hold + rec.sell + rec.strongSell;
  if (total === 0) return null;

  const bullish = rec.strongBuy + rec.buy;
  const bearish = rec.sell + rec.strongSell;
  const verdict = bullish > bearish + rec.hold ? 'Bullish' : bearish > bullish ? 'Bearish' : 'Mixed';
  const verdictClass = verdict === 'Bullish' ? 'positive' : verdict === 'Bearish' ? 'negative' : '';

  return (
    <div className="recommendation">
      <div className="recommendation-header">
        <span>Analyst Consensus</span>
        <span className={verdictClass}>{verdict}</span>
      </div>
      <div className="recommendation-bar">
        <div className="rec-segment strong-buy" style={{ flexGrow: rec.strongBuy || 0.0001 }} title={`Strong Buy: ${rec.strongBuy}`} />
        <div className="rec-segment buy" style={{ flexGrow: rec.buy || 0.0001 }} title={`Buy: ${rec.buy}`} />
        <div className="rec-segment hold" style={{ flexGrow: rec.hold || 0.0001 }} title={`Hold: ${rec.hold}`} />
        <div className="rec-segment sell" style={{ flexGrow: rec.sell || 0.0001 }} title={`Sell: ${rec.sell}`} />
        <div className="rec-segment strong-sell" style={{ flexGrow: rec.strongSell || 0.0001 }} title={`Strong Sell: ${rec.strongSell}`} />
      </div>
      <div className="recommendation-legend">
        <span>{rec.strongBuy + rec.buy} Buy</span>
        <span>{rec.hold} Hold</span>
        <span>{rec.sell + rec.strongSell} Sell</span>
      </div>
    </div>
  );
}
