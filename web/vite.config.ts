import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output is embedded into the server module and served at /reelforge/.
// For development against a running server: VITE_SERVER=http://myserver:8096 npm run dev
export default defineConfig({
  base: '/reelforge/',
  plugins: [react()],
  build: {
    outDir: '../server/ReelForge/Web',
    emptyOutDir: true,
    sourcemap: false,
  },
});
