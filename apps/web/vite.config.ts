import { defineConfig, searchForWorkspaceRoot } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.APP_MODE': JSON.stringify(process.env.APP_MODE || 'development'),
    'import.meta.env.BACKUP_DRIVE_FOLDER_NAME': JSON.stringify(
      process.env.BACKUP_DRIVE_FOLDER_NAME || (process.env.APP_MODE === 'test' ? 'Kaaj-test' : 'Kaaj')
    ),
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
