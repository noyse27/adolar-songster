import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../api';
import { HomePage } from './HomePage';
import './pages.css';

type Status = 'checking' | 'needsSetup' | 'ready' | 'unreachable';

/** FR-061/FR-062: a fresh install has no admin yet and must go through the
 * setup wizard first. Once an admin exists, "/" is the normal home screen. */
export function RootGate() {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    apiFetch<{ adminExists: boolean }>('/setup/status')
      .then((s) => setStatus(s.adminExists ? 'ready' : 'needsSetup'))
      .catch(() => setStatus('unreachable'));
  }, []);

  if (status === 'checking') {
    return (
      <div className="app-shell">
        <p>Lade…</p>
      </div>
    );
  }
  if (status === 'needsSetup') return <Navigate to="/setup" replace />;
  if (status === 'unreachable') {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p className="sh-error">Backend nicht erreichbar. Bitte Setup pruefen (siehe README).</p>
        </div>
      </div>
    );
  }
  return <HomePage />;
}
