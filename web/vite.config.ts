import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo (`npm run dev`) las llamadas /api van al servidor de VENTAX en el puerto 3000.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
