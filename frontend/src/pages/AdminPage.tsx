import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api';
import { InvitesSection } from './InvitesSection';
import { CollapsibleSection } from './CollapsibleSection';
import { CommunicationSettingsSection } from './CommunicationSettingsSection';

interface Song {
  songId: string;
  source: string;
  title: string;
  artist: string | null;
  year: number;
  durationSec: number | null;
  isValid: boolean;
  yearOverride: boolean;
}

interface AdminUser {
  userId: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'blocked';
  canCreateInvites: boolean;
  karmaPoints: number;
  scorePoints: number;
  createdAt: string;
}

export function AdminPage() {
  const { auth } = useAuth();
  const token = auth?.accessToken;

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
  if (auth.user.role !== 'admin') {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Dieser Bereich ist nur für Admins.</p>
          <Link to="/">Zurück zur Startseite</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 880 }}>
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Admin-Bereich</h2>

        <CollapsibleSection title="Musikquelle">
          <MusicSourceSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Chateinstellungen">
          <CommunicationSettingsSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Einladungen">
          <InvitesSection token={token as string} isAdmin collapsible />
        </CollapsibleSection>
        <SongsSection token={token as string} />
        <CollapsibleSection title="Playlist-Suche">
          <PlaylistsSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Playlistadministration">
          <PlaylistAdminSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Tische">
          <TablesSection token={token as string} />
        </CollapsibleSection>
        <CollapsibleSection title="Nutzer">
          <UsersSection token={token as string} />
        </CollapsibleSection>
      </div>
    </div>
  );
}

interface MusicSourceStatus {
  configured: boolean;
  baseUrl: string | null;
  lastSyncedAt: string | null;
}

// Mirrors backend/src/services/adolarSync.ts's AdolarSyncState.
type SyncState =
  | { status: 'idle' }
  | { status: 'running'; startedAt: string }
  | { status: 'completed'; finishedAt: string; result: { playlistCount: number; trackCount: number } }
  | { status: 'failed'; finishedAt: string; error: string };

function MusicSourceSection({ token }: { token: string }) {
  const [status, setStatus] = useState<MusicSourceStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function load() {
    apiFetch<MusicSourceStatus>('/admin/music-source', { token })
      .then((s) => {
        setStatus(s);
        if (s.baseUrl) setBaseUrl(s.baseUrl);
      })
      .catch(() => setMessage({ kind: 'error', text: 'Status konnte nicht geladen werden.' }));
  }

  useEffect(load, [token]);

  // Fire-and-forget on the backend (see routes/admin.ts) - a full sync of a
  // real playlist takes well over a minute, too long to hold this request
  // open (that used to hit nginx's 60s proxy timeout and show "Sync
  // fehlgeschlagen" even when the sync itself succeeded a bit later). So
  // this just starts it, then polls /admin/adolar-sync/status until it's
  // no longer "running".
  async function handleSync() {
    setMessage(null);
    setSyncing(true);
    try {
      await apiFetch<{ started: boolean }>('/admin/adolar-sync', { method: 'POST', token });
    } catch {
      setMessage({ kind: 'error', text: 'Sync konnte nicht gestartet werden.' });
      setSyncing(false);
      return;
    }

    const poll = async () => {
      let state: SyncState;
      try {
        state = await apiFetch<SyncState>('/admin/adolar-sync/status', { token });
      } catch {
        setMessage({ kind: 'error', text: 'Sync-Status konnte nicht abgefragt werden.' });
        setSyncing(false);
        return;
      }
      if (state.status === 'running' || state.status === 'idle') {
        setTimeout(poll, 2000);
        return;
      }
      if (state.status === 'completed') {
        setMessage({
          kind: 'ok',
          text: `Sync fertig: ${state.result.trackCount} Songs aus ${state.result.playlistCount} Playlist(en).`,
        });
        load();
      } else {
        setMessage({ kind: 'error', text: `Sync fehlgeschlagen: ${state.error}` });
      }
      setSyncing(false);
    };
    poll();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    setTesting(true);
    try {
      const result = await apiFetch<{ ok: true; baseUrl: string; playlistCount: number }>('/setup/music-source', {
        method: 'POST',
        body: { source: 'adolar', baseUrl, apiToken },
        token,
      });
      setMessage({ kind: 'ok', text: `Verbunden mit ${result.baseUrl} (${result.playlistCount} Playlists).` });
      setApiToken('');
      load();
    } catch {
      setMessage({ kind: 'error', text: 'Verbindung fehlgeschlagen. Details siehe Setup-Wizard-Schritt.' });
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--sh-text-dim)', marginBottom: 4 }}>
        {status?.configured ? (
          <>
            Aktuell verbunden: <code>{status.baseUrl}</code>
          </>
        ) : (
          'Noch nicht konfiguriert.'
        )}
      </p>
      {status?.configured && (
        <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 12 }}>
          Songs zuletzt synchronisiert:{' '}
          {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : 'noch nie (läuft täglich automatisch)'}
        </p>
      )}
      {message && <div className={message.kind === 'ok' ? 'sh-info' : 'sh-error'} style={{ marginBottom: 12 }}>{message.text}</div>}
      <form className="admin-inline-form" onSubmit={handleSubmit}>
        <input placeholder="Adolar-Serveradresse" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required />
        <input
          type="password"
          placeholder="App-Token (neu setzen)"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          required
        />
        <button className="admin-btn-sm" type="submit" disabled={testing}>
          {testing ? 'Testen…' : 'Verbindung testen & speichern'}
        </button>
        {status?.configured && (
          <button className="admin-btn-sm" type="button" disabled={syncing} onClick={handleSync}>
            {syncing ? 'Synchronisiert… (kann bei großen Playlists dauern)' : 'Jetzt synchronisieren'}
          </button>
        )}
      </form>
    </>
  );
}

function YearCell({ song, token, onSaved }: { song: Song; token: string; onSaved: (s: Song) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(song.year));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const yearNum = parseInt(value, 10);
    if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
      setError('1900-2100');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await apiFetch<Song>(`/admin/songs/${song.songId}/year`, {
        method: 'PUT',
        body: { year: yearNum },
        token,
      });
      onSaved({ ...song, ...updated });
      setEditing(false);
    } catch {
      setError('Fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <span
        onClick={() => {
          setValue(String(song.year));
          setEditing(true);
        }}
        title={song.yearOverride ? 'Manuell korrigiert - Sync überschreibt das nicht mehr' : 'Klicken zum Korrigieren'}
        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
      >
        {song.year}
        {song.yearOverride && ' ✓'}
      </span>
    );
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: 70 }}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
      <button className="admin-btn-sm" type="button" disabled={saving} onClick={save}>
        OK
      </button>
      <button className="admin-btn-sm" type="button" onClick={() => setEditing(false)}>
        Abbrechen
      </button>
      {error && <span style={{ color: 'var(--sh-error, #e58b8b)', fontSize: 11 }}>{error}</span>}
    </span>
  );
}

interface AdolarPlaylistOption {
  playlistId: number;
  name: string;
  trackCount: number;
}

// Its own click-to-open header (rather than the generic CollapsibleSection
// wrapper) because the header text needs the selected playlist's live track
// count in parentheses, which only this component has.
function SongsSection({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<AdolarPlaylistOption[]>([]);
  const [playlistId, setPlaylistId] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) return;
    apiFetch<{ playlists: AdolarPlaylistOption[] }>('/admin/adolar-playlists', { token })
      .then((r) => setPlaylists(r.playlists))
      .catch(() => {});
  }, [open, token]);

  // Debounced so the search dialog doesn't fire a request per keystroke -
  // this scopes to the backend's LIMIT (50 with a query, 20 without) instead
  // of fetching the whole ~8000-track pool just to filter/slice it
  // client-side, see routes/admin.ts. No playlist selected -> nothing
  // loaded, which is also the dialog's default state (see below).
  useEffect(() => {
    if (!playlistId) {
      setSongs([]);
      return;
    }
    const id = setTimeout(() => {
      const params = new URLSearchParams({ playlistId });
      if (query) params.set('q', query);
      apiFetch<{ songs: Song[] }>(`/admin/songs?${params}`, { token })
        .then((r) => setSongs(r.songs))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [playlistId, query, token]);

  function updateSong(updated: Song) {
    setSongs((prev) => prev.map((s) => (s.songId === updated.songId ? updated : s)));
  }

  const selectedPlaylist = playlists.find((p) => String(p.playlistId) === playlistId);

  return (
    <section className="admin-section">
      <h3 className="admin-section-toggle" onClick={() => setOpen((o) => !o)}>
        <span className={`admin-section-caret${open ? ' open' : ''}`}>▶</span>
        Song-Pool{selectedPlaylist && ` (${selectedPlaylist.trackCount})`}
      </h3>
      {open && (
        <div className="admin-section-body">
          <select
            className="admin-search-input"
            value={playlistId}
            onChange={(e) => {
              setPlaylistId(e.target.value);
              setQuery('');
            }}
          >
            <option value="">Playlist wählen…</option>
            {playlists.map((p) => (
              <option key={p.playlistId} value={p.playlistId}>
                {p.name} ({p.trackCount})
              </option>
            ))}
          </select>
          <input
            className="admin-search-input"
            placeholder="Song oder Interpret suchen…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={!playlistId}
          />
          <div className="admin-table-wrap admin-table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Titel</th>
                  <th>Interpret</th>
                  <th>Jahr</th>
                  <th>Quelle</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {songs.map((s) => (
                  <tr key={s.songId}>
                    <td>{s.title}</td>
                    <td>{s.artist ?? '–'}</td>
                    <td>
                      <YearCell song={s} token={token} onSaved={updateSong} />
                    </td>
                    <td>{s.source}</td>
                    <td>{s.isValid ? <span className="admin-pill">gültig</span> : <span className="admin-pill warn">ungültig</span>}</td>
                  </tr>
                ))}
                {songs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--sh-text-faint)' }}>
                      {!playlistId ? 'Playlist wählen, um Songs zu sehen.' : query ? 'Keine Treffer.' : 'Noch keine Songs in dieser Playlist.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {songs.length === 50 && (
            <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginTop: 8 }}>
              Zeigt die ersten 50 Treffer - Suche eingrenzen, um mehr zu sehen.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

interface PlaylistCatalogEntry {
  id: number;
  name: string;
  displayName: string | null;
  adminDescription: string | null;
  isDefaultPlaylist: boolean;
}

// Lets an admin override how a playlist is shown to players: displayName
// replaces the raw Adolar name everywhere (table creation, Song-Pool, the
// "Songster PlayLists" lobby dialog), adminDescription is the blurb shown
// in that lobby dialog. Both live outside adolar_playlist's synced
// name/description columns, so a later sync run never clobbers them - see
// backend/src/services/adolarPlaylistCatalog.ts.
function PlaylistAdminSection({ token }: { token: string }) {
  const [playlists, setPlaylists] = useState<PlaylistCatalogEntry[]>([]);
  const [playlistId, setPlaylistId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [adminDescription, setAdminDescription] = useState('');
  const [isDefaultPlaylist, setIsDefaultPlaylist] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ playlists: PlaylistCatalogEntry[] }>('/admin/playlist-catalog', { token })
      .then((r) => setPlaylists(r.playlists))
      .catch(() => setError('Playlists konnten nicht geladen werden.'));
  }, [token]);

  function selectPlaylist(id: string) {
    setPlaylistId(id);
    setSaved(false);
    setError(null);
    const selected = playlists.find((p) => String(p.id) === id);
    setDisplayName(selected?.displayName ?? '');
    setAdminDescription(selected?.adminDescription ?? '');
    setIsDefaultPlaylist(selected?.isDefaultPlaylist ?? false);
  }

  async function save() {
    if (!playlistId) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiFetch(`/admin/playlist-catalog/${playlistId}`, {
        method: 'PUT',
        body: { displayName, adminDescription, isDefaultPlaylist },
        token,
      });
      setPlaylists((prev) =>
        prev.map((p) =>
          String(p.id) === playlistId
            ? { ...p, displayName: displayName || null, adminDescription: adminDescription || null, isDefaultPlaylist }
            : isDefaultPlaylist
              ? { ...p, isDefaultPlaylist: false }
            : p,
        ),
      );
      setSaved(true);
    } catch {
      setError('Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  }

  const selected = playlists.find((p) => String(p.id) === playlistId);

  return (
    <div>
      <div className="sh-field">
        <label htmlFor="playlist-admin-select">Playlist</label>
        <select id="playlist-admin-select" className="admin-search-input" value={playlistId} onChange={(e) => selectPlaylist(e.target.value)}>
          <option value="">Playlist wählen…</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName ?? p.name}
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <>
          <div className="sh-field">
            <label htmlFor="playlist-admin-displayname">Alternative Anzeigename</label>
            <input
              id="playlist-admin-displayname"
              className="admin-search-input"
              placeholder={selected.name}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="sh-field">
            <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={isDefaultPlaylist}
                onChange={(e) => {
                  setIsDefaultPlaylist(e.target.checked);
                  setSaved(false);
                }}
              />
              Standardplaylist
            </label>
          </div>
          <div className="sh-field">
            <label htmlFor="playlist-admin-description">Beschreibung</label>
            <textarea
              id="playlist-admin-description"
              className="admin-search-input"
              rows={3}
              value={adminDescription}
              onChange={(e) => {
                setAdminDescription(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <button className="admin-btn-sm" type="button" disabled={saving} onClick={save}>
            {saving ? 'Speichert…' : 'Speichern'}
          </button>
          {saved && <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--sh-text-faint)' }}>Gespeichert.</span>}
        </>
      )}
      {error && <div className="sh-error" style={{ marginTop: 10 }}>{error}</div>}
    </div>
  );
}

interface PlaylistTrack {
  trackId: string;
  position: number;
  songId: string | null;
  title: string;
  artist: string | null;
  year: number;
}

interface Playlist {
  playlistId: string;
  tableId: string;
  tableName: string;
  gameId: string;
  createdAt: string;
  expiresAt: string;
  tracks: PlaylistTrack[];
}

function PlaylistsSection({ token }: { token: string }) {
  const [playlistId, setPlaylistId] = useState('');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctingTrackId, setCorrectingTrackId] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!playlistId.trim()) return;
    setLoading(true);
    setError(null);
    setPlaylist(null);
    try {
      const result = await apiFetch<Playlist>(`/admin/playlists/${playlistId.trim()}`, { token });
      setPlaylist(result);
    } catch {
      setError('Playlist nicht gefunden (falsche ID oder älter als 1 Woche).');
    } finally {
      setLoading(false);
    }
  }

  async function correctTrack(track: PlaylistTrack, song: Song) {
    if (!playlist) return;
    const updated = await apiFetch<PlaylistTrack>(`/admin/playlists/${playlist.playlistId}/tracks/${track.trackId}`, {
      method: 'PUT',
      body: { songId: song.songId },
      token,
    });
    setPlaylist({
      ...playlist,
      tracks: playlist.tracks.map((t) => (t.trackId === updated.trackId ? updated : t)),
    });
    setCorrectingTrackId(null);
  }

  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--sh-text-dim)', marginBottom: 12 }}>
        Jede Partie speichert die tatsächlich gespielten Tracks unter einer eigenen Playlist-ID (1 Woche, danach
        automatisch gelöscht) - zur Fehleranalyse bei falsch erkannten Songs.
      </p>
      <form className="admin-inline-form" onSubmit={search}>
        <input
          className="admin-search-input"
          placeholder="Playlist-ID einfügen…"
          value={playlistId}
          onChange={(e) => setPlaylistId(e.target.value)}
        />
        <button className="admin-btn-sm" type="submit" disabled={loading}>
          {loading ? 'Suche…' : 'Suchen'}
        </button>
      </form>
      {error && <div className="sh-error" style={{ marginTop: 12 }}>{error}</div>}
      {playlist && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, color: 'var(--sh-text-dim)' }}>
            Tisch: <strong>{playlist.tableName}</strong> (<code>{playlist.tableId}</code>) &middot; erstellt{' '}
            {new Date(playlist.createdAt).toLocaleString()} &middot; läuft ab{' '}
            {new Date(playlist.expiresAt).toLocaleString()}
          </p>
          <div className="admin-table-wrap" style={{ marginTop: 8 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Titel</th>
                  <th>Interpret</th>
                  <th>Jahr</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {playlist.tracks.map((t) => (
                  <tr key={t.trackId}>
                    <td>{t.position}</td>
                    <td>{t.title}</td>
                    <td>{t.artist ?? '–'}</td>
                    <td>{t.year}</td>
                    <td>
                      {correctingTrackId === t.trackId ? (
                        <InlineTrackCorrection
                          token={token}
                          onPick={(song) => correctTrack(t, song)}
                          onCancel={() => setCorrectingTrackId(null)}
                        />
                      ) : (
                        <button className="admin-btn-sm" type="button" onClick={() => setCorrectingTrackId(t.trackId)}>
                          Korrigieren
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {playlist.tracks.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--sh-text-faint)' }}>
                      Noch keine Tracks gespielt (Partie läuft noch oder wurde nie beendet).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function InlineTrackCorrection({
  token,
  onPick,
  onCancel,
}: {
  token: string;
  onPick: (song: Song) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      apiFetch<{ songs: Song[] }>(`/admin/songs?q=${encodeURIComponent(query)}`, { token })
        .then((r) => setResults(r.songs))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(id);
  }, [query, token]);

  return (
    <div style={{ minWidth: 260 }}>
      <input
        className="admin-search-input"
        placeholder="Richtigen Song suchen…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 160, overflowY: 'auto' }}>
        {results.map((s) => (
          <li key={s.songId} style={{ padding: '2px 0' }}>
            <button
              className="admin-btn-sm"
              type="button"
              onClick={() => onPick(s)}
              style={{ width: '100%', textAlign: 'left' }}
            >
              {s.title} — {s.artist ?? '–'} ({s.year})
            </button>
          </li>
        ))}
      </ul>
      <button className="admin-btn-sm" type="button" onClick={onCancel} style={{ marginTop: 6 }}>
        Abbrechen
      </button>
    </div>
  );
}

interface AdminTable {
  tableId: string;
  name: string;
  visibility: string;
  state: string;
  ownerUsername: string;
  activePlayers: number;
  activeSpectators: number;
  createdAt: string;
  lastActivityAt: string;
  inactive: boolean;
}

function TablesSection({ token }: { token: string }) {
  const [tables, setTables] = useState<AdminTable[]>([]);

  function load() {
    apiFetch<{ tables: AdminTable[] }>('/admin/tables', { token })
      .then((r) => setTables(r.tables))
      .catch(() => {});
  }
  useEffect(load, [token]);

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 12 }}>
        {tables.length} Tische - "Inaktiv" = seit 30 Minuten keine Interaktion. Ohne jede Interaktion für 60 Minuten
        wird ein Tisch automatisch gelöscht.
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Besitzer</th>
              <th>Sichtbarkeit</th>
              <th>Status</th>
              <th>Spieler</th>
              <th>Zuschauer</th>
              <th>Aktivität</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.tableId}>
                <td>{t.name}</td>
                <td>{t.ownerUsername}</td>
                <td>{t.visibility === 'public' ? 'Öffentlich' : 'Privat'}</td>
                <td>{t.state}</td>
                <td>{t.activePlayers}</td>
                <td>{t.activeSpectators}</td>
                <td>
                  {t.inactive ? (
                    <span className="admin-pill warn">inaktiv</span>
                  ) : (
                    <span className="admin-pill">aktiv</span>
                  )}
                </td>
              </tr>
            ))}
            {tables.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--sh-text-faint)' }}>
                  Keine Tische vorhanden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UsersSection({ token }: { token: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    apiFetch<{ users: AdminUser[] }>('/admin/users', { token })
      .then((r) => setUsers(r.users))
      .catch(() => {});
  }
  useEffect(load, [token]);

  async function toggleInvitePermission(user: AdminUser) {
    setBusyId(user.userId);
    try {
      await apiFetch(`/admin/users/${user.userId}/invite-permission`, {
        method: 'POST',
        body: { canCreateInvites: !user.canCreateInvites },
        token,
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(user: AdminUser) {
    setBusyId(user.userId);
    try {
      await apiFetch(`/admin/users/${user.userId}/revoke-invites`, {
        method: 'POST',
        body: { invalidateCreatedInvites: true, deactivateRegisteredUsers: false },
        token,
      });
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function resetQuota(user: AdminUser) {
    setBusyId(user.userId);
    try {
      await apiFetch(`/admin/users/${user.userId}/reset-invite-quota`, { method: 'POST', token });
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 12 }}>{users.length} Nutzer</p>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Rolle</th>
              <th>Status</th>
              <th>Punkte / Karma</th>
              <th>Einladungsrecht</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.username}</td>
                <td>{u.role === 'admin' ? <span className="admin-pill">Admin</span> : 'Mitglied'}</td>
                <td>
                  {u.status === 'active' ? <span className="admin-pill">aktiv</span> : <span className="admin-pill bad">gesperrt</span>}
                </td>
                <td>
                  {u.scorePoints} / {u.karmaPoints}
                </td>
                <td>{u.canCreateInvites ? 'ja' : 'nein'}</td>
                <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {u.role !== 'admin' && (
                    <>
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => toggleInvitePermission(u)}>
                        {u.canCreateInvites ? 'Recht entziehen' : 'Recht erteilen'}
                      </button>
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => revoke(u)}>
                        Einladungen sperren
                      </button>
                      <button className="admin-btn-sm" disabled={busyId === u.userId} onClick={() => resetQuota(u)}>
                        Kontingent zurücksetzen
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
