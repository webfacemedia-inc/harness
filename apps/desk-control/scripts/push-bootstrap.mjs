#!/usr/bin/env node
// The provisioning workflow builds each box's user-data from
// infra/desk-box/bootstrap.sh — but Convex has no disk, so the script lives in
// the deployment's config table. Run this after every deploy that touches
// bootstrap.sh (the deploy recipe in STOREFRONT.md includes it):
//
//   node scripts/push-bootstrap.mjs          # dev deployment
//   node scripts/push-bootstrap.mjs --prod   # production
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const script = readFileSync(join(here, '..', '..', '..', 'infra', 'desk-box', 'bootstrap.sh'), 'utf8')
const prod = process.argv.includes('--prod') ? ['--prod'] : []

execFileSync('npx', ['convex', 'run', ...prod, 'config:set', JSON.stringify({ key: 'bootstrapScript', value: script })], {
  cwd: join(here, '..'), stdio: 'inherit',
})
console.log(`bootstrapScript pushed (${script.length} bytes)${prod.length ? ' to prod' : ''}`)
