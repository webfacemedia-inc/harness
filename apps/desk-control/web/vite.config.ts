import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The console imports ../../convex/_generated, whose api.js imports "convex/server".
// Node resolution walks UP from that file and web/node_modules is not above it, so
// a git build (only web/ installed) cannot resolve it. dedupe pins every convex
// import to this package's own copy.
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['convex'] },
})
