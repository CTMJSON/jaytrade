import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { formatCurrency, formatPercent } from '../format';

const SECTIONS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'markets', label: 'Markets' },
  { id: 'automation', label: 'Automation' },
  { id: 'activity', label: 'Activity' },
];

export default function CommandPalette({ open, onOpenChange, portfolio, onSelectSymbol }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const close = useCallback(() => {
    onOpenChange(false);
    setQuery('');
    setResults([]);
    setActiveIndex(0);
  }, [onOpenChange]);

  // Global ⌘K / Ctrl+K.
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Debounced remote search.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const data = await api.search(trimmed);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query, open]);

  const holdings = portfolio?.holdings || [];

  const items = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    const list = [];

    const matchedHoldings = holdings.filter(
      (h) => !trimmed || h.symbol.toLowerCase().includes(trimmed)
    );
    matchedHoldings.forEach((h) => {
      list.push({
        type: 'holding',
        key: `holding:${h.symbol}`,
        symbol: h.symbol,
        group: 'Your holdings',
        detail: `${formatCurrency(h.marketValue)} · ${formatPercent(h.unrealizedPLPercent)}`,
        tone: h.unrealizedPL > 0 ? 'positive' : h.unrealizedPL < 0 ? 'negative' : '',
      });
    });

    const heldSymbols = new Set(holdings.map((h) => h.symbol));
    results
      .filter((r) => !heldSymbols.has(r.symbol))
      .slice(0, 8)
      .forEach((r) => {
        list.push({
          type: 'symbol',
          key: `symbol:${r.symbol}`,
          symbol: r.symbol,
          group: 'Search results',
          detail: r.description,
        });
      });

    const matchedSections = SECTIONS.filter((s) => !trimmed || s.label.toLowerCase().includes(trimmed));
    matchedSections.forEach((s) => {
      list.push({
        type: 'section',
        key: `section:${s.id}`,
        symbol: s.label,
        group: 'Jump to',
        detail: 'Scroll to section',
        sectionId: s.id,
      });
    });

    return list;
  }, [holdings, results, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const runItem = useCallback(
    (item) => {
      if (!item) return;
      if (item.type === 'section') {
        document.getElementById(item.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        onSelectSymbol(item.symbol);
      }
      close();
    },
    [close, onSelectSymbol]
  );

  function onInputKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i + 1) % items.length : 0));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (i - 1 + items.length) % items.length : 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runItem(items[activeIndex]);
    }
  }

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    const node = listRef.current?.querySelector('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  let lastGroup = null;

  return (
    <div className="palette-root">
      <div className="palette-backdrop" onClick={close} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <span className="palette-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder="Search a ticker, a holding, or jump to a section…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            aria-label="Search"
            aria-activedescendant={items[activeIndex] ? `palette-item-${activeIndex}` : undefined}
          />
          <kbd className="palette-kbd">esc</kbd>
        </div>

        <div className="palette-list" ref={listRef} role="listbox">
          {items.length === 0 && (
            <p className="palette-empty">
              {searching ? 'Searching…' : query.trim() ? 'No matches' : 'Start typing to search'}
            </p>
          )}

          {items.map((item, index) => {
            const showGroup = item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {showGroup && <div className="palette-group">{item.group}</div>}
                <button
                  id={`palette-item-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex}
                  className={index === activeIndex ? 'palette-item active' : 'palette-item'}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runItem(item)}
                >
                  <span className={`palette-item-symbol ${item.type === 'section' ? 'palette-item-section' : ''}`}>
                    {item.symbol}
                  </span>
                  <span className={`palette-item-detail ${item.tone || ''}`}>{item.detail}</span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="palette-footer">
          <span><kbd className="palette-kbd">↑</kbd><kbd className="palette-kbd">↓</kbd> navigate</span>
          <span><kbd className="palette-kbd">↵</kbd> open</span>
        </div>
      </div>
    </div>
  );
}
