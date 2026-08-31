import { FormEvent, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import './pages.css';
import { API_BASE_URL } from '../api';
import { DisplayPage } from './DisplayPage';

interface Pairing {
  deviceId: string;
  deviceSecret: string;
  pairingCode: string;
  pairingExpiresAt: string;
}

interface HostDeviceState {
  id: string;
  label: string;
  status: string;
  authorized: boolean;
  currentTableId: string | null;
  displayToken: string | null;
}

const STORAGE_KEY = 'adolar-songster-host-device';

function randomInstallId(): string {
  const existing = window.localStorage.getItem(`${STORAGE_KEY}:install-id`);
  if (existing) return existing;
  const id = crypto.randomUUID();
  window.localStorage.setItem(`${STORAGE_KEY}:install-id`, id);
  return id;
}

function readSavedPairing(): Pairing | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Pairing;
  } catch {
    return null;
  }
}

function writeSavedPairing(pairing: Pairing | null): void {
  if (pairing) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
  else window.localStorage.removeItem(STORAGE_KEY);
}

async function hostFetch<T>(baseUrl: string, path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error ?? `HTTP ${response.status}`);
  return data as T;
}

export function HostAppPage() {
  const [serverUrl, setServerUrl] = useState(() => window.localStorage.getItem(`${STORAGE_KEY}:server-url`) ?? window.location.origin);
  const [pairing, setPairing] = useState<Pairing | null>(() => readSavedPairing());
  const [device, setDevice] = useState<HostDeviceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apiBase = useMemo(() => `${serverUrl.replace(/\/$/, '')}${API_BASE_URL.startsWith('/') ? API_BASE_URL : `/${API_BASE_URL}`}`, [serverUrl]);
  const authorizeUrl = pairing ? `${serverUrl.replace(/\/$/, '')}/host/authorize?code=${encodeURIComponent(pairing.pairingCode)}` : null;

  useEffect(() => {
    if (!pairing) return;
    const activePairing = pairing;
    let cancelled = false;
    async function tick() {
      try {
        const next = await hostFetch<HostDeviceState>(apiBase, `/host-devices/app/${activePairing.deviceId}`, {
          headers: { 'X-Host-Device-Secret': activePairing.deviceSecret },
        });
        if (!cancelled) {
          setDevice(next);
          setError(null);
        }
      } catch {
        if (!cancelled) {
          writeSavedPairing(null);
          setPairing(null);
          setDevice(null);
          setError('Hostgerät wurde getrennt oder ist abgelaufen.');
        }
      }
    }
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [apiBase, pairing]);

  useEffect(() => {
    if (!authorizeUrl) {
      setQrCodeUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(authorizeUrl, { margin: 1, width: 280 })
      .then((url) => {
        if (!cancelled) setQrCodeUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrCodeUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authorizeUrl]);

  async function handleCreatePairing(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await hostFetch<Pairing>(apiBase, '/host-devices/pairings', {
        method: 'POST',
        body: JSON.stringify({ label: 'Fire TV Host-App', installId: randomInstallId() }),
      });
      window.localStorage.setItem(`${STORAGE_KEY}:server-url`, serverUrl.replace(/\/$/, ''));
      writeSavedPairing(next);
      setPairing(next);
      setDevice(null);
    } catch {
      setError('Songster-URL konnte nicht erreicht werden.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!pairing) return;
    try {
      await hostFetch(apiBase, `/host-devices/app/${pairing.deviceId}`, {
        method: 'DELETE',
        headers: { 'X-Host-Device-Secret': pairing.deviceSecret },
      });
    } catch {
      // Local cleanup is still right if the app is already gone server-side.
    }
    writeSavedPairing(null);
    setPairing(null);
    setDevice(null);
  }

  useEffect(() => {
    if (!pairing) return;
    const activePairing = pairing;
    function closeOnPageHide() {
      fetch(`${apiBase.replace(/\/$/, '')}/host-devices/app/${activePairing.deviceId}`, {
        method: 'DELETE',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-Host-Device-Secret': activePairing.deviceSecret,
        },
      }).catch(() => undefined);
    }
    window.addEventListener('pagehide', closeOnPageHide);
    return () => window.removeEventListener('pagehide', closeOnPageHide);
  }, [apiBase, pairing]);

  if (device?.displayToken) {
    return <DisplayPage displayToken={device.displayToken} />;
  }

  return (
    <div className="app-shell">
      <div className="sh-card" style={{ maxWidth: 560, textAlign: 'center' }}>
        <h1>Songster Host</h1>
        {error && <div className="sh-error" style={{ marginBottom: 14 }}>{error}</div>}

        {!pairing ? (
          <form className="sh-form" onSubmit={handleCreatePairing}>
            <div className="sh-field" style={{ textAlign: 'left' }}>
              <label htmlFor="songster-url">Songster-URL</label>
              <input
                id="songster-url"
                inputMode="url"
                value={serverUrl}
                onChange={(event) => setServerUrl(event.target.value)}
                placeholder="https://songster.example.de"
              />
            </div>
            <button className="sh-submit" disabled={busy}>
              {busy ? 'Verbinde…' : 'Host-App koppeln'}
            </button>
          </form>
        ) : (
          <>
            <p style={{ color: 'var(--sh-text-dim)', margin: '6px 0 18px' }}>
              Scanne den QR-Code mit deinem Handy und bestätige dieses Hostgerät:
            </p>
            {qrCodeUrl && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                <img src={qrCodeUrl} alt="Host-App verbinden" width={280} height={280} style={{ borderRadius: 8 }} />
              </div>
            )}
            <div
              style={{
                fontFamily: 'var(--sh-font-display)',
                fontSize: 42,
                color: 'var(--adolar-cyan)',
                letterSpacing: 0,
                marginBottom: 12,
              }}
            >
              {pairing.pairingCode}
            </div>
            {authorizeUrl && (
              <p style={{ color: 'var(--sh-text-faint)', fontSize: 12, wordBreak: 'break-all', margin: '0 0 10px' }}>
                {authorizeUrl}
              </p>
            )}
            <p style={{ color: 'var(--sh-text-faint)', fontSize: 13 }}>
              Danach kann der autorisierte Nutzer diese App beim Anlegen eines privaten Tischs als Anzeige auswählen.
            </p>
            {device?.authorized && <div className="sh-info" style={{ marginTop: 14 }}>Verbunden. Warte auf einen privaten Tisch…</div>}
            <button className="admin-btn-sm" style={{ marginTop: 18 }} onClick={handleDisconnect}>
              Trennen
            </button>
          </>
        )}
      </div>
    </div>
  );
}
