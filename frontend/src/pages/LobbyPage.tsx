import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';
import { getSocket } from '../realtime/socket';

interface LobbyTable {
  tableId: string;
  name: string;
  visibility: string;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  state: string;
  activePlayers: number;
  activeSpectators: number;
  createdAt: string;
}

function tableAge(createdAt: string, now: number): string {
  const totalMinutes = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60000));
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function LobbyPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const [tables, setTables] = useState<LobbyTable[]>([]);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!auth) return;
    apiFetch<{ tables: LobbyTable[] }>('/tables/lobby', { token: auth.accessToken })
      .then((r) => setTables(r.tables))
      .catch(() => setError('Tischliste konnte nicht geladen werden.'));

    const socket = getSocket(auth.accessToken);
    socket.emit('lobby:join');
    const onTables = (payload: { tables: LobbyTable[] }) => setTables(payload.tables);
    socket.on('lobby:tables', onTables);
    return () => {
      socket.off('lobby:tables', onTables);
      socket.emit('lobby:leave');
    };
  }, [auth]);

  async function handleJoin(tableId: string) {
    if (!auth) return;
    setJoiningId(tableId);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/join`, { method: 'POST', body: { joinAs: 'player' }, token: auth.accessToken });
      navigate(`/tisch/${tableId}`);
    } catch (err) {
      const code = err instanceof ApiError ? (err.body as { error?: string } | null)?.error : undefined;
      if (code === 'PLAYER_REQUIREMENTS_NOT_MET') {
        // This table has a minimum karma/score/games-played bar the
        // requester doesn't clear - spectating is never gated by that, so
        // fall back to it instead of just failing the join outright.
        try {
          await apiFetch(`/tables/${tableId}/join`, { method: 'POST', body: { joinAs: 'spectator' }, token: auth.accessToken });
          navigate(`/tisch/${tableId}`);
          return;
        } catch {
          setError('Die Mindestanforderungen für Spieler erfüllst du nicht, und der Beitritt als Zuschauer ist ebenfalls fehlgeschlagen.');
          return;
        }
      }
      setError('Beitritt fehlgeschlagen - Tisch evtl. schon voll.');
    } finally {
      setJoiningId(null);
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
      <div className="sh-card admin-shell" style={{ maxWidth: 720 }}>
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Lobby</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        <div style={{ marginBottom: 18 }}>
          <Link className="sh-action sh-primary" to="/tisch/neu">
            Neuen Tisch erstellen <span className="sh-action-arrow">→</span>
          </Link>
        </div>

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tisch</th>
                <th>Spieler</th>
                <th>Zuschauer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.tableId}>
                  <td>{t.name}</td>
                  <td>
                    {t.activePlayers}/{t.maxPlayers}
                  </td>
                  <td>{t.allowSpectators ? `${t.activeSpectators}/${t.maxSpectators}` : '—'}</td>
                  <td>
                    <button
                      className="admin-btn-sm"
                      disabled={joiningId === t.tableId || t.activePlayers >= t.maxPlayers}
                      onClick={() => handleJoin(t.tableId)}
                    >
                      Beitreten
                    </button>{' '}
                    <span style={{ fontSize: 11, color: 'var(--sh-text-faint)' }} title="Wie lange es diesen Tisch schon gibt">
                      {tableAge(t.createdAt, now)}
                    </span>
                  </td>
                </tr>
              ))}
              {tables.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--sh-text-faint)' }}>
                    Gerade kein öffentlicher Tisch offen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
