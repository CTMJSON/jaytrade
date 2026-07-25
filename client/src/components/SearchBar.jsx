import { useEffect, useRef, useState } from 'react';
import { api } from '../api';

export default function SearchBar({ onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const data = await api.search(query);
        setResults(data);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(result) {
    onSelect(result.symbol);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div className="search-bar" ref={containerRef}>
      <input
        type="text"
        placeholder="Search companies or ticker symbols (e.g. Apple, AAPL)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
      />
      {open && (
        <div className="search-results">
          {loading && <div className="search-hint">Searching...</div>}
          {!loading && results.length === 0 && query.trim() && (
            <div className="search-hint">No matches found</div>
          )}
          {results.map((r) => (
            <button key={r.symbol} className="search-result" onClick={() => handleSelect(r)}>
              <span className="search-result-symbol">{r.symbol}</span>
              <span className="search-result-desc">{r.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
