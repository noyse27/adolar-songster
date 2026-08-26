import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import QRCode from 'qrcode';
import '../playboard/Playboard.css';
import './pages.css';
import { apiFetch, ApiError, API_BASE_URL } from '../api';
import { useWakeLock } from '../hooks/useWakeLock';
import { GameState } from '../game/types';
import { embedTimeline, packedIndexToBoxIndex, SLOT_COUNT } from '../game/timelineSlots';
import { placeAt } from '../playboard/gameLogic';
import { PlayerRow } from '../playboard/PlayerRow';
import { CenterControl } from '../playboard/CenterControl';
import { PendingResult, PlayerState, TokenState } from '../playboard/types';

interface DisplayTableDetail {
  tableId: string;
  name: string;
  visibility: string;
  joinCode: string | null;
  state: string;
  latestGameId: string | null;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/*
 * Hostmodus (gemeinsames Anzeigegerät): a read-only shared-screen view of
 * the Playboard, reached via a display token instead of a normal login (see
 * backend/src/services/displayToken.ts) - there is no `you`, no ready
 * toggle, no guess submission here, just the same PlayerRow/CenterControl
 * components LiveGameBoard uses, fed with everything hidden that would
 * require a per-user identity. This is the device that actually plays the
 * audio for everyone at the table - every player's own phone stays muted
 * while a display anchor is connected (see LiveGameBoard's `compact` mode).
 */
export function DisplayPage() {
  const { token } = useParams<{ token: string }>();

  const [table, setTable] = useState<DisplayTableDetail | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [audioMuted, setAudioMuted] = useState(false);
  const [revealUntil, setRevealUntil] = useState<number | null>(null);
  const [lastResolvedSong, setLastResolvedSong] = useState<{
    roundId: string;
    songArtist: string | null;
    songTitle: string | null;
    songYear: number | null;
  } | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // A dedicated socket, deliberately not the shared getSocket() singleton
  // from realtime/socket.ts - that one is keyed to a logged-in player's
  // token, and this page authenticates as a display, never a player.
  useEffect(() => {
    if (!token) return;
    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<DisplayTableDetail>(`/tables/display/${token}`)
      .then(setTable)
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) setNotFound(true);
        else setError('Tisch konnte nicht geladen werden.');
      });
  }, [token]);

  const tableId = table?.tableId ?? null;
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !tableId) return;
    socket.emit('table:join-room', tableId);
    const onTableUpdate = (payload: DisplayTableDetail) => setTable(payload);
    socket.on('table:update', onTableUpdate);
    return () => {
      socket.off('table:update', onTableUpdate);
      socket.emit('table:leave-room', tableId);
    };
  }, [tableId]);

  const gameId = table?.latestGameId ?? null;
  useEffect(() => {
    if (!token || !gameId) {
      setState(null);
      return;
    }
    apiFetch<GameState>(`/games/display/${token}/${gameId}`)
      .then(setState)
      .catch(() => setError('Spielstand konnte nicht geladen werden.'));

    const socket = socketRef.current;
    if (!socket) return;
    socket.emit('game:join-room', gameId);
    const onGameUpdate = (payload: GameState) => setState(payload);
    socket.on('game:update', onGameUpdate);
    return () => {
      socket.off('game:update', onGameUpdate);
      socket.emit('game:leave-room', gameId);
    };
  }, [token, gameId]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  useWakeLock(true);

  const round = state?.currentRound ?? null;
  const roundId = round?.roundId;
  const songStreamPath = round?.songStreamPath;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!songStreamPath) {
      audio.removeAttribute('src');
      audio.load();
      return;
    }
    audio.src = `${API_BASE_URL}${songStreamPath}`;
    audio.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const roundStatus = round?.status;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (roundStatus === 'playing') {
      audio.currentTime = 0;
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [roundStatus, roundId]);

  // Remembers the last resolved round's song, and holds the ring flipped to
  // the reveal face for a fixed 5s once a round resolves - keyed on
  // wall-clock time rather than round.status === 'resolved', since a fully
  // auto-ready table (see roundReadyWindow.ts) auto-starts the next round
  // the instant this one resolves, so `round` can already be the next
  // round's 'countdown' by the time this broadcast arrives - gating on its
  // status would skip the reveal (and the "Letzter Song" box) almost
  // entirely instead of holding it for 5s. Mirrors LiveGameBoard.tsx.
  useEffect(() => {
    if (roundStatus !== 'resolved' || !roundId || !round) return;
    setLastResolvedSong((prev) =>
      prev?.roundId === roundId
        ? prev
        : { roundId, songArtist: round.songArtist, songTitle: round.songTitle, songYear: round.songYear },
    );
    setRevealUntil((prev) => (prev !== null ? prev : Date.now() + 5000));
  }, [roundStatus, roundId, round]);

  useEffect(() => {
    if (revealUntil === null || now < revealUntil) return;
    setRevealUntil(null);
  }, [revealUntil, now]);

  const maxScore = useMemo(() => Math.max(0, ...(state?.players.map((p) => p.timeline.length) ?? [0])), [state]);
  const rankMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of state?.players ?? []) map[p.userId] = p.globalRank;
    return map;
  }, [state]);

  const shareLink =
    table && table.visibility === 'private' && table.joinCode
      ? `${window.location.origin}/tisch/${table.tableId}?code=${table.joinCode}`
      : table
        ? `${window.location.origin}/tisch/${table.tableId}`
        : null;

  if (notFound) {
    return (
      <div className="app-shell">
        <div className="sh-card">
          <p>Dieser Anzeige-Link ist ungültig oder abgelaufen.</p>
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

  // Between games: no live game running yet - show the table's join QR big,
  // so everyone sitting in front of this screen scans it directly instead
  // of the link having to be shared separately (see the plan's Ablauf B.1).
  if (!state || table.state !== 'running') {
    return (
      <div className="app-shell">
        <div className="sh-card" style={{ maxWidth: 480, textAlign: 'center' }}>
          <h2>{table.name}</h2>
          <p style={{ color: 'var(--sh-text-dim)' }}>Mit dem Handy hier beitreten:</p>
          {shareLink && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <QrCodeButtonAlwaysOpen value={shareLink} />
            </div>
          )}
          {error && <div className="sh-error" style={{ marginTop: 14 }}>{error}</div>}
        </div>
      </div>
    );
  }

  let ringMark = '?';
  let ringLabel = 'Bereit?';
  let progress = 0;
  let frontState: '' | 'pb-counting' | 'pb-playing' = '';
  let flipped = false;
  let phaseLabel = 'Bereit für nächste Runde';

  if (revealUntil !== null && now < revealUntil) {
    flipped = true;
    phaseLabel = 'Auflösung';
  } else if (state.roundReadyPhase) {
    const readyPhase = state.roundReadyPhase;
    if (readyPhase.startedAt) {
      const remaining = Math.max(0, readyPhase.windowMs - (now - new Date(readyPhase.startedAt).getTime()));
      ringMark = String(Math.ceil(remaining / 1000));
      progress = clamp01(1 - remaining / readyPhase.windowMs);
      ringLabel = 'Warte…';
      frontState = 'pb-counting';
      phaseLabel = 'Warte auf Mitspieler';
    }
  } else if (round) {
    if (round.status === 'countdown') {
      const elapsed = now - new Date(round.startedAt).getTime();
      const remaining = Math.max(0, round.countdownMs - elapsed);
      ringMark = String(Math.ceil(remaining / 1000) || 1);
      ringLabel = 'los geht’s';
      progress = clamp01(elapsed / round.countdownMs);
      frontState = 'pb-counting';
      phaseLabel = 'Countdown läuft';
    } else if (round.status === 'playing') {
      const elapsed = now - new Date(round.startedAt).getTime() - round.countdownMs;
      const remaining = Math.max(0, round.windowMs - elapsed);
      ringMark = '♪';
      ringLabel = 'läuft';
      progress = clamp01(elapsed / round.windowMs);
      frontState = 'pb-playing';
      phaseLabel = `Songfenster offen · ${Math.ceil(remaining / 1000)}s`;
    } else if (round.status === 'token_solo' || round.status === 'token_others') {
      ringMark = '!!';
      ringLabel = round.status === 'token_solo' ? 'Solo-Versuch' : 'Deine Chance';
      phaseLabel = round.status === 'token_solo' ? 'Songster-Buzzer aktiv' : 'Zweite Chance offen';
    }
  }

  return (
    <div className="playboard">
      <div className="pb-app">
        <div className="pb-topbar">
          <div className="pb-brand">
            <button
              className="pb-icon-btn"
              title={audioMuted ? 'Ton einschalten' : 'Ton ausschalten'}
              aria-label="Ton ein/aus"
              onClick={() => setAudioMuted((m) => !m)}
            >
              {audioMuted ? '🔇' : '🔊'}
            </button>
            <div className="pb-brand-mark">AS</div>
            <div>
              <div className="pb-brand-title">Songster</div>
              <div className="pb-brand-sub">Anzeigegerät</div>
            </div>
            {state && (
              <div className="pb-brand-ids" title={`Tisch-ID: ${state.tableId}\nPlaylist-ID: ${state.playlistId}`}>
                <span>Tisch {state.tableId.slice(0, 8)}</span>
                <span>Playlist {state.playlistId.slice(0, 8)}</span>
              </div>
            )}
          </div>
          <div className="pb-round-pill">
            <span className="pb-round-dot" />
            &nbsp;Runde <b>{round?.indexNo ?? '—'}</b> &middot; <span>{phaseLabel}</span>
          </div>
        </div>

        <audio ref={audioRef} preload="auto" muted={audioMuted} />

        {error && (
          <div className="sh-error" style={{ marginBottom: 4 }}>
            {error}
          </div>
        )}

        <div className="pb-board">
          {state.players.map((p) => {
            const sittingOut = round?.sitOutUserIds.includes(p.userId) ?? false;
            let slots: (number | null)[];
            let pendingSlot: number | null = null;
            let pendingResult: PendingResult = null;

            if (round?.status === 'resolved' && round.mode === 'normal') {
              const mine = round.results.find((r) => r.userId === p.userId);
              if (mine?.submitted && mine.guessedIndex !== null) {
                if (mine.correct) {
                  slots = embedTimeline(p.timeline);
                  pendingSlot = packedIndexToBoxIndex(mine.guessedIndex, p.timeline.length);
                } else {
                  const base = embedTimeline(p.timeline);
                  const desiredBox = packedIndexToBoxIndex(mine.guessedIndex, p.timeline.length);
                  const result = placeAt(base, desiredBox);
                  slots = result ? result.slots : base;
                  pendingSlot = result ? result.landingIndex : null;
                }
                pendingResult = mine.correct ? 'good' : 'bad';
              } else {
                slots = embedTimeline(p.timeline);
              }
            } else {
              slots = embedTimeline(p.timeline);
            }

            const isClaimant = round?.tokenClaimantUserId === p.userId;
            let tokenState: TokenState = 'idle';
            if (round?.tokenWrongGuessYear !== null && round?.tokenWrongGuessYear !== undefined && isClaimant) {
              tokenState = 'wrong';
            } else if (round?.status === 'token_solo' && isClaimant) {
              tokenState = 'entering';
            }

            const playerState: PlayerState = {
              id: p.userId,
              name: p.username,
              you: false,
              initials: p.username.slice(0, 2).toUpperCase(),
              slots,
              roundStartSlots: null,
              pendingSlot,
              pendingResult,
              tokenState,
              tokenGuess: isClaimant ? round?.tokenWrongGuessYear ?? null : null,
              songsterPoints: p.scorePoints,
              karma: p.karmaPoints,
              ready: state.roundReadyPhase?.readyUserIds.includes(p.userId) ?? false,
              autoReady: state.autoReadyUserIds.includes(p.userId),
              sittingOut,
            };

            return (
              <PlayerRow
                key={p.userId}
                player={playerState}
                isLeader={p.timeline.length === maxScore && maxScore > 0}
                rank={rankMap[p.userId]}
                canReady={false}
                onToggleReady={() => undefined}
                currentSongYear={round?.songYear ?? null}
                guessValue=""
                guessActive={false}
                guessWrongValue={null}
              />
            );
          })}
        </div>

        <div className="pb-deck">
          <div className="pb-tokens" />
          <div className="pb-center-control">
            <CenterControl
              ringMark={ringMark}
              ringLabel={ringLabel}
              progress={progress}
              frontState={frontState}
              flipped={flipped}
              revealSong={
                lastResolvedSong
                  ? { artist: lastResolvedSong.songArtist ?? '', title: lastResolvedSong.songTitle ?? '', year: lastResolvedSong.songYear ?? 0 }
                  : null
              }
              onClick={() => undefined}
            />
          </div>
          <div className="pb-status-card">
            <div className="pb-status-row">
              <span>Letzter Song</span>
              <b>{lastResolvedSong ? `${lastResolvedSong.songArtist} – ${lastResolvedSong.songTitle} (${lastResolvedSong.songYear})` : '—'}</b>
            </div>
            <div className="pb-status-row">
              <span>Karten</span>
              <b>bis {SLOT_COUNT}/{SLOT_COUNT}</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// The idle/waiting screen always shows the join QR straight away, no toggle
// needed - unlike QrCodeButton's default click-to-reveal (used in the table
// room, where showing it isn't always wanted).
function QrCodeButtonAlwaysOpen({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, { margin: 1, width: 320 }).then((url) => {
      if (!cancelled) setDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [value]);
  if (!dataUrl) return null;
  return <img src={dataUrl} alt="Beitritts-QR-Code" width={320} height={320} style={{ borderRadius: 8 }} />;
}
