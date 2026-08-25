import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';
import { getSocket } from '../realtime/socket';
import { QrCodeButton } from '../components/QrCodeButton';

interface Seat {
  userId: string;
  username: string;
  seatType: string;
  ready: boolean;
}

interface TableDetail {
  tableId: string;
  name: string;
  visibility: string;
  joinCode: string | null;
  allowSpectators: boolean;
  maxPlayers: number;
  maxSpectators: number;
  state: string;
  ownerUserId: string;
  activePlayers: number;
  activeSpectators: number;
  minKarmaPoints: number | null;
  minScorePoints: number | null;
  minGamesPlayed: number | null;
  lastActivityAt: string;
  seats: Seat[];
  latestGameId: string | null;
}

// Mirrors services/tableActivity.ts's INACTIVITY_DELETE_MS/WARNING_MS -
// keep in sync.
const INACTIVITY_DELETE_MS = 60 * 60 * 1000;
const INACTIVITY_WARNING_MS = 59 * 60 * 1000;

export function TableRoomPage() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { tableId } = useParams<{ tableId: string }>();
  const [searchParams] = useSearchParams();
  const joinCodeFromLink = searchParams.get('code') ?? '';

  const [table, setTable] = useState<TableDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [togglingReady, setTogglingReady] = useState(false);
  const [codeInput, setCodeInput] = useState(joinCodeFromLink);
  const [now, setNow] = useState(Date.now());
  const [keepingAlive, setKeepingAlive] = useState(false);
  const [creatingDisplayLink, setCreatingDisplayLink] = useState(false);
  const [displayLink, setDisplayLink] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!auth || !tableId) return;
    apiFetch<TableDetail>(`/tables/${tableId}`, { token: auth.accessToken })
      .then(setTable)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError('Tisch konnte nicht geladen werden.');
      });

    const socket = getSocket(auth.accessToken);
    socket.emit('table:join-room', tableId);
    const onUpdate = (payload: TableDetail) => setTable(payload);
    socket.on('table:update', onUpdate);
    return () => {
      socket.off('table:update', onUpdate);
      socket.emit('table:leave-room', tableId);
    };
  }, [auth, tableId]);

  const mySeat = useMemo(() => table?.seats.find((s) => s.userId === auth?.user.id) ?? null, [table, auth]);
  const isOwner = table?.ownerUserId === auth?.user.id;
  const players = table?.seats.filter((s) => s.seatType === 'player') ?? [];
  const spectators = table?.seats.filter((s) => s.seatType === 'spectator') ?? [];

  // System-inactive-table cleanup (services/tableCleanup.ts): a table
  // nobody interacts with for an hour gets hard-deleted for performance
  // reasons. This shows a dismissible warning in the last minute of that
  // window - clicking it just re-touches activity, same as any other
  // interaction would, resetting the whole hour.
  const msSinceActivity = table ? now - new Date(table.lastActivityAt).getTime() : 0;
  const showInactivityWarning = Boolean(mySeat) && msSinceActivity >= INACTIVITY_WARNING_MS;
  const secondsUntilDeletion = Math.max(0, Math.ceil((INACTIVITY_DELETE_MS - msSinceActivity) / 1000));

  async function handleKeepAlive() {
    if (!auth || !tableId) return;
    setKeepingAlive(true);
    try {
      await apiFetch(`/tables/${tableId}/keep-alive`, { method: 'POST', token: auth.accessToken });
    } catch {
      setError('Konnte die Inaktivitäts-Uhr nicht zurücksetzen.');
    } finally {
      setKeepingAlive(false);
    }
  }

  // The table auto-starts the moment everyone's ready (or the admin force-
  // starts early) - nobody has to click anything else once that happens,
  // so just follow everyone straight into the live game.
  useEffect(() => {
    if (table?.state === 'running' && table.latestGameId) {
      navigate(`/spiel/${table.latestGameId}`);
    }
  }, [table?.state, table?.latestGameId, navigate]);

  async function handleJoin(joinAs: 'player' | 'spectator') {
    if (!auth || !tableId) return;
    setJoining(true);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/join`, {
        method: 'POST',
        body: { joinAs, joinCode: table?.visibility === 'private' ? codeInput : undefined },
        token: auth.accessToken,
      });
      const fresh = await apiFetch<TableDetail>(`/tables/${tableId}`, { token: auth.accessToken });
      setTable(fresh);
    } catch (err) {
      setError(describeJoinError(err));
    } finally {
      setJoining(false);
    }
  }

  async function handleToggleReady() {
    if (!auth || !tableId || !mySeat) return;
    setTogglingReady(true);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/ready`, { method: 'POST', body: { ready: !mySeat.ready }, token: auth.accessToken });
    } catch {
      setError('Bereit-Status konnte nicht gesetzt werden.');
    } finally {
      setTogglingReady(false);
    }
  }

  async function handleStart() {
    if (!auth || !tableId) return;
    setStarting(true);
    setError(null);
    try {
      await apiFetch(`/tables/${tableId}/start`, { method: 'POST', token: auth.accessToken });
    } catch (err) {
      if (err instanceof ApiError) {
        const body = err.body as { error?: string } | null;
        setError(body?.error ?? 'Start fehlgeschlagen.');
      } else {
        setError('Start fehlgeschlagen.');
      }
    } finally {
      setStarting(false);
    }
  }

  // Hostmodus (gemeinsames Anzeigegerät): any currently-seated user can mint
  // a link for the shared screen (see POST /tables/:tableId/display-link) -
  // deliberately not owner-only, see tables.ts's route comment.
  async function handleCreateDisplayLink() {
    if (!auth || !tableId) return;
    setCreatingDisplayLink(true);
    setError(null);
    try {
      const result = await apiFetch<{ displayToken: string }>(`/tables/${tableId}/display-link`, {
        method: 'POST',
        token: auth.accessToken,
      });
      setDisplayLink(`${window.location.origin}/display/${result.displayToken}`);
    } catch {
      setError('Anzeige-Link konnte nicht erzeugt werden.');
    } finally {
      setCreatingDisplayLink(false);
    }
  }

  async function handleLeave() {
    if (!auth || !tableId) return;
    setLeaving(true);
    try {
      await apiFetch(`/tables/${tableId}/leave`, { method: 'POST', token: auth.accessToken });
      navigate('/lobby');
    } catch {
      setError('Verlassen fehlgeschlagen.');
      setLeaving(false);
    }
  }

  if (!auth) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>
            Bitte zuerst{' '}
            <Link to="/login" state={{ next: location.pathname + location.search }}>
              anmelden
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Diesen Tisch gibt es nicht (mehr).</p>
          <Link to="/lobby">Zurück zur Lobby</Link>
        </div>
      </div>
    );
  }
  if (!table) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Lade…</p>
        </div>
      </div>
    );
  }

  const shareLink =
    table.visibility === 'private' && table.joinCode
      ? `${window.location.origin}/tisch/${table.tableId}?code=${table.joinCode}`
      : null;

  return (
    <div className="app-shell">
      <div className="sh-card admin-shell" style={{ maxWidth: 640 }}>
        <Link className="sh-back" to="/lobby">
          &larr; Zurück zur Lobby
        </Link>
        <h2>{table.name}</h2>

        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        {showInactivityWarning && (
          <div className="sh-error" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              Dieser Tisch war lange inaktiv und wird in {Math.floor(secondsUntilDeletion / 60)}:
              {String(secondsUntilDeletion % 60).padStart(2, '0')} min automatisch geschlossen.
            </span>
            <button className="admin-btn-sm" disabled={keepingAlive} onClick={handleKeepAlive}>
              Ich bin noch da
            </button>
          </div>
        )}

        {shareLink && isOwner && (
          <div className="sh-info" style={{ marginBottom: 16, wordBreak: 'break-all' }}>
            <div>
              Einladungslink: <code>{shareLink}</code>
            </div>
            <div style={{ marginTop: 8 }}>
              <QrCodeButton value={shareLink} label="Einladungs-QR-Code anzeigen" />
            </div>
          </div>
        )}

        {mySeat && table.state === 'open' && (
          <div className="sh-info" style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Hostmodus: Anzeigegerät</div>
            <p style={{ fontSize: 13, color: 'var(--sh-text-faint)', margin: '0 0 8px' }}>
              Öffne diesen Link auf einem Fernseher/Tablet, das für alle sichtbar am Tisch steht - zeigt das volle
              Playboard, ohne dass sich das Gerät einloggt oder einen Platz belegt.
            </p>
            {!displayLink ? (
              <button className="admin-btn-sm" disabled={creatingDisplayLink} onClick={handleCreateDisplayLink}>
                {creatingDisplayLink ? 'Erzeugt…' : 'Anzeigegerät verbinden'}
              </button>
            ) : (
              <div style={{ wordBreak: 'break-all' }}>
                <code>{displayLink}</code>
                <div style={{ marginTop: 8 }}>
                  <QrCodeButton value={displayLink} label="Anzeige-QR-Code anzeigen" />
                </div>
              </div>
            )}
          </div>
        )}

        {!mySeat && (
          <section className="admin-section">
            <h3>Beitreten</h3>
            {(() => {
              const requirements = [
                table.minKarmaPoints !== null ? `Karma ≥ ${table.minKarmaPoints}` : null,
                table.minScorePoints !== null ? `Punkte ≥ ${table.minScorePoints}` : null,
                table.minGamesPlayed !== null ? `Spiele ≥ ${table.minGamesPlayed}` : null,
              ].filter((r): r is string => r !== null);
              return (
                requirements.length > 0 && (
                  <p style={{ fontSize: 12, color: 'var(--sh-text-faint)', marginBottom: 10 }}>
                    Anforderungen für Spieler: {requirements.join(', ')}
                  </p>
                )
              );
            })()}
            {table.visibility === 'private' && (
              <div className="sh-field" style={{ marginBottom: 10, maxWidth: 220 }}>
                <label htmlFor="joinCode">Tischcode</label>
                <input id="joinCode" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-btn-sm" disabled={joining || table.activePlayers >= table.maxPlayers} onClick={() => handleJoin('player')}>
                Als Spieler beitreten
              </button>
              {table.allowSpectators && (
                <button
                  className="admin-btn-sm"
                  disabled={joining || table.activeSpectators >= table.maxSpectators}
                  onClick={() => handleJoin('spectator')}
                >
                  Als Zuschauer beitreten
                </button>
              )}
            </div>
          </section>
        )}

        {mySeat && (
          <>
            <section className="admin-section">
              <h3>
                Spieler ({players.length}/{table.maxPlayers})
              </h3>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {players.map((p) => (
                  <li
                    key={p.userId}
                    style={{
                      fontSize: 14,
                      color: 'var(--sh-text-dim)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span className={`admin-pill${p.ready ? '' : ' warn'}`}>{p.ready ? 'bereit' : 'nicht bereit'}</span>
                    {p.username}
                    {p.userId === table.ownerUserId ? ' (Admin)' : ''}
                  </li>
                ))}
              </ul>
              {table.state === 'open' && mySeat?.seatType === 'player' && (
                <button className="admin-btn-sm" style={{ marginTop: 10 }} disabled={togglingReady} onClick={handleToggleReady}>
                  {mySeat.ready ? 'Nicht mehr bereit' : 'Bereit melden'}
                </button>
              )}
            </section>

            {table.allowSpectators && (
              <section className="admin-section">
                <h3>
                  Zuschauer ({spectators.length}/{table.maxSpectators})
                </h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {spectators.map((p) => (
                    <li key={p.userId} style={{ fontSize: 14, color: 'var(--sh-text-dim)' }}>
                      {p.username}
                    </li>
                  ))}
                  {spectators.length === 0 && <li style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>Niemand.</li>}
                </ul>
              </section>
            )}

            {table.state === 'open' && (() => {
              const allReady = players.length >= 2 && players.every((p) => p.ready);
              const atCapacity = players.length === table.maxPlayers;
              return (
                <>
                  {isOwner && (
                    <button
                      className="sh-submit"
                      disabled={starting || players.length < 2 || !allReady}
                      onClick={handleStart}
                    >
                      {starting
                        ? 'Startet…'
                        : players.length < 2
                          ? 'Mind. 2 Spieler nötig'
                          : !allReady
                            ? 'Warte, bis alle bereit sind'
                            : 'Jetzt starten'}
                    </button>
                  )}
                  {!isOwner && (
                    <p style={{ fontSize: 13, color: 'var(--sh-text-faint)' }}>
                      {allReady
                        ? atCapacity
                          ? 'Alle bereit — Spiel startet…'
                          : 'Alle bereit — wartet auf den Tisch-Admin oder mehr Spieler.'
                        : 'Warte, bis alle Spieler bereit sind.'}
                    </p>
                  )}
                </>
              );
            })()}

            <button
              className="admin-btn-sm"
              style={{ marginTop: 16 }}
              disabled={leaving}
              onClick={handleLeave}
            >
              Tisch verlassen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function describeJoinError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string } | null;
    if (body?.error === 'TABLE_JOIN_CODE_INVALID') return 'Tischcode ist falsch.';
    if (body?.error === 'TABLE_FULL') return 'Tisch ist voll.';
    if (body?.error === 'TABLE_NOT_JOINABLE') return 'Diesem Tisch kann gerade nicht beigetreten werden.';
    if (body?.error === 'PLAYER_REQUIREMENTS_NOT_MET') {
      return 'Du erfüllst die Mindestanforderungen für Spieler nicht - Beitritt als Zuschauer ist möglich.';
    }
    return body?.error ?? 'Beitritt fehlgeschlagen.';
  }
  return 'Backend nicht erreichbar.';
}
