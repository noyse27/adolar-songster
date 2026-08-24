import { Link } from 'react-router-dom';
import './pages.css';
import { useAuth } from '../auth/AuthContext';
import adolarLogo from '../assets/brand/adolar-logo.svg';

export function HomePage() {
  const { auth, logout } = useAuth();

  return (
    <div className="app-shell">
      <div className="sh-brand">
        <img src={adolarLogo} alt="" width={64} height={64} style={{ display: auth ? 'none' : undefined }} />
        <div className="sh-brand-title">Willkommen bei Adolar Songster</div>
        <div className="sh-brand-sub">Zeitleisten-Ratespiel</div>
      </div>

      <div className="sh-card">
        {auth ? (
          <>
            <p className="sh-welcome">
              Angemeldet als <b>{auth.user.username}</b>
            </p>
            <div className="sh-actions">
              <Link className="sh-action sh-primary" to="/lobby">
                Zur Lobby <span className="sh-action-arrow">→</span>
              </Link>
              <Link className="sh-action" to="/anleitung">
                Anleitung <span className="sh-action-arrow">→</span>
              </Link>
              <Link className="sh-action" to="/rangliste">
                Rangliste <span className="sh-action-arrow">→</span>
              </Link>
              <Link className="sh-action" to="/profil">
                Profil <span className="sh-action-arrow">→</span>
              </Link>
              {auth.user.role !== 'admin' && auth.user.canCreateInvites && (
                <Link className="sh-action" to="/einladungen">
                  Einladungen <span className="sh-action-arrow">→</span>
                </Link>
              )}
              {auth.user.role === 'admin' && (
                <Link className="sh-action" to="/admin">
                  Admin-Bereich <span className="sh-action-arrow">→</span>
                </Link>
              )}
              <button className="sh-action" onClick={logout}>
                Abmelden <span className="sh-action-arrow">→</span>
              </button>
            </div>
          </>
        ) : (
          <div className="sh-actions">
            <Link className="sh-action sh-primary" to="/register">
              Registrieren <span className="sh-action-arrow">→</span>
            </Link>
            <Link className="sh-action" to="/login">
              Anmelden <span className="sh-action-arrow">→</span>
            </Link>
            <Link className="sh-action" to="/anleitung">
              Anleitung <span className="sh-action-arrow">→</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
