/**
 * Zero-knowledge encryption for everything ScanVault stores or uploads.
 *
 * - A random 256-bit AES-GCM *data key* encrypts all records, sync bundles and
 *   encrypted exports.
 * - The data key is wrapped (AES-GCM) by a *key-encryption key* derived from the
 *   user's passphrase with PBKDF2-SHA256. Only the wrapped key and salt are
 *   persisted, so neither the device storage nor the cloud ever sees plaintext
 *   or the passphrase.
 * - Every ciphertext is `version(1) | iv(12) | AES-GCM(ciphertext+tag)`.
 */

const subtle = globalThis.crypto.subtle;
const VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;

export interface WrappedVaultKey {
  v: 1;
  salt: string; // base64
  iterations: number;
  wrappedKey: string; // base64 ciphertext of the raw data key
  /** random id so two devices can tell whether they share the same data key */
  keyId: string;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function deriveKek(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  // Non-extractable once imported: the raw key only exists while wrapping.
  return subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key: CryptoKey, plain: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(1 + iv.length + ct.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(ct, 13);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (data[0] !== VERSION) throw new Error('Unsupported ciphertext version');
  const iv = data.subarray(1, 13);
  const ct = data.subarray(13);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}

export async function decryptJSON<T>(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(key, data))) as T;
}

/** Create a brand-new vault: random data key wrapped by the passphrase. */
export async function createVault(passphrase: string): Promise<{ key: CryptoKey; wrapped: WrappedVaultKey }> {
  const raw = randomBytes(32);
  const wrapped = await wrapRawKey(raw, passphrase, toBase64(randomBytes(9)));
  const key = await importDataKey(raw);
  raw.fill(0);
  return { key, wrapped };
}

async function wrapRawKey(raw: Uint8Array<ArrayBuffer>, passphrase: string, keyId: string): Promise<WrappedVaultKey> {
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, PBKDF2_ITERATIONS);
  const wrappedKey = await encryptBytes(kek, raw);
  return { v: 1, salt: toBase64(salt), iterations: PBKDF2_ITERATIONS, wrappedKey: toBase64(wrappedKey), keyId };
}

/** Unlock a vault. Throws `WrongPassphraseError` when the passphrase does not match. */
export async function unlockVault(passphrase: string, wrapped: WrappedVaultKey): Promise<CryptoKey> {
  const raw = await unwrapRaw(passphrase, wrapped);
  const key = await importDataKey(raw);
  raw.fill(0);
  return key;
}

async function unwrapRaw(passphrase: string, wrapped: WrappedVaultKey): Promise<Uint8Array<ArrayBuffer>> {
  const kek = await deriveKek(passphrase, fromBase64(wrapped.salt), wrapped.iterations);
  try {
    return await decryptBytes(kek, fromBase64(wrapped.wrappedKey));
  } catch {
    throw new WrongPassphraseError();
  }
}

/** Re-wrap the same data key under a new passphrase. */
export async function changePassphrase(oldPass: string, newPass: string, wrapped: WrappedVaultKey): Promise<WrappedVaultKey> {
  const raw = await unwrapRaw(oldPass, wrapped);
  const next = await wrapRawKey(raw, newPass, wrapped.keyId);
  raw.fill(0);
  return next;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Wrong passphrase');
    this.name = 'WrongPassphraseError';
  }
}

/* ---------- Encrypted export files (.svenc) ---------- */

const EXPORT_MAGIC = new TextEncoder().encode('SVENC1');

/** Encrypt a file so it can be stored on any cloud and opened only inside ScanVault. */
export async function encryptFile(key: CryptoKey, name: string, type: string, bytes: Uint8Array<ArrayBuffer>, keyId: string): Promise<Uint8Array<ArrayBuffer>> {
  const header = new TextEncoder().encode(JSON.stringify({ name, type }));
  const payload = new Uint8Array(4 + header.length + bytes.length);
  new DataView(payload.buffer).setUint32(0, header.length);
  payload.set(header, 4);
  payload.set(bytes, 4 + header.length);
  const ct = await encryptBytes(key, payload);
  const kid = new TextEncoder().encode(keyId.padEnd(12, '=').slice(0, 12));
  const out = new Uint8Array(EXPORT_MAGIC.length + kid.length + ct.length);
  out.set(EXPORT_MAGIC, 0);
  out.set(kid, EXPORT_MAGIC.length);
  out.set(ct, EXPORT_MAGIC.length + kid.length);
  return out;
}

export function isEncryptedFile(bytes: Uint8Array): boolean {
  return EXPORT_MAGIC.every((b, i) => bytes[i] === b);
}

export async function decryptFile(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<{ name: string; type: string; bytes: Uint8Array<ArrayBuffer> }> {
  if (!isEncryptedFile(data)) throw new Error('Not a ScanVault encrypted file');
  const plain = await decryptBytes(key, data.subarray(EXPORT_MAGIC.length + 12));
  const headerLen = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + headerLen))) as { name: string; type: string };
  return { ...header, bytes: plain.slice(4 + headerLen) };
}
