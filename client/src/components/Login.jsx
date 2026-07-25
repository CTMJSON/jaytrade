import { useState } from 'react';
import { auth } from '../api';
import Logo from './Logo';

export default function Login({ onLoggedIn }) {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await auth.login(name.trim(), pin.trim());
      } else {
        await auth.register(name.trim(), pin.trim());
      }
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <Logo size={44} />
          <h1>JayTrade</h1>
        </div>
        <p className="login-subtitle">
          {mode === 'login' ? 'Log in to your paper trading account' : 'Create a new paper trading account'}
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. jake"
              autoFocus
              required
            />
          </label>
          <label>
            PIN
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="4-8 digits"
              required
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button type="submit" className="login-submit" disabled={busy}>
            {mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </form>

        <button className="login-toggle" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          {mode === 'login' ? "New here? Create an account" : 'Already have an account? Log in'}
        </button>
      </div>
    </div>
  );
}
