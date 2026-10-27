import { defineConfig } from 'vite'

// The viewer is one static page. The CLI serves dist/ for `stage open` and
// for headless renders, so both show exactly the same pixels. Each build is
// stamped, so an open page can tell the server has a newer one and reload.
export default defineConfig({
  root: 'src/viewer',
  base: './',
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1200 },
  plugins: [
    {
      name: 'stage-build-stamp',
      transformIndexHtml: (html) => html.replace('__STAGE_BUILD__', String(Date.now())),
    },
  ],
})
