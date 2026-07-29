import { useEffect, useState } from 'react';
import type { BootstrapData, LoginResponse } from '@chores/shared';
import { AdminApp } from './AdminApp';
import { HouseholdApp } from './HouseholdApp';
import { Login } from './Login';
import { ApiError, getBootstrap, mutate, storedToken, storeToken } from './lib/api';

export function App() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(Boolean(storedToken()));

  async function refresh() {
    try {
      setData(await getBootstrap());
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) storeToken(null);
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (storedToken()) void refresh();
  }, []);

  function handleLogin(response: LoginResponse) {
    storeToken(response.token);
    setLoading(true);
    void refresh();
  }

  async function logout() {
    try {
      await mutate('/api/auth/session', 'DELETE');
    } catch {
      // Local sign-out still succeeds if the session or network has gone away.
    }
    storeToken(null);
    setData(null);
  }

  if (loading) {
    return <main className="loading-screen"><div className="loading-seal">CH</div><p>Opening the ledger…</p></main>;
  }
  if (!data) return <Login onLogin={handleLogin} />;
  if (data.actor.role === 'admin') {
    return <AdminApp data={data} refresh={refresh} logout={logout} />;
  }
  return <HouseholdApp data={data} refresh={refresh} logout={logout} />;
}
