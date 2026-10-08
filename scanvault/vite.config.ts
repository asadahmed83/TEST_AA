import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:phone` serves over HTTPS on your LAN: phones only allow the camera
// and Web Crypto on secure origins, so plain http://<your-ip> won't work.
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    // Forward AI calls to the local proxy (npm run server) during development.
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
