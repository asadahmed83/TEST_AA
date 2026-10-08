import type { CloudProviderId } from '../../types';
import { saveToDevice, isNative } from '../platform';
import { demoProvider } from './demo';
import { googleDriveProvider } from './googleDrive';
import { oneDriveProvider } from './oneDrive';
import type { CloudProvider } from './types';

export type { CloudProvider, CloudFile } from './types';
export { NeedsAuthError } from './types';

const GOOGLE_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const MS_ID = import.meta.env.VITE_MS_CLIENT_ID as string | undefined;

const deviceProvider: CloudProvider = {
  id: 'device',
  label: isNative() ? 'This device' : 'Download',
  icon: '📱',
  demo: false,
  supportsSync: false,
  isConnected: () => true,
  account: () => null,
  async connect() {},
  async disconnect() {},
  async upload(folder, name, data) {
    const r = await saveToDevice(folder, name, data);
    return { id: r.path, name };
  },
  async list() {
    return [];
  },
  async download() {
    throw new Error('Not supported');
  },
  async remove() {},
};

export const providers: Record<CloudProviderId, CloudProvider> = {
  gdrive: GOOGLE_ID ? googleDriveProvider(GOOGLE_ID) : demoProvider('gdrive', 'Google Drive', '🟢'),
  onedrive: MS_ID ? oneDriveProvider(MS_ID) : demoProvider('onedrive', 'OneDrive', '🔵'),
  device: deviceProvider,
};

export const providerList = () => Object.values(providers);
