import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin /api in dev too, so the session cookie works exactly as in production.
    proxy: { '/api': 'http://localhost:4000' },
  },
});
