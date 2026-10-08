import { Capacitor } from '@capacitor/core';
import { toBase64 } from './crypto';

/** Thin layer over Capacitor plugins with web fallbacks. */

export const isNative = () => Capacitor.isNativePlatform();

export async function blobToBase64(blob: Blob): Promise<string> {
  return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

/** Save to the device: Documents/<folder>/<name> on Android/iOS, a download on the web. */
export async function saveToDevice(folder: string, name: string, blob: Blob): Promise<{ path: string }> {
  if (isNative()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = `${folder}/${name}`;
    const r = await Filesystem.writeFile({ path, data: await blobToBase64(blob), directory: Directory.Documents, recursive: true });
    return { path: r.uri };
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { path: `Downloads/${name}` };
}

export async function openExternal(url: string) {
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

export function googleSearchUrl(text: string) {
  return `https://www.google.com/search?q=${encodeURIComponent(text.trim().slice(0, 500))}`;
}

export const searchGoogle = (text: string) => openExternal(googleSearchUrl(text));

export type ShareResult = 'shared' | 'cancelled' | 'unsupported';

/**
 * Open the system share sheet with the file attached (Gmail, WhatsApp, Messages,
 * Drive, Bluetooth…). Returns 'unsupported' when the platform can't share files.
 */
export async function shareFile(file: File, text?: string): Promise<ShareResult> {
  try {
    if (isNative()) {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const written = await Filesystem.writeFile({ path: `share/${file.name}`, data: await blobToBase64(file), directory: Directory.Cache, recursive: true });
      await Share.share({ title: file.name, text, files: [written.uri], dialogTitle: 'Share scan' });
      return 'shared';
    }
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: file.name, text });
      return 'shared';
    }
    return 'unsupported';
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if ((err as Error).name === 'AbortError' || /cancel/i.test(msg)) return 'cancelled';
    throw err;
  }
}

/** Deep links used when the browser can't attach files: these share text/links only. */
export function shareLinks(subject: string, body: string) {
  const s = encodeURIComponent(subject);
  const b = encodeURIComponent(body);
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&su=${s}&body=${b}`,
    email: `mailto:?subject=${s}&body=${b}`,
    whatsapp: `https://wa.me/?text=${b}`,
    sms: `sms:?&body=${b}`,
  };
}
