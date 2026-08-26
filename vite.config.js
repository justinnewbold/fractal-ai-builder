import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // Surfaced in the UI. A stale deployment has been mistaken for a code bug
    // more than once; this makes it checkable at a glance.
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' '))
  },
  build: { outDir: 'dist' }
})
