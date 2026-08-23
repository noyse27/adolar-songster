import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../api';

interface Invite {
  inviteId: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  createdByUsername: string;
}

interface Song {
  songId: string;
  source: string;
  title: string;
  year: number;
  durationSec: number | null;
  isValid: boolean;
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

        <MusicSourceSection token={token as string} />
        <InvitesSection token={token as string} />
        <SongsSection token={token as string} />
        <UsersSection token={token as string} />
      </div>
    </div>
  );
}

interface MusicSourceStatus {
  configured: boolean;
  baseUrl: string | null;
  lastSyncedAt: string | null;
}

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

  async function handleSync() {
    setMessage(null);
    setSyncing(true);
    try {
      const result = await apiFetch<{ playlistCount: number; trackCount: number }>('/admin/adolar-sync', {
        method: 'POST',
        token,
      });
      setMessage({
        kind: 'ok',
        text: `Sync fertig: ${result.trackCount} Songs aus ${result.playlistCount} Playlist(en).`,
      });
      load();
    } catch {
      setMessage({ kind: 'error', text: 'Sync fehlgeschlagen.' });
    } finally {
      setSyncing(false);
    }
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
    <section className="admin-section">
      <h3>Musikquelle</h3>
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
    </section>
  );
}

function InvitesSection({ token }: { token: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [maxUses, setMaxUses] = useState(5);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [creating, setCreating] = useState(false);

  function load() {
    apiFetch<{ invites: Invite[] }>('/invites', { token })
      .then((r) => setInvites(r.invites))
      .catch(() => {});
  }
  useEffect(load, [token]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/invites', { method: 'POST', body: { maxUses, expiresInDays }, token });
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDisable(inviteId: string) {
    await apiFetch(`/invites/${inviteId}/disable`, { method: 'POST', token });
    load();
  }

  return (
    <section className="admin-section">
      <h3>Einladungen</h3>
      <form className="admin-inline-form" onSubmit={handleCreate}>
        <input
          type="number"
          min={1}
          value={maxUses}
          onChange={(e) => setMaxUses(Number(e.target.value))}
          style={{ width: 90 }}
          title="Max. Nutzungen"
        />
        <input
          type="number"
          min={1}
          value={expiresInDays}
          onChange={(e) => setExpiresInDays(Number(e.target.value))}
          style={{ width: 110 }}
          title="Gültig für (Tage)"
        />
        <button className="admin-btn-sm" type="submit" disabled={creating}>
          Neue Einladung
        </button>
      </form>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Erstellt von</th>
              <th>Nutzung</th>
              <th>Läuft ab</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invites.map((inv) => (
              <tr key={inv.inviteId}>
                <td>
                  <code>{inv.code}</code>
                </td>
                <td>{inv.createdByUsername}</td>
                <td>
                  {inv.usedCount}/{inv.maxUses}
                </td>
                <td>{inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : '—'}</td>
                <td>
                  {inv.disabledAt ? (
                    <span className="admin-pill bad">deaktiviert</span>
                  ) : (
                    <span className="admin-pill">aktiv</span>
                  )}
                </td>
                <td>
                  {!inv.disabledAt && (
                    <button className="admin-btn-sm" onClick={() => handleDisable(inv.inviteId)}>
                      Deaktivieren
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {invites.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--sh-text-faint)' }}>
                  Noch keine Einladungen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SongsSection({ token }: { token: string }) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [title, setTitle] = useState('');
  const [year, setYear] = useState('');
  const [adding, setAdding] = useState(false);

  function load() {
    apiFetch<{ songs: Song[] }>('/admin/songs', { token })
      .then((r) => setSongs(r.songs))
      .catch(() => {});
  }
  useEffect(load, [token]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    const yearNum = parseInt(year, 10);
    if (!title || !yearNum) return;
    setAdding(true);
    try {
      await apiFetch('/admin/songs', { method: 'POST', body: { title, year: yearNum, source: 'local' }, token });
      setTitle('');
      setYear('');
      load();
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="admin-section">
      <h3>Song-Pool ({songs.length})</h3>
      <form className="admin-inline-form" onSubmit={handleAdd}>
        <input placeholder="Titel" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <input placeholder="Jahr" type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 90 }} />
        <button className="admin-btn-sm" type="submit" disabled={adding}>
          Song hinzufügen
        </button>
      </form>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Jahr</th>
              <th>Quelle</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {songs.slice(0, 50).map((s) => (
              <tr key={s.songId}>
                <td>{s.title}</td>
                <td>{s.year}</td>
                <td>{s.source}</td>
                <td>{s.isValid ? <span className="admin-pill">gültig</span> : <span className="admin-pill warn">ungültig</span>}</td>
              </tr>
            ))}
            {songs.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--sh-text-faint)' }}>
                  Noch keine Songs im Pool.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {songs.length > 50 && (
        <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginTop: 8 }}>
          Zeigt die ersten 50 von {songs.length}.
        </p>
      )}
    </section>
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
    <section className="admin-section">
      <h3>Nutzer ({users.length})</h3>
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
    </section>
  );
}
