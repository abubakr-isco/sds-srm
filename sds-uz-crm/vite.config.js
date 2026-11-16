import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies /api to the backend (backend/, default http://127.0.0.1:3000).
// VITE_DEMO=1 builds the browser-only demo (localStorage, demo accounts) used for the
// Vercel showcase; see vercel.json.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
