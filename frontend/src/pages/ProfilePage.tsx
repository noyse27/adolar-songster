import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import { apiFetch, ApiError } from '../api';

interface Profile {
  id: string;
  username: string;
  email: string;
  role: 'user' | 'admin';
  canCreateInvites: boolean;
  karmaPoints: number;
  scorePoints: number;
  gamesPlayed: number;
  createdAt: string;
}

interface LeaderboardEntry {
  userId: string;
  username: string;
  scorePoints: number;
  karmaPoints: number;
}

export function ProfilePage() {
  const { auth } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSubmitting, setPwSubmitting] = useState(false);

  useEffect(() => {
    if (!auth) return;
    apiFetch<Profile>('/users/me', { token: auth.accessToken })
      .then(setProfile)
      .catch(() => setLoadError('Profil konnte nicht geladen werden.'));
    apiFetch<{ leaderboard: LeaderboardEntry[] }>('/leaderboard', { token: auth.accessToken })
      .then((res) => {
        const idx = res.leaderboard.findIndex((e) => e.userId === auth.user.id);
        setRank(idx >= 0 ? idx + 1 : null);
      })
      .catch(() => {});
  }, [auth]);

  async function handleChangePassword(event: FormEvent) {
    event.preventDefault();
    setPwError(null);
    setPwSuccess(false);
    if (newPassword !== newPassword2) {
      setPwError('Die neuen Passwörter stimmen nicht überein.');
      return;
    }
    setPwSubmitting(true);
    try {
      await apiFetch('/users/me/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
        token: auth?.accessToken,
      });
      setPwSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setNewPassword2('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPwError('Aktuelles Passwort ist falsch.');
      } else {
        setPwError('Passwort konnte nicht geändert werden.');
      }
    } finally {
      setPwSubmitting(false);
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
        <Link className="sh-back" to="/">
          &larr; Zurück
        </Link>
        <h2>Dein Profil</h2>

        {loadError && <div className="sh-error" style={{ marginBottom: 14 }}>{loadError}</div>}

        {profile && (
          <div className="admin-stat-grid" style={{ marginBottom: 22 }}>
            <div className="admin-stat">
              <span>Benutzername</span>
              <b>{profile.username}</b>
            </div>
            <div className="admin-stat">
              <span>E-Mail</span>
              <b>{profile.email}</b>
            </div>
            <div className="admin-stat">
              <span>Songster-Punkte</span>
              <b>{profile.scorePoints}</b>
            </div>
            <div className="admin-stat">
              <span>Karma-Punkte</span>
              <b>{profile.karmaPoints}</b>
            </div>
            <div className="admin-stat">
              <span>Gespielte Spiele</span>
              <b>{profile.gamesPlayed}</b>
            </div>
            <div className="admin-stat">
              <span>Rang</span>
              <b>{rank ? `#${rank}` : '—'}</b>
            </div>
            <div className="admin-stat">
              <span>Rolle</span>
              <b>{profile.role === 'admin' ? 'Admin' : 'Mitglied'}</b>
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 15 }}>Passwort ändern</h2>
        {pwError && <div className="sh-error" style={{ marginBottom: 14 }}>{pwError}</div>}
        {pwSuccess && <div className="sh-info" style={{ marginBottom: 14 }}>Passwort geändert.</div>}
        <form className="sh-form" onSubmit={handleChangePassword}>
          <div className="sh-field">
            <label htmlFor="currentPassword">Aktuelles Passwort</label>
            <input
              id="currentPassword"
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="sh-field">
            <label htmlFor="newPassword">Neues Passwort</label>
            <input
              id="newPassword"
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="sh-field">
            <label htmlFor="newPassword2">Neues Passwort (Wiederholung)</label>
            <input
              id="newPassword2"
              type="password"
              required
              minLength={8}
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
            />
          </div>
          <button className="sh-submit" type="submit" disabled={pwSubmitting}>
            {pwSubmitting ? 'Ändern…' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  );
}
