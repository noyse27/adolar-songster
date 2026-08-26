import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api';

interface PlaylistEntry {
  id: number;
  name: string;
  description: string | null;
}

export function PlaylistsPage() {
  const { auth } = useAuth();
  const [playlists, setPlaylists] = useState<PlaylistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) return;
    apiFetch<{ playlists: PlaylistEntry[] }>('/playlists', { token: auth.accessToken })
      .then((r) => setPlaylists(r.playlists))
      .catch(() => setError('Playlists konnten nicht geladen werden.'));
  }, [auth]);

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>
            Bitte zuerst <Link to="/login">anmelden</Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 720 }}>
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Songster PlayLists</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {playlists.map((p) => (
            <li
              key={p.id}
              style={{
                padding: '10px 0',
                borderBottom: '1px solid var(--sh-border, rgba(255,255,255,0.1))',
              }}
            >
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              {p.description && (
                <div style={{ fontSize: 13, color: 'var(--sh-text-faint)', marginTop: 2 }}>{p.description}</div>
              )}
            </li>
          ))}
          {playlists.length === 0 && !error && (
            <li style={{ color: 'var(--sh-text-faint)', padding: '10px 0' }}>Gerade keine Playlist verfügbar.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
