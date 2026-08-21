import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api';
import adolarLogo from '../assets/brand/adolar-logo.svg';

// FR-062: browser onboarding wizard - admin creation, first invite, test
// table. FR-063: integrated function test at the end.
type WizardStep =
  | 'loading'
  | 'alreadySetUp'
  | 'createAdmin'
  | 'createInvite'
  | 'createTestTable'
  | 'selfTest'
  | 'done'
  | 'error';

interface SelfTestResult {
  healthy: boolean;
  checks: { database: boolean; songPool: boolean; roundLogic: boolean };
}

export function SetupWizard() {
  const [step, setStep] = useState<WizardStep>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [adminForm, setAdminForm] = useState({ username: '', email: '', password: '' });
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);

  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [testTableName, setTestTableName] = useState<string | null>(null);
  const [selfTest, setSelfTest] = useState<SelfTestResult | null>(null);

  useEffect(() => {
    apiFetch<{ adminExists: boolean }>('/setup/status')
      .then((status) => setStep(status.adminExists ? 'alreadySetUp' : 'createAdmin'))
      .catch(() => {
        setErrorMessage('Backend nicht erreichbar. Bitte Compose-Setup pruefen.');
        setStep('error');
      });
  }, []);

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
      setStep('createInvite');
    } catch (err) {
      setErrorMessage(describeError(err, 'Admin-Anlage fehlgeschlagen.'));
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
        body: { name: 'Testtisch', visibility: 'public' },
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

      {step === 'alreadySetUp' && (
        <p>Ein Admin-Account existiert bereits. Der Einrichtungsassistent ist nur fuer die Erstinstallation gedacht.</p>
      )}

      {step === 'createAdmin' && (
        <section>
          <h2 className="adolar-heading">Schritt 1 von 3: Admin anlegen</h2>
          <form onSubmit={handleCreateAdmin} className="wizard-form">
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

      {step === 'createInvite' && (
        <section>
          <h2 className="adolar-heading">Schritt 2 von 3: Erste Einladung</h2>
          <p>Admin "{adminUsername}" angelegt.</p>
          <button onClick={handleCreateInvite}>Einladung erstellen</button>
        </section>
      )}

      {step === 'createTestTable' && (
        <section>
          <h2 className="adolar-heading">Schritt 3 von 3: Testtisch</h2>
          <p>
            Einladungscode: <code>{inviteCode}</code>
          </p>
          <button onClick={handleCreateTestTable}>Testtisch erstellen</button>
        </section>
      )}

      {step === 'selfTest' && (
        <section>
          <h2 className="adolar-heading">Funktionstest</h2>
          <p>Testtisch "{testTableName}" erstellt.</p>
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
