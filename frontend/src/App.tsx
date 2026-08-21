import { useEffect, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

type HealthStatus = 'checking' | 'ok' | 'degraded' | 'unreachable';

export function App() {
  const [status, setStatus] = useState<HealthStatus>('checking');

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data: { status: HealthStatus }) => setStatus(data.status))
      .catch(() => setStatus('unreachable'));
  }, []);

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>Adolar Songster</h1>
      <p>Backend-Status: {status}</p>
    </main>
  );
}
