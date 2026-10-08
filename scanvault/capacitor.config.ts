import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.scanvault.app',
  appName: 'ScanVault',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
