import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In a container (docker compose --profile dev) the API is another container and file changes on the host arrive without
// events, so the compose file sets API_URL, VITE_HOST and VITE_POLL. On the host nothing is set and it works as before.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: process.env.VITE_HOST === 'true',
    watch: process.env.VITE_POLL === 'true' ? { usePolling: true, interval: 300 } : undefined,
    proxy: { '/api': process.env.API_URL || 'http://localhost:3001' },
  },
});
