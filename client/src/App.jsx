import { useCallback, useEffect, useState } from 'react';
import { api, auth } from './api';
import TradePanel from './components/TradePanel';
import Portfolio from './components/Portfolio';
import TradeHistory from './components/TradeHistory';
import MoversTicker from './components/MoversTicker';
import IndexCharts from './components/IndexCharts';
import MarketSummary from './components/MarketSummary';
import ActiveStocks from './components/ActiveStocks';
import OrdersPanel from './components/OrdersPanel';
import PortfolioSummary from './components/PortfolioSummary';
import Login from './components/Login';
import Logo from './components/Logo';
import './App.css';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn());
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    function handleUnauthorized() {
      setLoggedIn(false);
      setPortfolio(null);
      setTrades([]);
    }
    window.addEventListener('jaytrade:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('jaytrade:unauthorized', handleUnauthorized);
  }, []);

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
    if (!loggedIn) return;
    refresh();
    const interval = setInterval(refresh, 15000);
    return () => clearInterval(interval);
  }, [loggedIn, refresh]);

  async function handleReset() {
    if (!confirm('Reset your portfolio back to starting cash? This clears all holdings and trade history.')) return;
    await api.reset();
    setSelectedSymbol(null);
    refresh();
  }

  async function handleLogout() {
    await auth.logout();
    setLoggedIn(false);
    setPortfolio(null);
    setTrades([]);
    setSelectedSymbol(null);
  }

  if (!loggedIn) {
    return <Login onLoggedIn={() => setLoggedIn(true)} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Logo size={36} />
          <h1>JayTrade</h1>
        </div>
        <div className="header-actions">
          <span className="account-badge">{auth.accountName()}</span>
          <button className="reset-button" onClick={handleReset}>Reset Portfolio</button>
          <button className="logout-button" onClick={handleLogout}>Log Out</button>
        </div>
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
