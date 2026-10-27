import { defineConfig } from 'vite'

// The viewer is one static page. The CLI serves dist/ for `stage open` and
// for headless renders, so both show exactly the same pixels.
export default defineConfig({
  root: 'src/viewer',
  base: './',
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022' },
})
