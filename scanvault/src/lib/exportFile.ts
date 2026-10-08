import { encryptFile } from './crypto';
import { dataUrlToBytes } from './image';
import { buildPdf } from './pdf';
import { getStoredVaultKey, key } from './vault';
import type { DocContent, DocMeta } from '../types';

/** The shareable file for a scan: JPEG for single images/objects, PDF otherwise. */
export function exportKind(meta: DocMeta): { ext: 'jpg' | 'pdf'; mime: string } {
  const single = meta.pageCount === 1 && (meta.mode === 'image' || meta.mode === 'object');
  return single ? { ext: 'jpg', mime: 'image/jpeg' } : { ext: 'pdf', mime: 'application/pdf' };
}

export function buildExport(meta: DocMeta, content: DocContent, baseName = meta.name): File {
  const { ext, mime } = exportKind(meta);
  const name = `${baseName}.${ext}`;
  if (ext === 'jpg') return new File([dataUrlToBytes(content.pages[0].dataUrl)], name, { type: mime });
  return new File([buildPdf(content.pages, baseName)], name, { type: mime });
}

/** Encrypted variant for uploads: only ScanVault (with the vault passphrase) can open it. */
export async function buildEncryptedExport(meta: DocMeta, content: DocContent, baseName = meta.name): Promise<File> {
  const plain = buildExport(meta, content, baseName);
  const bytes = await encryptFile(key(), plain.name, plain.type, new Uint8Array(await plain.arrayBuffer()), getStoredVaultKey()!.keyId);
  return new File([bytes], `${plain.name}.svenc`, { type: 'application/octet-stream' });
}
