// Local look-only build: real components, mocked auth and data. Never deployed.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const mock = fileURLToPath(new URL('./preview/mocks.tsx', import.meta.url))
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'convex/react-clerk': mock, 'convex/react': mock, '@clerk/clerk-react': mock } },
  build: { outDir: 'dist-preview' },
})
