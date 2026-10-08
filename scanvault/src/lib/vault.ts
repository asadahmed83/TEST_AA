import {
  createVault,
  decryptBytes,
  decryptJSON,
  encryptBytes,
  encryptJSON,
  unlockVault,
  type WrappedVaultKey,
} from './crypto';
import { dbEntries, dbGet, dbPut, dbDelete, type StoreName } from './db';
import type { ChatState, DocContent, DocMeta } from '../types';

/**
 * The unlocked vault: holds the in-memory data key and reads/writes encrypted
 * records. The key is never persisted in plaintext.
 */

const WRAPPED_KEY_STORAGE = 'scanvault.vaultKey';

let dataKey: CryptoKey | null = null;
let wrappedCache: WrappedVaultKey | null = null;

export function getStoredVaultKey(): WrappedVaultKey | null {
  if (wrappedCache) return wrappedCache;
  const raw = localStorage.getItem(WRAPPED_KEY_STORAGE);
  wrappedCache = raw ? (JSON.parse(raw) as WrappedVaultKey) : null;
  return wrappedCache;
}

function storeVaultKey(w: WrappedVaultKey) {
  wrappedCache = w;
  localStorage.setItem(WRAPPED_KEY_STORAGE, JSON.stringify(w));
}

export function hasVault() {
  return getStoredVaultKey() !== null;
}

export function isUnlocked() {
  return dataKey !== null;
}

export function lock() {
  dataKey = null;
}

export function key(): CryptoKey {
  if (!dataKey) throw new Error('Vault is locked');
  return dataKey;
}

export async function setupVault(passphrase: string) {
  const { key: k, wrapped } = await createVault(passphrase);
  storeVaultKey(wrapped);
  dataKey = k;
}

export async function unlock(passphrase: string) {
  const w = getStoredVaultKey();
  if (!w) throw new Error('No vault on this device');
  dataKey = await unlockVault(passphrase, w);
}

/**
 * Switch this device to another wrapped key (e.g. the one stored in the cloud by
 * another device) and re-encrypt every local record with it.
 */
export async function adoptVaultKey(passphrase: string, next: WrappedVaultKey) {
  const nextKey = await unlockVault(passphrase, next);
  const prevKey = dataKey;
  if (prevKey) {
    for (const store of ['meta', 'content', 'chats'] as StoreName[]) {
      for (const [id, ct] of await dbEntries<Uint8Array<ArrayBuffer>>(store)) {
        const plain = await decryptBytes(prevKey, ct);
        await dbPut(store, id, await encryptBytes(nextKey, plain));
      }
    }
  }
  storeVaultKey(next);
  dataKey = nextKey;
}

export function replaceWrappedKey(next: WrappedVaultKey) {
  storeVaultKey(next);
}

/* ---------- Encrypted record access ---------- */

async function put(store: StoreName, id: string, value: unknown) {
  await dbPut(store, id, await encryptJSON(key(), value));
}

async function get<T>(store: StoreName, id: string): Promise<T | undefined> {
  const ct = await dbGet<Uint8Array<ArrayBuffer>>(store, id);
  return ct ? decryptJSON<T>(key(), ct) : undefined;
}

export async function listMeta(includeDeleted = false): Promise<DocMeta[]> {
  const all = await Promise.all(
    (await dbEntries<Uint8Array<ArrayBuffer>>('meta')).map(([, ct]) => decryptJSON<DocMeta>(key(), ct)),
  );
  return all.filter((m) => includeDeleted || !m.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getMeta = (id: string) => get<DocMeta>('meta', id);
export const getContent = (id: string) => get<DocContent>('content', id);
export const getChat = (id: string) => get<ChatState>('chats', id);
export const putMeta = (m: DocMeta) => put('meta', m.id, m);
export const putContent = (id: string, c: DocContent) => put('content', id, c);
export const putChat = (id: string, c: ChatState) => put('chats', id, c);

export async function saveDocument(meta: DocMeta, content: DocContent, chat?: ChatState) {
  await putContent(meta.id, content);
  if (chat) await putChat(meta.id, chat);
  await putMeta(meta);
}

/** Soft-delete: keep a tombstone so sync can propagate the deletion. */
export async function deleteDocument(id: string) {
  const meta = await getMeta(id);
  if (meta) await putMeta({ ...meta, deleted: true, updatedAt: Date.now(), thumbnail: '', searchText: '', keywords: [] });
  await dbDelete('content', id);
  await dbDelete('chats', id);
}

/** Bump updatedAt so the next sync pushes the change. */
export async function touch(id: string) {
  const meta = await getMeta(id);
  if (meta) await putMeta({ ...meta, updatedAt: Date.now() });
}
