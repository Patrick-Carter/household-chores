import { useEffect, useState, type FormEvent } from 'react';
import type { LoginResponse } from '@chores/shared';
import { api, login } from './lib/api';

interface PublicUser { id: number; name: string }

interface LoginProps {
  onLogin: (response: LoginResponse) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [mode, setMode] = useState<'household' | 'admin'>('household');
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [userId, setUserId] = useState<number | ''>('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<PublicUser[]>('/api/auth/users')
      .then((result) => {
        setUsers(result);
        if (result[0]) setUserId(result[0].id);
      })
      .catch(() => setError('The household server is unavailable.'));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      onLogin(await login(password, mode === 'household' ? Number(userId) : undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story" aria-label="Household introduction">
        <div className="login-monogram">CH</div>
        <p className="eyebrow light">Shared work, clearly kept</p>
        <h1>A calmer home starts with a clear ledger.</h1>
        <p>Claim what you can do, choose when you will do it, and keep the household in step.</p>
        <div className="rule" />
        <blockquote>“Many hands make light work.”</blockquote>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">Carter household</p>
          <h2>{mode === 'household' ? 'Open the ledger' : 'Admin desk'}</h2>
          <p className="muted">
            {mode === 'household'
              ? 'Choose your name and enter the household password.'
              : 'Enter the administrator password to manage the house.'}
          </p>
          <div className="mode-switch" aria-label="Login type">
            <button className={mode === 'household' ? 'active' : ''} onClick={() => setMode('household')}>Household</button>
            <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>Administrator</button>
          </div>
          <form onSubmit={submit} className="stack-form">
            {mode === 'household' && (
              <label>
                Who are you?
                <select value={userId} onChange={(event) => setUserId(Number(event.target.value))} required>
                  {users.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}
                </select>
              </label>
            )}
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                autoFocus
              />
            </label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button full" disabled={busy || (mode === 'household' && !userId)}>
              {busy ? 'Opening…' : 'Enter house ledger'}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
