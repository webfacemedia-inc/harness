// Cross-platform "build": the frontend is one static page. Copies index.html into dist/.
import { mkdirSync, copyFileSync } from 'node:fs'
mkdirSync('dist', { recursive: true })
copyFileSync('index.html', 'dist/index.html')
console.log('frontend: dist/index.html')
