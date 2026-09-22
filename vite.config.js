import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// `base` is only right for the GitHub Pages build, where the app is served from
// /symptom-tracker/. Applying it in dev too put the HMR websocket on a path the dev
// server doesn't answer, so it reconnected forever and the local preview went stale.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/symptom-tracker/' : '/',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
  },
}))
