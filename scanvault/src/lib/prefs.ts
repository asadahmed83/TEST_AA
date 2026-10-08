import type { CloudProviderId } from '../types';

/**
 * Non-sensitive UI preferences (no document content). Remembers where the user
 * saved last so the folder path is auto-populated for the next save.
 */
export interface Prefs {
  lastProvider: CloudProviderId;
  /** last folder used per provider */
  folders: Partial<Record<CloudProviderId, string>>;
  /** most-recent-first folder history per provider (for suggestions) */
  recentFolders: Partial<Record<CloudProviderId, string[]>>;
  encryptUploads: boolean;
  aiEngine: 'local' | 'claude';
  autoSync: boolean;
  /** provider that holds the cross-device sync data, if any */
  syncProvider: CloudProviderId | null;
  lastSyncAt: number | null;
}

const KEY = 'scanvault.prefs';
export const DEFAULT_FOLDER = 'ScanVault';

const defaults: Prefs = {
  lastProvider: 'gdrive',
  folders: {},
  recentFolders: {},
  encryptUploads: true,
  aiEngine: 'local',
  autoSync: true,
  syncProvider: null,
  lastSyncAt: null,
};

export function getPrefs(): Prefs {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return { ...defaults };
  }
}

export function setPrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...getPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function normalizeFolder(path: string): string {
  return path
    .split(/[\\/]+/)
    .map((s) => s.trim().replace(/[<>:"|?*]/g, ''))
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

/** Folder to pre-fill for a provider: the last one used there, else the default. */
export function folderFor(provider: CloudProviderId): string {
  return getPrefs().folders[provider] ?? DEFAULT_FOLDER;
}

export function rememberSave(provider: CloudProviderId, folder: string) {
  const p = getPrefs();
  const f = normalizeFolder(folder) || DEFAULT_FOLDER;
  const recent = [f, ...(p.recentFolders[provider] ?? []).filter((x) => x !== f)].slice(0, 6);
  setPrefs({
    lastProvider: provider,
    folders: { ...p.folders, [provider]: f },
    recentFolders: { ...p.recentFolders, [provider]: recent },
  });
}
