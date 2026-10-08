import { dbDelete, dbEntries, dbGet, dbPut } from '../db';
import type { CloudProviderId } from '../../types';
import { splitPath, type CloudFile, type CloudProvider } from './types';

/**
 * Stand-in cloud used when no OAuth client ID is configured. Files live in a
 * separate IndexedDB store on this device, so the whole save/sync flow can be
 * exercised end-to-end without credentials (it does not reach other devices).
 */
interface Entry {
  blob: Blob;
  modified: number;
}

export function demoProvider(id: CloudProviderId, label: string, icon: string): CloudProvider {
  const flag = `scanvault.demo.${id}`;
  const keyOf = (folder: string, name: string) => `${id}:${splitPath(folder).join('/')}/${name}`;
  return {
    id,
    label,
    icon,
    demo: true,
    supportsSync: true,
    isConnected: () => localStorage.getItem(flag) === '1',
    account: () => (localStorage.getItem(flag) === '1' ? 'demo@scanvault.local' : null),
    async connect() {
      localStorage.setItem(flag, '1');
    },
    async disconnect() {
      localStorage.removeItem(flag);
    },
    async upload(folder, name, data, opts) {
      let finalName = name;
      if (!opts?.overwrite) {
        const dot = name.lastIndexOf('.');
        const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
        for (let i = 2; await dbGet(`mockcloud`, keyOf(folder, finalName)); i++) finalName = `${stem} (${i})${ext}`;
      }
      const key = keyOf(folder, finalName);
      await dbPut('mockcloud', key, { blob: data, modified: Date.now() } satisfies Entry);
      return { id: key, name: finalName };
    },
    async list(folder) {
      const prefix = `${id}:${splitPath(folder).join('/')}/`;
      return (await dbEntries<Entry>('mockcloud'))
        .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map(([k, v]): CloudFile => ({ id: k, name: k.slice(prefix.length), modified: v.modified }));
    },
    async download(_folder, file) {
      const e = await dbGet<Entry>('mockcloud', file.id);
      if (!e) throw new Error('File not found');
      return e.blob;
    },
    async remove(_folder, file) {
      await dbDelete('mockcloud', file.id);
    },
  };
}
