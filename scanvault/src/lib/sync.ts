import { decryptJSON, encryptJSON, type WrappedVaultKey } from './crypto';
import { dbDelete } from './db';
import { providers, type CloudFile, type CloudProvider } from './cloud';
import { getPrefs, setPrefs } from './prefs';
import { getChat, getContent, getStoredVaultKey, key, listMeta, putChat, putContent, putMeta } from './vault';
import type { ChatState, DocContent, DocMeta } from '../types';

/**
 * Cross-device sync through the user's own cloud. Each document is uploaded as a
 * single AES-GCM encrypted bundle named `<docId>~<updatedAt>.svb` inside
 * `ScanVault/.sync`; the newest version wins per document and deletions travel
 * as tombstones. The cloud also stores the *wrapped* vault key (vault.json), so
 * a second device can join with the same passphrase. The cloud never sees
 * plaintext or the passphrase.
 */

export const SYNC_FOLDER = 'ScanVault/.sync';
const VAULT_FILE = 'vault.json';

interface Bundle {
  meta: DocMeta;
  content?: DocContent;
  chat?: ChatState;
}

export class VaultMismatchError extends Error {
  remote: WrappedVaultKey;
  constructor(remote: WrappedVaultKey) {
    super('This cloud already holds a ScanVault created on another device.');
    this.remote = remote;
    this.name = 'VaultMismatchError';
  }
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  at: number;
}

function parseName(f: CloudFile): { id: string; updatedAt: number } | null {
  const m = f.name.match(/^([\w-]+)~(\d+)\.svb$/);
  return m ? { id: m[1], updatedAt: Number(m[2]) } : null;
}

/** Read the vault key stored in the cloud, if any (used to join from a new device). */
export async function fetchRemoteVault(provider: CloudProvider): Promise<WrappedVaultKey | null> {
  const file = (await provider.list(SYNC_FOLDER)).find((f) => f.name === VAULT_FILE);
  if (!file) return null;
  return JSON.parse(await (await provider.download(SYNC_FOLDER, file)).text()) as WrappedVaultKey;
}

let running: Promise<SyncResult> | null = null;

export function syncNow(provider?: CloudProvider): Promise<SyncResult> {
  const p = provider ?? (getPrefs().syncProvider ? providers[getPrefs().syncProvider!] : null);
  if (!p) return Promise.reject(new Error('Choose a cloud for sync in Settings first.'));
  if (!running) running = doSync(p).finally(() => (running = null));
  return running;
}

async function doSync(provider: CloudProvider): Promise<SyncResult> {
  if (!provider.supportsSync) throw new Error(`${provider.label} can't be used for sync.`);
  if (!provider.isConnected()) throw new Error(`Connect ${provider.label} first.`);
  const local = getStoredVaultKey()!;
  const files = await provider.list(SYNC_FOLDER);

  // 1. Make sure both sides use the same vault key.
  const vaultFile = files.find((f) => f.name === VAULT_FILE);
  if (!vaultFile) {
    await provider.upload(SYNC_FOLDER, VAULT_FILE, new Blob([JSON.stringify(local)], { type: 'application/json' }), { overwrite: true });
  } else {
    const remote = JSON.parse(await (await provider.download(SYNC_FOLDER, vaultFile)).text()) as WrappedVaultKey;
    // Same keyId = same data key, even if each device wraps it with its own passphrase.
    if (remote.keyId !== local.keyId) throw new VaultMismatchError(remote);
  }

  // 2. Index remote bundles (newest per document), cleaning up stale versions.
  const remote = new Map<string, { file: CloudFile; updatedAt: number }>();
  for (const f of files) {
    const p = parseName(f);
    if (!p) continue;
    const cur = remote.get(p.id);
    if (!cur || p.updatedAt > cur.updatedAt) {
      if (cur) await provider.remove(SYNC_FOLDER, cur.file).catch(() => {});
      remote.set(p.id, { file: f, updatedAt: p.updatedAt });
    } else {
      await provider.remove(SYNC_FOLDER, f).catch(() => {});
    }
  }

  const locals = new Map((await listMeta(true)).map((m) => [m.id, m]));
  let pushed = 0;
  let pulled = 0;

  // 3. Pull newer remote versions.
  for (const [id, r] of remote) {
    const l = locals.get(id);
    if (l && l.updatedAt >= r.updatedAt) continue;
    const ct = new Uint8Array(await (await provider.download(SYNC_FOLDER, r.file)).arrayBuffer());
    const bundle = await decryptJSON<Bundle>(key(), ct);
    if (bundle.meta.deleted) {
      await dbDelete('content', id);
      await dbDelete('chats', id);
    } else {
      if (bundle.content) await putContent(id, bundle.content);
      if (bundle.chat) await putChat(id, bundle.chat);
    }
    await putMeta(bundle.meta);
    pulled++;
  }

  // 4. Push local changes.
  for (const [id, l] of locals) {
    const r = remote.get(id);
    if (r && r.updatedAt >= l.updatedAt) continue;
    const bundle: Bundle = l.deleted ? { meta: l } : { meta: l, content: await getContent(id), chat: await getChat(id) };
    const ct = await encryptJSON(key(), bundle);
    await provider.upload(SYNC_FOLDER, `${id}~${l.updatedAt}.svb`, new Blob([ct], { type: 'application/octet-stream' }), { overwrite: true });
    if (r) await provider.remove(SYNC_FOLDER, r.file).catch(() => {});
    pushed++;
  }

  const at = Date.now();
  setPrefs({ lastSyncAt: at });
  return { pushed, pulled, at };
}
