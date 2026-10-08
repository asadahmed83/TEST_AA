import { providers } from './cloud';
import { buildEncryptedExport, buildExport } from './exportFile';
import { getPrefs, normalizeFolder, rememberSave, setPrefs, DEFAULT_FOLDER } from './prefs';
import { getMeta, putMeta } from './vault';
import type { CloudProviderId, DocContent, DocMeta, SavedLocation } from '../types';

/**
 * Upload a document's file to a cloud/device location, record where it went on
 * the document, and remember the folder for next time.
 */
export async function uploadDocument(meta: DocMeta, content: DocContent, providerId: CloudProviderId, folder: string, encrypt: boolean): Promise<SavedLocation> {
  const provider = providers[providerId];
  const clean = normalizeFolder(folder) || DEFAULT_FOLDER;
  if (!provider.isConnected()) await provider.connect();
  const file = encrypt ? await buildEncryptedExport(meta, content) : buildExport(meta, content);
  const r = await provider.upload(clean, file.name, file);
  const loc: SavedLocation = { provider: providerId, folder: clean, fileName: r.name, fileId: r.id, webUrl: r.webUrl, encrypted: encrypt, at: Date.now() };
  const latest = (await getMeta(meta.id)) ?? meta;
  await putMeta({ ...latest, savedTo: [...latest.savedTo, loc], updatedAt: Date.now() });
  rememberSave(providerId, clean);
  // The first cloud the user saves to also becomes the sync cloud, so other devices
  // get their scans without extra setup (changeable in Settings).
  setPrefs({ encryptUploads: encrypt, ...(!getPrefs().syncProvider && provider.supportsSync ? { syncProvider: providerId } : {}) });
  return loc;
}
