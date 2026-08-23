import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';

interface AdolarPlaylist {
  id: number;
  name: string;
  description: string;
}

export function CreateTablePage() {
  const { auth } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [maxPlayers, setMaxPlayers] = useState(5);
  const [maxSpectators, setMaxSpectators] = useState(10);
  const [sourcePlaylistId, setSourcePlaylistId] = useState<string>('');
  const [playlists, setPlaylists] = useState<AdolarPlaylist[]>([]);
  const [playlistsConfigured, setPlaylistsConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!auth) return;
    apiFetch<{ configured: boolean; playlists: AdolarPlaylist[] }>('/adolar/playlists', { token: auth.accessToken })
      .then((r) => {
        setPlaylistsConfigured(r.configured);
        setPlaylists(r.playlists);
        // A confirmed Adolar connection with at least one playlist should be
        // the default choice - the local pool is the fallback, not the
        // norm, once Adolar is actually available.
        if (r.configured && r.playlists.length > 0) {
          setSourcePlaylistId(String(r.playlists[0].id));
        }
      })
      .catch(() => setPlaylistsConfigured(false));
  }, [auth]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!auth) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await apiFetch<{ tableId: string }>('/tables', {
        method: 'POST',
        body: {
          name,
          visibility,
          allowSpectators,
          maxPlayers,
          maxSpectators,
          sourcePlaylistId: sourcePlaylistId ? Number(sourcePlaylistId) : null,
        },
        token: auth.accessToken,
      });
      navigate(`/tisch/${result.tableId}`);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

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
      <div className="sh-card">
        <Link className="sh-back" to="/lobby">
          &larr; Zurück zur Lobby
        </Link>
        <h2>Tisch erstellen</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <form className="sh-form" onSubmit={handleSubmit}>
          <div className="sh-field">
            <label htmlFor="name">Tischname</label>
            <input id="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="sh-field">
            <label htmlFor="visibility">Sichtbarkeit</label>
            <select
              id="visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="public">Öffentlich (in der Lobby sichtbar)</option>
              <option value="private">Privat (nur per Link/Code)</option>
            </select>
          </div>

          <div className="sh-field">
            <label htmlFor="maxPlayers">Max. Spieler (2-5)</label>
            <input
              id="maxPlayers"
              type="number"
              min={2}
              max={5}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
            />
          </div>

          <div className="sh-field">
            <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={allowSpectators} onChange={(e) => setAllowSpectators(e.target.checked)} />
              Zuschauer erlauben
            </label>
          </div>

          {allowSpectators && (
            <div className="sh-field">
              <label htmlFor="maxSpectators">Max. Zuschauer (0-50)</label>
              <input
                id="maxSpectators"
                type="number"
                min={0}
                max={50}
                value={maxSpectators}
                onChange={(e) => setMaxSpectators(Number(e.target.value))}
              />
            </div>
          )}

          <div className="sh-field">
            <label htmlFor="playlist">Songquelle (Adolar-Playlist, optional)</label>
            {playlistsConfigured ? (
              <select id="playlist" value={sourcePlaylistId} onChange={(e) => setSourcePlaylistId(e.target.value)}>
                {playlists.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="">{playlists.length > 0 ? 'Lokaler Song-Pool' : 'Lokaler Song-Pool (Standard)'}</option>
              </select>
            ) : (
              <p style={{ fontSize: '0.85em', opacity: 0.8 }}>
                Adolar ist nicht konfiguriert - der lokale Song-Pool wird verwendet.
              </p>
            )}
          </div>

          <button className="sh-submit" type="submit" disabled={submitting}>
            {submitting ? 'Erstellen…' : 'Tisch erstellen'}
          </button>
        </form>
      </div>
    </div>
  );
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? 'Tisch konnte nicht erstellt werden.';
  }
  return 'Backend nicht erreichbar.';
}
