#!/usr/bin/env node
// Provision a webfaCe Desk computer on DigitalOcean (tor1).
//   node scripts/desk-box.mjs create <slug> [--business "Name"] [--user owner] [--email owner@x.com] [--size s-2vcpu-4gb] [--sandbox read-only|workspace-write] [--preset team]
//   node scripts/desk-box.mjs destroy <slug>
// Needs: doctl (authed), OPENROUTER_API_KEY (env or ~/.desk/.credentials.yaml),
// optional CLOUDFLARE_API_TOKEN for <slug>.webfacedesk.app (else <ip>.sslip.io).
// Writes the owner password to ~/.config/webface-desk/boxes/<slug>.md (0600).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const [cmd, slug, ...rest] = process.argv.slice(2)
const opt = (k, d) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d }
if (!cmd || !slug || !/^[a-z0-9-]{2,32}$/.test(slug)) { console.error('usage: desk-box.mjs create|destroy <slug> [--business ..] [--size ..]'); process.exit(2) }
const doctl = (...a) => execFileSync('doctl', [...a, '--output', 'json'], { encoding: 'utf8' })
const ZONE = 'd3fc4cb5dfad60b2064472906607a170', DOMAIN = 'webfacedesk.app'
const boxesDir = join(homedir(), '.config', 'webface-desk', 'boxes'); mkdirSync(boxesDir, { recursive: true, mode: 0o700 })
const name = `desk-${slug}`

async function dns(method, path, body) {
  const token = process.env.CLOUDFLARE_API_TOKEN; if (!token) return null
  const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await r.json(); if (!j.success) { console.error('cloudflare:', JSON.stringify(j.errors)); return null } return j.result
}

if (cmd === 'destroy') {
  const ds = JSON.parse(doctl('compute', 'droplet', 'list', '--tag-name', 'webface-desk')).filter(d => d.name === name)
  for (const d of ds) { execFileSync('doctl', ['compute', 'droplet', 'delete', String(d.id), '--force']); console.log('deleted droplet', d.id) }
  const recs = await dns('GET', `/dns_records?name=${slug}.${DOMAIN}`) ?? []
  for (const r of recs) { await dns('DELETE', `/dns_records/${r.id}`); console.log('deleted dns', r.name) }
  process.exit(0)
}
if (cmd !== 'create') process.exit(2)

let key = process.env.OPENROUTER_API_KEY
if (!key) { const m = readFileSync(join(homedir(), '.desk', '.credentials.yaml'), 'utf8').match(/OPENROUTER_API_KEY:\s*(\S+)/); key = m?.[1] }
if (!key) { console.error('no OPENROUTER_API_KEY'); process.exit(1) }
const password = randomBytes(12).toString('base64url')
const boxToken = randomBytes(16).toString('hex')  // add `${slug}:${boxToken}` to DESKAPI_STATIC_BOX_TOKENS on the apex so the box can heartbeat
const business = opt('business', slug)
const useDns = Boolean(process.env.CLOUDFLARE_API_TOKEN)
const host = useDns ? `${slug}.${DOMAIN}` : ''
const env = {
  DESK_SLUG: slug, DESK_BUSINESS: business, DESK_HOST: host, OPENROUTER_API_KEY: key, DESK_OWNER_PASSWORD: password,
  DESK_HARNESS_REF: opt('ref', 'desk'), DESK_OWNER_USER: opt('user', 'owner'), DESK_OWNER_EMAIL: opt('email', ''),
  DESK_API_URL: process.env.DESK_PUBLIC_URL ? `${process.env.DESK_PUBLIC_URL}/api` : '', DESK_BOX_TOKEN: boxToken, DESK_PLAN: opt('plan', 'business'), DESK_SANDBOX: opt('sandbox', 'read-only'), DESK_DEFAULT_PRESET: opt('preset', 'team'),
}
const script = readFileSync(join(here, '..', 'infra', 'desk-box', 'bootstrap.sh'), 'utf8')
const userData = '#!/usr/bin/env bash\n' + Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n') + '\nmkdir -p /srv/desk\ncat > /srv/desk/bootstrap.sh <<"BOOTSTRAP_EOF"\n' + script + '\nBOOTSTRAP_EOF\nbash /srv/desk/bootstrap.sh\n'
const udPath = join(boxesDir, `${slug}.user-data.sh`); writeFileSync(udPath, userData, { mode: 0o600 })
const keys = JSON.parse(doctl('compute', 'ssh-key', 'list')).map(k => String(k.id)).join(',')
console.log(`creating ${name} in tor1 (${opt('size', 's-2vcpu-4gb')})…`)
const d = JSON.parse(doctl('compute', 'droplet', 'create', name, '--region', 'tor1', '--size', opt('size', 's-2vcpu-4gb'), '--image', 'ubuntu-24-04-x64', '--ssh-keys', keys, '--tag-name', 'webface-desk', '--user-data-file', udPath, '--wait'))[0]
const ip = d.networks.v4.find(n => n.type === 'public').ip_address
let finalHost = host || `${ip}.sslip.io`
if (useDns) {
  const existing = await dns('GET', `/dns_records?name=${slug}.${DOMAIN}`) ?? []
  const rec = existing[0]
    ? await dns('PATCH', `/dns_records/${existing[0].id}`, { content: ip })
    : await dns('POST', '/dns_records', { type: 'A', name: slug, content: ip, ttl: 60, proxied: false })
  if (!rec) { console.error(`DNS failed — box was told DESK_HOST=${host}; add A ${slug}.${DOMAIN} → ${ip} by hand`) }
}
const note = `# Desk box ${slug}\n\n- URL: https://${finalHost}\n- Box token (add to DESKAPI_STATIC_BOX_TOKENS on the apex as \`${slug}:${boxToken}\`): ${boxToken}\n- Droplet: ${d.id} (${ip}, tor1, ${opt('size', 's-2vcpu-4gb')})\n- Owner sign-in: user \`${opt('user', 'owner')}\`, password \`${password}\`${opt('email', '') ? ` (Google sign-in as ${opt('email', '')})` : ''}\n- SSH: ssh root@${ip}  (progress: tail -f /var/log/desk-bootstrap.log; done when /srv/desk/READY exists)\n- Created: ${new Date().toISOString()}\n`
writeFileSync(join(boxesDir, `${slug}.md`), note, { mode: 0o600 })
console.log(note)
