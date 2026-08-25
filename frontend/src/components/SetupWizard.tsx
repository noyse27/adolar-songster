import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../api';
import adolarLogo from '../assets/brand/adolar-logo.svg';

// FR-062: browser onboarding wizard - admin creation, music source,
// first invite, test table. FR-063: integrated function test at the end.
type WizardStep =
  | 'loading'
  | 'reauth'
  | 'createAdmin'
  | 'configureMusicSource'
  | 'createInvite'
  | 'createTestTable'
  | 'selfTest'
  | 'done'
  | 'error';

type MusicSourceSubStep = 'enterUrl' | 'enterToken' | 'confirmed';

interface SelfTestResult {
  healthy: boolean;
  checks: { database: boolean; songPool: boolean; roundLogic: boolean };
}

export function SetupWizard() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<WizardStep>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [adminForm, setAdminForm] = useState({ username: '', email: '', password: '', setupToken: '' });

  // Convenience path (see backend/src/services/setupToken.ts's logged
  // link): pre-fill the token from ?token=... so the operator can just
  // click through instead of copy-pasting it into the form by hand. The
  // token is removed from the visible URL right away - it's single-use and
  // shouldn't linger in browser history/screenshots any longer than
  // necessary (same reasoning as the display-link token, see M-02).
  useEffect(() => {
    const tokenFromUrl = searchParams.get('token');
    if (!tokenFromUrl) return;
    setAdminForm((form) => ({ ...form, setupToken: tokenFromUrl }));
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);

  // Resuming after a page reload: we know from /setup/status which step to
  // land on, but the admin bearer token only ever lived in memory, so a
  // fresh login is needed first (see handleReauth below).
  const [pendingStep, setPendingStep] = useState<WizardStep | null>(null);
  const [reauthForm, setReauthForm] = useState({ usernameOrEmail: '', password: '' });

  const [musicSourceSubStep, setMusicSourceSubStep] = useState<MusicSourceSubStep>('enterUrl');
  const [adolarBaseUrl, setAdolarBaseUrl] = useState('');
  const [adolarApiToken, setAdolarApiToken] = useState('');
  const [adolarPlaylistCount, setAdolarPlaylistCount] = useState<number | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [testTableName, setTestTableName] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null);

  useEffect(() => {
    apiFetch<{ adminExists: boolean; musicSourceConfigured: boolean }>('/setup/status')
      .then((status) => {
        if (!status.adminExists) {
          setStep('createAdmin');
          return;
        }
        setPendingStep(status.musicSourceConfigured ? 'createInvite' : 'configureMusicSource');
        setStep('reauth');
      })
      .catch(() => {
        setErrorMessage('Backend nicht erreichbar. Bitte Compose-Setup pruefen.');
        setStep('error');
      });
  }, []);

  async function handleReauth(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    try {
      const login = await apiFetch<{ accessToken: string; user: { username: string } }>('/auth/login', {
        method: 'POST',
        body: reauthForm,
      });
      setAdminToken(login.accessToken);
      setAdminUsername(login.user.username);
      setStep(pendingStep ?? 'createInvite');
    } catch (err) {
      setErrorMessage(describeError(err, 'Anmeldung fehlgeschlagen.'));
    }
  }

  async function handleCreateAdmin(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    try {
      await apiFetch('/setup/bootstrap', { method: 'POST', body: adminForm });
      const login = await apiFetch<{ accessToken: string; user: { username: string } }>(
        '/auth/login',
        { method: 'POST', body: { usernameOrEmail: adminForm.username, password: adminForm.password } },
      );
      setAdminToken(login.accessToken);
      setAdminUsername(login.user.username);
      setStep('configureMusicSource');
    } catch (err) {
      setErrorMessage(describeError(err, 'Admin-Anlage fehlgeschlagen.'));
    }
  }

  function handleMusicSourceUrlNext(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setMusicSourceSubStep('enterToken');
  }

  async function handleMusicSourceTestConnection(event: FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setTestingConnection(true);
    try {
      const result = await apiFetch<{ ok: true; baseUrl: string; playlistCount: number }>(
        '/setup/music-source',
        {
          method: 'POST',
          body: { source: 'adolar', baseUrl: adolarBaseUrl, apiToken: adolarApiToken },
          token: adminToken ?? undefined,
        },
      );
      setAdolarBaseUrl(result.baseUrl);
      setAdolarPlaylistCount(result.playlistCount);
      setMusicSourceSubStep('confirmed');
    } catch (err) {
      setErrorMessage(describeMusicSourceError(err));
    } finally {
      setTestingConnection(false);
    }
  }

  async function handleCreateInvite() {
    setErrorMessage(null);
    try {
      const invite = await apiFetch<{ code: string }>('/invites', {
        method: 'POST',
        body: { maxUses: 5, expiresInDays: 14 },
        token: adminToken ?? undefined,
      });
      setInviteCode(invite.code);
      setStep('createTestTable');
    } catch (err) {
      setErrorMessage(describeError(err, 'Einladung konnte nicht erstellt werden.'));
    }
  }

  async function handleCreateTestTable() {
    setErrorMessage(null);
    try {
      const table = await apiFetch<{ name: string }>('/tables', {
        method: 'POST',
        body: { name: 'Testtisch', visibility: 'private' },
        token: adminToken ?? undefined,
      });
      setTestTableName(table.name);
      setStep('selfTest');
    } catch (err) {
      setErrorMessage(describeError(err, 'Testtisch konnte nicht erstellt werden.'));
    }
  }

  async function handleSelfTest() {
    setErrorMessage(null);
    try {
      const result = await apiFetch<SelfTestResult>('/setup/self-test', {
        method: 'POST',
        token: adminToken ?? undefined,
      });
      setSelfTest(result);
      setStep('done');
    } catch (err) {
      // A 503 with a checks body is a completed self-test that found a
      // real gap (e.g. no songs yet) - show the detail, not a blank error.
      if (err instanceof ApiError && err.body && typeof err.body === 'object' && 'checks' in err.body) {
        setSelfTest(err.body as SelfTestResult);
        setStep('done');
        return;
      }
      setErrorMessage(describeError(err, 'Funktionstest fehlgeschlagen.'));
    }
  }

  return (
    <main className="wizard">
      <img src={adolarLogo} alt="Adolar" className="wizard-logo" />
      <h1 className="adolar-heading wizard-title">Adolar Songster Setup</h1>

      {errorMessage && <p className="wizard-error">{errorMessage}</p>}

      {step === 'loading' && <p>Lade Setup-Status...</p>}

      {step === 'reauth' && (
        <section>
          <h2 className="adolar-heading">Weiter geht's</h2>
          <p>Ein Admin-Account existiert bereits. Zum Fortsetzen bitte nochmal anmelden.</p>
          <form onSubmit={handleReauth} className="wizard-form">
            <label>
              Benutzername oder E-Mail
              <input
                required
                autoFocus
                value={reauthForm.usernameOrEmail}
                onChange={(e) => setReauthForm({ ...reauthForm, usernameOrEmail: e.target.value })}
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                required
                value={reauthForm.password}
                onChange={(e) => setReauthForm({ ...reauthForm, password: e.target.value })}
              />
            </label>
            <button type="submit">Anmelden</button>
          </form>
        </section>
      )}

      {step === 'createAdmin' && (
        <section>
          <h2 className="adolar-heading">Schritt 1 von 4: Admin anlegen</h2>
          <form onSubmit={handleCreateAdmin} className="wizard-form">
            <label>
              Setup-Token
              <input
                required
                autoFocus
                value={adminForm.setupToken}
                onChange={(e) => setAdminForm({ ...adminForm, setupToken: e.target.value })}
              />
            </label>
            <p style={{ fontSize: '0.85em', opacity: 0.8 }}>
              Steht in den Backend-Logs ("SETUP TOKEN"), z. B. mit <code>docker compose logs backend</code>.
            </p>
            <label>
              Benutzername
              <input
                required
                value={adminForm.username}
                onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })}
              />
            </label>
            <label>
              E-Mail
              <input
                type="email"
                required
                value={adminForm.email}
                onChange={(e) => setAdminForm({ ...adminForm, email: e.target.value })}
              />
            </label>
            <label>
              Passwort
              <input
                type="password"
                required
                minLength={8}
                value={adminForm.password}
                onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              />
            </label>
            <button type="submit">Admin anlegen</button>
          </form>
        </section>
      )}

      {step === 'configureMusicSource' && (
        <section>
          <h2 className="adolar-heading">Schritt 2 von 4: Musikdaten</h2>

          <label style={{ display: 'block', marginBottom: '1rem' }}>
            Musikquelle
            <select value="adolar" disabled>
              <option value="adolar">Adolar</option>
            </select>
          </label>

          {musicSourceSubStep === 'enterUrl' && (
            <form onSubmit={handleMusicSourceUrlNext} className="wizard-form">
              <label>
                Adolar-Serveradresse
                <input
                  required
                  placeholder="adolar.beispiel.de"
                  value={adolarBaseUrl}
                  onChange={(e) => setAdolarBaseUrl(e.target.value)}
                />
              </label>
              <p style={{ fontSize: '0.85em', opacity: 0.8 }}>
                http:// oder https:// kann weggelassen werden - https wird dann automatisch angenommen.
              </p>
              <button type="submit">Weiter</button>
            </form>
          )}

          {musicSourceSubStep === 'enterToken' && (
            <form onSubmit={handleMusicSourceTestConnection} className="wizard-form">
              <p>
                Server: <code>{adolarBaseUrl}</code>
              </p>
              <label>
                App-Token
                <input
                  required
                  autoFocus
                  type="password"
                  disabled={testingConnection}
                  value={adolarApiToken}
                  onChange={(e) => setAdolarApiToken(e.target.value)}
                />
              </label>
              <p style={{ fontSize: '0.85em', opacity: 0.8 }}>
                Erzeugt in Adolar Web unter API-Zugriff (Produkt "songster").
              </p>
              {testingConnection && <p>Server wird kontaktiert…</p>}
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  disabled={testingConnection}
                  onClick={() => {
                    setErrorMessage(null);
                    setMusicSourceSubStep('enterUrl');
                  }}
                >
                  Zurück
                </button>
                <button type="submit" disabled={testingConnection}>
                  {testingConnection ? 'Verbindung testen…' : 'Verbindung testen'}
                </button>
              </div>
            </form>
          )}

          {musicSourceSubStep === 'confirmed' && (
            <>
              <p>
                Verbindung bestätigt: <code>{adolarBaseUrl}</code> ({adolarPlaylistCount}{' '}
                {adolarPlaylistCount === 1 ? 'Playlist' : 'Playlists'} gefunden).
              </p>
              <button onClick={() => setStep('createInvite')}>Weiter</button>
            </>
          )}
        </section>
      )}

      {step === 'createInvite' && (
        <section>
          <h2 className="adolar-heading">Schritt 3 von 4: Erste Einladung</h2>
          <p>Admin "{adminUsername}" angelegt.</p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleCreateInvite}>Einladung erstellen</button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStep('createTestTable');
              }}
            >
              Überspringen
            </button>
          </div>
        </section>
      )}

      {step === 'createTestTable' && (
        <section>
          <h2 className="adolar-heading">Schritt 4 von 4: Testtisch</h2>
          {inviteCode && (
            <p>
              Einladungscode: <code>{inviteCode}</code>
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleCreateTestTable}>Testtisch erstellen</button>
            <button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setStep('selfTest');
              }}
            >
              Überspringen
            </button>
          </div>
        </section>
      )}

      {step === 'selfTest' && (
        <section>
          <h2 className="adolar-heading">Funktionstest</h2>
          <p>{testTableName ? `Testtisch "${testTableName}" erstellt.` : 'Kein Testtisch angelegt.'}</p>
          <button onClick={handleSelfTest}>Funktionstest starten</button>
        </section>
      )}

      {step === 'done' && selfTest && (
        <section>
          <h2 className="adolar-heading">Setup abgeschlossen</h2>
          <ul>
            <li>Datenbank: {selfTest.checks.database ? 'OK' : 'Fehler'}</li>
            <li>Songpool: {selfTest.checks.songPool ? 'OK' : 'leer - Songs im Adminbereich hinzufuegen'}</li>
            <li>Rundenlogik: {selfTest.checks.roundLogic ? 'OK' : 'Fehler'}</li>
          </ul>
          <p>{selfTest.healthy ? 'Alle Funktionstests erfolgreich.' : 'Bitte offene Punkte pruefen.'}</p>
          <button onClick={() => navigate('/')}>Fertig</button>
        </section>
      )}
    </main>
  );
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? fallback;
  }
  return fallback;
}

function describeMusicSourceError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; detail?: string } | null;
    if (body?.detail) return `Verbindung fehlgeschlagen: ${body.detail}`;
    return body?.error ?? 'Verbindung zu Adolar fehlgeschlagen.';
  }
  return 'Backend nicht erreichbar. Bitte später erneut versuchen.';
}
