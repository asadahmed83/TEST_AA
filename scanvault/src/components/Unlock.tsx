import { useState } from 'react';
import { WrongPassphraseError } from '../lib/crypto';
import { providers } from '../lib/cloud';
import { fetchRemoteVault } from '../lib/sync';
import { setPrefs } from '../lib/prefs';
import { adoptVaultKey, hasVault, setupVault, unlock } from '../lib/vault';
import type { CloudProviderId } from '../types';

function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

export function Unlock({ onUnlocked }: { onUnlocked: (opts?: { joined?: boolean }) => void }) {
  const existing = hasVault();
  const [mode, setMode] = useState<'unlock' | 'create' | 'join'>(existing ? 'unlock' : 'create');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joinProvider, setJoinProvider] = useState<CloudProviderId>('gdrive');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof WrongPassphraseError ? 'That passphrase is not correct.' : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'unlock') return run(async () => (await unlock(pass), onUnlocked()));
    if (mode === 'create') {
      if (pass.length < 8) return setError('Use at least 8 characters.');
      if (pass !== confirm) return setError('Passphrases do not match.');
      return run(async () => (await setupVault(pass), onUnlocked()));
    }
    return run(async () => {
      const p = providers[joinProvider];
      if (!p.isConnected()) await p.connect();
      const remote = await fetchRemoteVault(p);
      if (!remote) throw new Error(`No ScanVault sync data found in ${p.label}. Create a new vault instead.`);
      // Unwraps with the passphrase used on the other device; throws if wrong.
      await adoptVaultKey(pass, remote);
      setPrefs({ syncProvider: joinProvider });
      onUnlocked({ joined: true });
    });
  };

  const s = strength(pass);

  return (
    <div className="unlock">
      <div className="unlock-card">
        <div className="unlock-logo">🔐</div>
        <h1>ScanVault</h1>
        <p className="muted">
          {mode === 'unlock'
            ? 'Enter your passphrase to decrypt your vault.'
            : mode === 'create'
              ? 'Create a passphrase. It encrypts every scan, text and chat with AES-256 before anything is stored or uploaded.'
              : 'Use the same passphrase as on your other device to join its encrypted vault.'}
        </p>

        {mode === 'join' && (
          <div className="segmented">
            {(['gdrive', 'onedrive'] as const).map((id) => (
              <button type="button" key={id} className={joinProvider === id ? 'active' : ''} onClick={() => setJoinProvider(id)}>
                {providers[id].icon} {providers[id].label}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit}>
          <input
            type="password"
            autoFocus
            autoComplete={mode === 'create' ? 'new-password' : 'current-password'}
            placeholder="Passphrase"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            aria-label="Passphrase"
          />
          {mode === 'create' && (
            <>
              <div className={`strength s${s}`} aria-label={`Strength ${s} of 4`}>
                <span />
                <span />
                <span />
                <span />
              </div>
              <input
                type="password"
                autoComplete="new-password"
                placeholder="Confirm passphrase"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-label="Confirm passphrase"
              />
              <p className="hint">⚠️ Zero-knowledge: nobody (including us) can recover this passphrase. Write it down.</p>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <button className="btn primary block" disabled={busy || !pass}>
            {busy ? 'Deriving key…' : mode === 'unlock' ? 'Unlock' : mode === 'create' ? 'Create encrypted vault' : 'Join vault'}
          </button>
        </form>

        {!existing && (
          <button className="link" onClick={() => (setMode(mode === 'join' ? 'create' : 'join'), setError(''))}>
            {mode === 'join' ? '← Create a new vault instead' : 'Already use ScanVault on another device? Join it'}
          </button>
        )}
        <p className="fineprint">PBKDF2-SHA256 · 600k iterations · AES-256-GCM</p>
      </div>
    </div>
  );
}
