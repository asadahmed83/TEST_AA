import type { CloudProviderId } from '../../types';

export interface CloudFile {
  id: string;
  name: string;
  modified: number;
}

export interface CloudProvider {
  id: CloudProviderId;
  label: string;
  icon: string;
  /** true when no OAuth client ID is configured and the built-in demo cloud is used */
  demo: boolean;
  /** can hold encrypted sync bundles for cross-device sync */
  supportsSync: boolean;
  isConnected(): boolean;
  account(): string | null;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  upload(folder: string, name: string, data: Blob, opts?: { overwrite?: boolean }): Promise<{ id: string; webUrl?: string; name: string }>;
  list(folder: string): Promise<CloudFile[]>;
  download(folder: string, file: CloudFile): Promise<Blob>;
  remove(folder: string, file: CloudFile): Promise<void>;
}

export class NeedsAuthError extends Error {
  constructor(provider: string) {
    super(`${provider} session expired — reconnect it in Settings.`);
    this.name = 'NeedsAuthError';
  }
}

export function splitPath(folder: string): string[] {
  return folder.split('/').map((s) => s.trim()).filter(Boolean);
}
