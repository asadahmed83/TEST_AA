import { useEffect, useState } from 'react';
import { changePassphrase, WrongPassphraseError } from '../lib/crypto';
import { providerList, providers } from '../lib/cloud';
import { claudeAvailable } from '../lib/ai';
import { getPrefs, setPrefs, type Prefs } from '../lib/prefs';
import { syncNow, VaultMismatchError } from '../lib/sync';
import { adoptVaultKey, getStoredVaultKey, replaceWrappedKey } from '../lib/vault';
import type { CloudProviderId } from '../types';
import { formatDate, Modal, TopBar, useToast } from './ui';

export function Settings({ onBack, onLock, onSynced }: { onBack: () => void; onLock: () => void; onSynced: () => void }) {
  const [prefs, setP] = useState<Prefs>(getPrefs());
  const [, force] = useState(0);
  const [claudeOk, setClaudeOk] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [mismatch, setMismatch] = useState<VaultMismatchError | null>(null);
  const [pwModal, setPwModal] = useState(false);
  const toast = useToast();

  useEffect(() => {
    claudeAvailable().then(setClaudeOk);
  }, []);

  const update = (patch: Partial<Prefs>) => setP(setPrefs(patch));

  const connect = async (id: CloudProviderId) => {
    try {
      await providers[id].connect();
      toast(`${providers[id].label} connected`, 'success');
      if (!prefs.syncProvider && providers[id].supportsSync) update({ syncProvider: id });
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    force((n) => n + 1);
  };

  const disconnect = async (id: CloudProviderId) => {
    await providers[id].disconnect();
    if (prefs.syncProvider === id) update({ syncProvider: null });
    force((n) => n + 1);
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      const r = await syncNow();
      toast(`Synced · ${r.pulled} downloaded, ${r.pushed} uploaded`, 'success');
      setP(getPrefs());
      onSynced();
    } catch (e) {
      if (e instanceof VaultMismatchError) setMismatch(e);
      else toast((e as Error).message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="screen">
      <TopBar title="Settings" onBack={onBack} />
      <main className="content settings">
        <section className="card">
          <h3>☁️ Cloud accounts</h3>
          {providerList()
            .filter((p) => p.id !== 'device')
            .map((p) => (
              <div key={p.id} className="setting-row">
                <span>
                  {p.icon} <strong>{p.label}</strong> {p.demo && <small className="badge">demo</small>}
                  <br />
                  <small className="muted">
                    {p.isConnected() ? `Connected${p.account() ? ` · ${p.account()}` : ''}` : 'Not connected'}
                    {p.demo && ' · set the client ID in .env to use the real service'}
                  </small>
                  {prefs.folders[p.id] && (
                    <>
                      <br />
                      <small className="muted">Last folder: {prefs.folders[p.id]}</small>
                    </>
                  )}
                </span>
                {p.isConnected() ? (
                  <button className="btn sm" onClick={() => disconnect(p.id)}>
                    Disconnect
                  </button>
                ) : (
                  <button className="btn sm primary" onClick={() => connect(p.id)}>
                    Connect
                  </button>
                )}
              </div>
            ))}
        </section>

        <section className="card">
          <h3>🔄 Sync across devices</h3>
          <p className="muted small">Your scans, extracted text and chats are uploaded as encrypted bundles to a hidden ScanVault/.sync folder. Sign in on another device with the same passphrase to get them there.</p>
          <label className="field">
            <span>Sync through</span>
            <select value={prefs.syncProvider ?? ''} onChange={(e) => update({ syncProvider: (e.target.value || null) as CloudProviderId | null })}>
              <option value="">Off</option>
              {providerList()
                .filter((p) => p.supportsSync)
                .map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.isConnected()}>
                    {p.label}
                    {p.demo ? ' (demo — this device only)' : ''}
                    {p.isConnected() ? '' : ' — connect first'}
                  </option>
                ))}
            </select>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={prefs.autoSync} onChange={(e) => update({ autoSync: e.target.checked })} />
            <span>
              <strong>Sync automatically</strong>
              <small>On unlock, after each save and every few minutes.</small>
            </span>
          </label>
          <div className="setting-row">
            <small className="muted">{prefs.lastSyncAt ? `Last synced ${formatDate(prefs.lastSyncAt)}` : 'Never synced'}</small>
            <button className="btn sm primary" disabled={!prefs.syncProvider || syncing} onClick={runSync}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        </section>

        <section className="card">
          <h3>🧠 AI assistant</h3>
          <div className="segmented">
            <button className={prefs.aiEngine === 'local' ? 'active' : ''} onClick={() => update({ aiEngine: 'local' })}>
              📱 On-device
            </button>
            <button className={prefs.aiEngine === 'claude' ? 'active' : ''} disabled={claudeOk === false} onClick={() => update({ aiEngine: 'claude' })}>
              ✨ Claude
            </button>
          </div>
          <p className="muted small">
            {prefs.aiEngine === 'local'
              ? 'Private: answers and summaries are extracted from the text on this device. Nothing is sent anywhere.'
              : 'Smarter answers, summaries, naming and object recognition. Document text (and images for object analysis) is sent to your ScanVault AI server, which calls Claude.'}
            {claudeOk === false && ' Claude is unavailable — start the AI server (npm run server) with ANTHROPIC_API_KEY set.'}
          </p>
        </section>

        <section className="card">
          <h3>🔐 Security</h3>
          <label className="toggle">
            <input type="checkbox" checked={prefs.encryptUploads} onChange={(e) => update({ encryptUploads: e.target.checked })} />
            <span>
              <strong>Encrypt uploads by default</strong>
              <small>Uploaded files become .svenc files only ScanVault can open.</small>
            </span>
          </label>
          <div className="setting-row">
            <small className="muted">Vault key id {getStoredVaultKey()?.keyId}</small>
            <span>
              <button className="btn sm" onClick={() => setPwModal(true)}>
                Change passphrase
              </button>{' '}
              <button className="btn sm" onClick={onLock}>
                🔒 Lock now
              </button>
            </span>
          </div>
        </section>
      </main>

      {pwModal && <PassphraseModal onClose={() => setPwModal(false)} />}
      {mismatch && <MismatchModal err={mismatch} onClose={() => setMismatch(null)} onJoined={() => (setMismatch(null), runSync())} />}
    </div>
  );
}

function PassphraseModal({ onClose }: { onClose: () => void }) {
  const [oldP, setOld] = useState('');
  const [newP, setNew] = useState('');
  const [err, setErr] = useState('');
  const toast = useToast();
  return (
    <Modal title="Change passphrase" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (newP.length < 8) return setErr('Use at least 8 characters.');
          try {
            replaceWrappedKey(await changePassphrase(oldP, newP, getStoredVaultKey()!));
            toast('Passphrase changed on this device', 'success');
            onClose();
          } catch (x) {
            setErr(x instanceof WrongPassphraseError ? 'Current passphrase is wrong.' : (x as Error).message);
          }
        }}
      >
        <input type="password" placeholder="Current passphrase" value={oldP} onChange={(e) => setOld(e.target.value)} />
        <input type="password" placeholder="New passphrase" value={newP} onChange={(e) => setNew(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <p className="hint">Other devices keep their own passphrase. The data key itself doesn't change, so nothing needs re-encrypting.</p>
        <button className="btn primary block">Change</button>
      </form>
    </Modal>
  );
}

function MismatchModal({ err, onClose, onJoined }: { err: VaultMismatchError; onClose: () => void; onJoined: () => void }) {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <Modal title="Join your other device's vault?" onClose={onClose}>
      <p>
        {err.message} To sync, this device will switch to that vault's key and re-encrypt its local scans with it. Enter the passphrase you use on the
        other device — from then on it also unlocks this device.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await adoptVaultKey(pass, err.remote);
            onJoined();
          } catch (x) {
            setMsg(x instanceof WrongPassphraseError ? 'That passphrase does not open the cloud vault.' : (x as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input type="password" autoFocus placeholder="Other device's passphrase" value={pass} onChange={(e) => setPass(e.target.value)} />
        {msg && <p className="error">{msg}</p>}
        <button className="btn primary block" disabled={busy || !pass}>
          {busy ? 'Re-encrypting…' : 'Join & sync'}
        </button>
      </form>
    </Modal>
  );
}
