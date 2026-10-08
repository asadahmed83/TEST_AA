import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { NeedsAuthError, splitPath, type CloudFile, type CloudProvider } from './types';

/** OneDrive (personal or work/school) through MSAL.js + Microsoft Graph. */

const SCOPES = ['Files.ReadWrite', 'User.Read'];
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';
const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;

export function oneDriveProvider(clientId: string): CloudProvider {
  let msal: PublicClientApplication | null = null;
  let account: AccountInfo | null = null;

  async function app(): Promise<PublicClientApplication> {
    if (!msal) {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      msal = new PublicClientApplication({
        auth: { clientId, authority: 'https://login.microsoftonline.com/common', redirectUri: window.location.origin },
        cache: { cacheLocation: 'localStorage' },
      });
      await msal.initialize();
      account = msal.getAllAccounts()[0] ?? null;
    }
    return msal;
  }

  async function token(): Promise<string> {
    const m = await app();
    if (!account) throw new NeedsAuthError('OneDrive');
    try {
      return (await m.acquireTokenSilent({ scopes: SCOPES, account })).accessToken;
    } catch {
      try {
        return (await m.acquireTokenPopup({ scopes: SCOPES, account })).accessToken;
      } catch {
        throw new NeedsAuthError('OneDrive');
      }
    }
  }

  async function graph(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await token()}` } });
    if (res.status === 401) throw new NeedsAuthError('OneDrive');
    return res;
  }

  const pathOf = (folder: string, name?: string) =>
    [...splitPath(folder), ...(name ? [name] : [])].map(encodeURIComponent).join('/');

  return {
    id: 'onedrive',
    label: 'OneDrive',
    icon: '🔵',
    demo: false,
    supportsSync: true,
    isConnected: () => localStorage.getItem('scanvault.onedrive.connected') === '1',
    account: () => account?.username ?? null,
    async connect() {
      const m = await app();
      const r = await m.loginPopup({ scopes: SCOPES, prompt: 'select_account' });
      account = r.account;
      m.setActiveAccount(account);
      localStorage.setItem('scanvault.onedrive.connected', '1');
    },
    async disconnect() {
      const m = await app();
      if (account) await m.logoutPopup({ account }).catch(() => m.clearCache());
      account = null;
      localStorage.removeItem('scanvault.onedrive.connected');
    },
    async upload(folder, name, data, opts) {
      const conflict = opts?.overwrite ? 'replace' : 'rename';
      let item: { id: string; name: string; webUrl: string };
      if (data.size <= SIMPLE_UPLOAD_MAX) {
        // Simple upload; Graph creates any missing folders in the path.
        const res = await graph(`${GRAPH}/root:/${pathOf(folder, name)}:/content?@microsoft.graph.conflictBehavior=${conflict}`, {
          method: 'PUT',
          headers: { 'Content-Type': data.type || 'application/octet-stream' },
          body: data,
        });
        if (!res.ok) throw new Error(`OneDrive upload failed (${res.status})`);
        item = await res.json();
      } else {
        // Large files go through an upload session in 5 MiB chunks (multiple of 320 KiB).
        const s = await graph(`${GRAPH}/root:/${pathOf(folder, name)}:/createUploadSession`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': conflict } }),
        });
        if (!s.ok) throw new Error(`OneDrive upload failed (${s.status})`);
        const { uploadUrl } = (await s.json()) as { uploadUrl: string };
        const chunk = 320 * 1024 * 16;
        let res: Response | null = null;
        for (let start = 0; start < data.size; start += chunk) {
          const end = Math.min(start + chunk, data.size);
          res = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Range': `bytes ${start}-${end - 1}/${data.size}` },
            body: data.slice(start, end),
          });
          if (!res.ok && res.status !== 202) throw new Error(`OneDrive upload failed (${res.status})`);
        }
        item = await res!.json();
      }
      return { id: item.id, name: item.name, webUrl: item.webUrl };
    },
    async list(folder) {
      const out: CloudFile[] = [];
      let url: string | undefined = `${GRAPH}/root:/${pathOf(folder)}:/children?$select=id,name,lastModifiedDateTime,file&$top=999`;
      while (url) {
        const res = await graph(url);
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`OneDrive list failed (${res.status})`);
        const body = (await res.json()) as { value: { id: string; name: string; lastModifiedDateTime: string; file?: unknown }[]; '@odata.nextLink'?: string };
        out.push(...body.value.filter((v) => v.file).map((v) => ({ id: v.id, name: v.name, modified: Date.parse(v.lastModifiedDateTime) })));
        url = body['@odata.nextLink'];
      }
      return out;
    },
    async download(_folder, file) {
      const res = await graph(`${GRAPH}/items/${file.id}/content`);
      if (!res.ok) throw new Error(`OneDrive download failed (${res.status})`);
      return res.blob();
    },
    async remove(_folder, file) {
      const res = await graph(`${GRAPH}/items/${file.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`OneDrive delete failed (${res.status})`);
    },
  };
}
