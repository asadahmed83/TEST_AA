import { NeedsAuthError, splitPath, type CloudFile, type CloudProvider } from './types';

/**
 * Google Drive via Google Identity Services (OAuth token model) + Drive REST v3.
 * Uses the `drive.file` scope: the app can only see files and folders it created,
 * which is all it needs for saving scans and syncing.
 */

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SESSION_KEY = 'scanvault.gdrive.token';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(cfg: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: (e: { message?: string }) => void }): {
            requestAccessToken(o?: { prompt?: string }): void;
          };
          revoke(token: string, cb: () => void): void;
        };
      };
    };
  }
}

function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

export function googleDriveProvider(clientId: string): CloudProvider {
  let token: { value: string; exp: number; email?: string } | null = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
  const folderCache = new Map<string, string>();

  const valid = () => !!token && token.exp > Date.now() + 30_000;

  async function requestToken(prompt: '' | 'consent'): Promise<void> {
    await loadGis();
    await new Promise<void>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (r) => {
          if (r.error || !r.access_token) return reject(new Error(r.error || 'Google sign-in failed'));
          token = { value: r.access_token, exp: Date.now() + r.expires_in * 1000 };
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(token));
          resolve();
        },
        error_callback: (e) => reject(new Error(e.message || 'Google sign-in was closed')),
      });
      client.requestAccessToken({ prompt });
    });
    try {
      const about = await api<{ user: { emailAddress: string } }>(`${API}/about?fields=user(emailAddress)`);
      token!.email = about.user.emailAddress;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(token));
    } catch {
      /* account label is cosmetic */
    }
  }

  async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
    if (!valid()) {
      if (localStorage.getItem('scanvault.gdrive.connected') !== '1') throw new NeedsAuthError('Google Drive');
      try {
        await requestToken('');
      } catch {
        throw new NeedsAuthError('Google Drive');
      }
    }
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token!.value}` } });
    if (res.status === 401) {
      token = null;
      throw new NeedsAuthError('Google Drive');
    }
    if (!res.ok) throw new Error(`Google Drive error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    if (init.method === 'DELETE') return undefined as T;
    return (url.includes('alt=media') ? res.blob() : res.json()) as Promise<T>;
  }

  const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  /** Resolve (and create if needed) a folder path like "Scans/2026". */
  async function folderId(path: string, create = true): Promise<string | null> {
    const parts = splitPath(path);
    let parent = 'root';
    let soFar = '';
    for (const name of parts) {
      soFar += `/${name}`;
      const cached = folderCache.get(soFar);
      if (cached) {
        parent = cached;
        continue;
      }
      const found = await api<{ files: { id: string }[] }>(
        `${API}/files?q=${encodeURIComponent(`name='${q(name)}' and mimeType='${FOLDER_MIME}' and '${parent}' in parents and trashed=false`)}&fields=files(id)&spaces=drive`,
      );
      let id = found.files[0]?.id;
      if (!id) {
        if (!create) return null;
        id = (
          await api<{ id: string }>(`${API}/files?fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
          })
        ).id;
      }
      folderCache.set(soFar, id);
      parent = id;
    }
    return parent;
  }

  async function listIn(parent: string): Promise<(CloudFile & { mime: string })[]> {
    const out: (CloudFile & { mime: string })[] = [];
    let pageToken = '';
    do {
      const r = await api<{ files: { id: string; name: string; modifiedTime: string; mimeType: string }[]; nextPageToken?: string }>(
        `${API}/files?q=${encodeURIComponent(`'${parent}' in parents and trashed=false`)}&fields=nextPageToken,files(id,name,modifiedTime,mimeType)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      out.push(...r.files.map((f) => ({ id: f.id, name: f.name, modified: Date.parse(f.modifiedTime), mime: f.mimeType })));
      pageToken = r.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  return {
    id: 'gdrive',
    label: 'Google Drive',
    icon: '🟢',
    demo: false,
    supportsSync: true,
    isConnected: () => localStorage.getItem('scanvault.gdrive.connected') === '1',
    account: () => token?.email ?? null,
    async connect() {
      await requestToken('consent');
      localStorage.setItem('scanvault.gdrive.connected', '1');
    },
    async disconnect() {
      if (token) window.google?.accounts.oauth2.revoke(token.value, () => {});
      token = null;
      folderCache.clear();
      sessionStorage.removeItem(SESSION_KEY);
      localStorage.removeItem('scanvault.gdrive.connected');
    },
    async upload(folder, name, data, opts) {
      const parent = (await folderId(folder))!;
      const existing = opts?.overwrite ? (await listIn(parent)).find((f) => f.name === name) : undefined;
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(existing ? { name } : { name, parents: [parent] })], { type: 'application/json' }));
      form.append('file', data);
      const r = await api<{ id: string; name: string; webViewLink?: string }>(
        existing
          ? `${UPLOAD}/files/${existing.id}?uploadType=multipart&fields=id,name,webViewLink`
          : `${UPLOAD}/files?uploadType=multipart&fields=id,name,webViewLink`,
        { method: existing ? 'PATCH' : 'POST', body: form },
      );
      return { id: r.id, name: r.name, webUrl: r.webViewLink };
    },
    async list(folder) {
      const parent = await folderId(folder, false);
      if (!parent) return [];
      return (await listIn(parent)).filter((f) => f.mime !== FOLDER_MIME);
    },
    async download(_folder, file) {
      return api<Blob>(`${API}/files/${file.id}?alt=media`);
    },
    async remove(_folder, file) {
      await api(`${API}/files/${file.id}`, { method: 'DELETE' });
    },
  };
}
