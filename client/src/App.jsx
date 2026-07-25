import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import TradePanel from './components/TradePanel';
import Portfolio from './components/Portfolio';
import TradeHistory from './components/TradeHistory';
import MoversTicker from './components/MoversTicker';
import IndexCharts from './components/IndexCharts';
import MarketSummary from './components/MarketSummary';
import ActiveStocks from './components/ActiveStocks';
import OrdersPanel from './components/OrdersPanel';
import PortfolioSummary from './components/PortfolioSummary';
import Logo from './components/Logo';
import './App.css';

export default function App() {
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [portfolioData, tradesData] = await Promise.all([api.portfolio(), api.trades()]);
      setPortfolio(portfolioData);
      setTrades(tradesData);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleReset() {
    if (!confirm('Reset your portfolio back to starting cash? This clears all holdings and trade history.')) return;
    await api.reset();
    setSelectedSymbol(null);
    refresh();
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Logo size={36} />
          <h1>JayTrade</h1>
        </div>
        <button className="reset-button" onClick={handleReset}>Reset Portfolio</button>
      </header>

      {error && <div className="banner error">{error}</div>}

      <MoversTicker onSelectSymbol={setSelectedSymbol} />

      <MarketSummary onSelectSymbol={setSelectedSymbol} />

      <IndexCharts />

      <PortfolioSummary portfolio={portfolio} onSelectSymbol={setSelectedSymbol} />

      <div className="main-grid">
        <TradePanel
          symbol={selectedSymbol}
          onSelectSymbol={setSelectedSymbol}
          onTradeComplete={refresh}
          cash={portfolio?.cash}
        />
        <Portfolio portfolio={portfolio} onSelectSymbol={setSelectedSymbol} />
      </div>

      <OrdersPanel defaultSymbol={selectedSymbol} />

      <ActiveStocks onSelectSymbol={setSelectedSymbol} />

      <TradeHistory trades={trades} />
    </div>
  );
}
