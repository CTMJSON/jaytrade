import { useCallback, useEffect, useState } from 'react';
import { api, auth } from './api';
import Portfolio from './components/Portfolio';
import TradeHistory from './components/TradeHistory';
import MoversTicker from './components/MoversTicker';
import IndexCharts from './components/IndexCharts';
import MarketSummary from './components/MarketSummary';
import ActiveStocks from './components/ActiveStocks';
import OrdersPanel from './components/OrdersPanel';
import PortfolioSummary from './components/PortfolioSummary';
import SymbolDrawer from './components/SymbolDrawer';
import SectionNav from './components/SectionNav';
import SearchBar from './components/SearchBar';
import EquityCurve from './components/EquityCurve';
import CommandPalette from './components/CommandPalette';
import Login from './components/Login';
import Logo from './components/Logo';
import { ToastProvider } from './components/Toast';
import { formatCurrency, formatPercent } from './format';
import { useFlash } from './useFlash';
import './App.css';

function AppShell() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn());
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [portfolio, setPortfolio] = useState(null);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Bumped after a trade so the equity curve refetches without polling on its own.
  const [tradeVersion, setTradeVersion] = useState(0);
  const totalValueFlash = useFlash(portfolio?.totalValue);

  useEffect(() => {
    function handleUnauthorized() {
      setLoggedIn(false);
      setPortfolio(null);
      setTrades([]);
      setDrawerOpen(false);
      setPaletteOpen(false);
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

  // Every ticker click anywhere in the app routes through here, so selection
  // always produces a visible result instead of updating an off-screen panel.
  const openSymbol = useCallback((symbol) => {
    if (!symbol) return;
    setSelectedSymbol(symbol);
    setDrawerOpen(true);
  }, []);

  const handleTradeComplete = useCallback(() => {
    setTradeVersion((v) => v + 1);
    refresh();
  }, [refresh]);

  async function handleReset() {
    if (!confirm('Reset your portfolio back to starting cash? This clears all holdings and trade history.')) return;
    await api.reset();
    setSelectedSymbol(null);
    setDrawerOpen(false);
    handleTradeComplete();
  }

  async function handleLogout() {
    await auth.logout();
    setLoggedIn(false);
    setPortfolio(null);
    setTrades([]);
    setSelectedSymbol(null);
    setDrawerOpen(false);
    setPaletteOpen(false);
  }

  if (!loggedIn) {
    return <Login onLoggedIn={() => setLoggedIn(true)} />;
  }

  const dayClass = portfolio?.dayChange > 0 ? 'positive' : portfolio?.dayChange < 0 ? 'negative' : '';

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <Logo size={36} />
          <h1>JayTrade</h1>
        </div>

        {portfolio && (
          <div className="header-portfolio" title="Total portfolio value">
            <span className={`header-portfolio-value ${totalValueFlash}`}>
              {formatCurrency(portfolio.totalValue)}
            </span>
            <span className={`header-portfolio-change ${dayClass}`}>
              <span className="delta-arrow" aria-hidden="true">{portfolio.dayChange >= 0 ? '▲' : '▼'}</span>
              {formatCurrency(portfolio.dayChange)} ({formatPercent(portfolio.dayChangePercent)}) today
            </span>
          </div>
        )}

        <div className="header-actions">
          <span className="account-badge">{auth.accountName()}</span>
          <button className="reset-button" onClick={handleReset}>Reset</button>
          <button className="logout-button" onClick={handleLogout}>Log Out</button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <MoversTicker onSelectSymbol={openSymbol} />

      <div className="global-search">
        <SearchBar onSelect={openSymbol} />
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          <span aria-hidden="true">⌕</span> Quick find
          <kbd className="palette-kbd">⌘K</kbd>
        </button>
      </div>

      <SectionNav />

      {/* 1. Your money first. */}
      <section id="portfolio" className="app-section">
        <h2 className="section-title">Your Portfolio</h2>
        <EquityCurve refreshKey={tradeVersion} />
        <PortfolioSummary portfolio={portfolio} onSelectSymbol={openSymbol} />
        <Portfolio portfolio={portfolio} onSelectSymbol={openSymbol} />
      </section>

      {/* 2. The market, grouped together instead of interleaved. */}
      <section id="markets" className="app-section">
        <h2 className="section-title">Markets</h2>
        <MarketSummary onSelectSymbol={openSymbol} />
        <IndexCharts />
        <ActiveStocks onSelectSymbol={openSymbol} />
      </section>

      {/* 3. Standing instructions. */}
      <section id="automation" className="app-section">
        <h2 className="section-title">Automation</h2>
        <OrdersPanel defaultSymbol={selectedSymbol} />
      </section>

      {/* 4. The paper trail. */}
      <section id="activity" className="app-section">
        <h2 className="section-title">Activity</h2>
        <TradeHistory trades={trades} />
      </section>

      <SymbolDrawer
        symbol={selectedSymbol}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        portfolio={portfolio}
        onTradeComplete={handleTradeComplete}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        portfolio={portfolio}
        onSelectSymbol={openSymbol}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
