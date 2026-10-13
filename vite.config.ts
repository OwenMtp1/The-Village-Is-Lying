import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Three.js dans un fichier à part : mis en cache d'une version du jeu à l'autre
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
