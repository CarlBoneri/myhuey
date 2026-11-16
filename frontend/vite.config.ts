import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The app is served by FastAPI from /static/app. `npm run dev` proxies the API to a
// running `myhuey serve` on port 8000.
export default defineConfig({
  base: '/static/app/',
  plugins: [react()],
  build: { outDir: '../static/app', emptyOutDir: true, assetsInlineLimit: 0 },
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  // Tests run in plain Node; a component test opts in to a simulated browser with a first-line comment.
  test: { environment: 'node', server: { deps: { inline: ['@material/material-color-utilities'] } } },
});
