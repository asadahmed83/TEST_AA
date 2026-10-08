import { describe, expect, it } from 'vitest';
import {
  changePassphrase,
  createVault,
  decryptFile,
  decryptJSON,
  encryptFile,
  encryptJSON,
  isEncryptedFile,
  unlockVault,
  WrongPassphraseError,
} from '../src/lib/crypto';

describe('vault encryption', () => {
  it('round-trips records and never stores plaintext', async () => {
    const { key, wrapped } = await createVault('correct horse battery');
    const ct = await encryptJSON(key, { secret: 'passport P1234567' });
    expect(new TextDecoder().decode(ct)).not.toContain('P1234567');
    const again = await unlockVault('correct horse battery', wrapped);
    expect(await decryptJSON(again, ct)).toEqual({ secret: 'passport P1234567' });
  });

  it('rejects a wrong passphrase', async () => {
    const { wrapped } = await createVault('right passphrase');
    await expect(unlockVault('wrong passphrase', wrapped)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('detects tampering (AES-GCM authentication)', async () => {
    const { key } = await createVault('tamper test pass');
    const ct = await encryptJSON(key, { a: 1 });
    ct[ct.length - 1] ^= 1;
    await expect(decryptJSON(key, ct)).rejects.toThrow();
  });

  it('changing passphrase keeps the same data key', async () => {
    const { key, wrapped } = await createVault('old passphrase');
    const ct = await encryptJSON(key, 42);
    const rewrapped = await changePassphrase('old passphrase', 'new passphrase', wrapped);
    expect(rewrapped.keyId).toBe(wrapped.keyId);
    expect(await decryptJSON(await unlockVault('new passphrase', rewrapped), ct)).toBe(42);
  });

  it('encrypted export files carry their name and type', async () => {
    const { key, wrapped } = await createVault('export pass 123');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const enc = await encryptFile(key, 'scan.pdf', 'application/pdf', bytes, wrapped.keyId);
    expect(isEncryptedFile(enc)).toBe(true);
    const out = await decryptFile(key, enc);
    expect(out.name).toBe('scan.pdf');
    expect(out.type).toBe('application/pdf');
    expect([...out.bytes]).toEqual([1, 2, 3, 4, 5]);
  });
});
