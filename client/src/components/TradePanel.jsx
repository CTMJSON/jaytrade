import { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';
import RecommendationBadge from './RecommendationBadge';
import SearchBar from './SearchBar';

export default function TradePanel({ symbol, onSelectSymbol, onTradeComplete, cash }) {
  const [quote, setQuote] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    async function load() {
      try {
        const data = await api.quote(symbol);
        if (!cancelled) setQuote(data);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [symbol]);

  async function handleTrade(side) {
    setError('');
    setBusy(true);
    try {
      await api.trade(symbol, side, Number(quantity));
      onTradeComplete();
      const updated = await api.quote(symbol);
      setQuote(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const estimatedTotal = quote ? quote.current * Number(quantity || 0) : 0;
  const changeClass = quote?.change > 0 ? 'positive' : quote?.change < 0 ? 'negative' : '';

  return (
    <div className="panel trade-panel">
      <SearchBar onSelect={onSelectSymbol} />

      {!symbol && <p className="trade-panel-hint">Search for a company above to view its price and place a trade.</p>}

      {symbol && loading && !quote && <p className="trade-panel-hint">Loading {symbol}...</p>}

      {symbol && error && !quote && <p className="error-text">{error}</p>}

      {symbol && quote && (
        <>
          <div className="trade-header">
            {quote?.logo && <img src={quote.logo} alt="" className="logo" />}
            <div>
              <h2>{quote?.name} <span className="ticker">{symbol}</span></h2>
              <div className={`price-row ${changeClass}`}>
                <span className="price">{formatCurrency(quote?.current)}</span>
                <span className="change">
                  {quote?.change >= 0 ? '+' : ''}
                  {quote?.change?.toFixed(2)} ({formatPercent(quote?.percentChange)})
                </span>
              </div>
            </div>
          </div>

          <div className="quote-stats">
            <div><span>Open</span>{formatCurrency(quote?.open)}</div>
            <div><span>High</span>{formatCurrency(quote?.high)}</div>
            <div><span>Low</span>{formatCurrency(quote?.low)}</div>
            <div><span>Prev Close</span>{formatCurrency(quote?.previousClose)}</div>
          </div>

          <RecommendationBadge symbol={symbol} />

          <div className="trade-form">
            <label>
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <div className="estimated-total">Estimated total: {formatCurrency(estimatedTotal)}</div>
            <div className="trade-buttons">
              <button className="buy-button" disabled={busy} onClick={() => handleTrade('BUY')}>
                Buy
              </button>
              <button className="sell-button" disabled={busy} onClick={() => handleTrade('SELL')}>
                Sell
              </button>
            </div>
            <div className="cash-note">Available cash: {formatCurrency(cash)}</div>
            {error && <p className="error-text">{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
