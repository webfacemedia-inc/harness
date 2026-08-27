// Turn a paid order into a Desk computer: droplet from bootstrap.sh in tor1,
// DNS record when the Cloudflare token allows, wait for the front door.
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const DOMAIN = process.env.DESK_DOMAIN ?? 'webfacedesk.app'
const ZONE = process.env.CLOUDFLARE_ZONE_ID ?? 'd3fc4cb5dfad60b2064472906607a170'
const DO = 'https://api.digitalocean.com/v2'

async function doApi(method, path, body) {
  const r = await fetch(DO + path, { method, headers: { authorization: `Bearer ${process.env.DIGITALOCEAN_TOKEN}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`DigitalOcean ${method} ${path}: ${r.status} ${j.message ?? ''}`)
  return j
}
async function cfDns(slug, ip) {
  const token = process.env.CLOUDFLARE_API_TOKEN; if (!token) return false
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const q = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records?name=${slug}.${DOMAIN}`, { headers: h })).json()
  if (!q.success) return false
  const body = { type: 'A', name: slug, content: ip, ttl: 60, proxied: false }
  const r = q.result[0]
    ? await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records/${q.result[0].id}`, { method: 'PATCH', headers: h, body: JSON.stringify(body) })
    : await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records`, { method: 'POST', headers: h, body: JSON.stringify(body) })
  return (await r.json()).success === true
}

export function userData(env) {
  const script = readFileSync(join(here, '..', '..', '..', 'infra', 'desk-box', 'bootstrap.sh'), 'utf8')
  return '#!/usr/bin/env bash\n' + Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(String(v ?? ''))}`).join('\n')
    + '\nmkdir -p /srv/desk\ncat > /srv/desk/bootstrap.sh <<"BOOTSTRAP_EOF"\n' + script + '\nBOOTSTRAP_EOF\nbash /srv/desk/bootstrap.sh\n'
}

/**
 * @param order - { id, slug, business, email, plan, size }
 * @param log - progress callback(status, detail)
 * @returns { ip, host, password, dropletId, dns }
 */
export async function provision(order, log = () => {}) {
  const password = randomBytes(12).toString('base64url')
  const dnsAble = Boolean(process.env.CLOUDFLARE_API_TOKEN)
  const env = {
    DESK_SLUG: order.slug, DESK_BUSINESS: order.business, DESK_HOST: dnsAble ? `${order.slug}.${DOMAIN}` : '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, DESK_OWNER_PASSWORD: password, DESK_OWNER_USER: 'owner', DESK_OWNER_EMAIL: order.email,
    DESK_HARNESS_REF: process.env.DESK_HARNESS_REF ?? 'desk', DESK_SANDBOX: 'read-only', DESK_DEFAULT_PRESET: 'team',
    DESK_SIGNIN_CLIENT_ID: process.env.DESK_SIGNIN_CLIENT_ID ?? '', DESK_SIGNIN_CLIENT_SECRET: process.env.DESK_SIGNIN_CLIENT_SECRET ?? '',
    DESK_API_URL: process.env.DESK_PUBLIC_URL ? `${process.env.DESK_PUBLIC_URL}/api` : '', DESK_BOX_TOKEN: order.boxToken ?? '',
  }
  log('creating', 'creating your Desk computer in Toronto')
  const keys = (await doApi('GET', '/account/keys?per_page=50')).ssh_keys.map(k => k.id)
  const { droplet } = await doApi('POST', '/droplets', { name: `desk-${order.slug}`, region: 'tor1', size: order.size ?? 's-2vcpu-4gb', image: 'ubuntu-24-04-x64', ssh_keys: keys, tags: ['webface-desk', `plan:${order.plan}`], user_data: userData(env), monitoring: true })
  let ip
  for (let i = 0; i < 60 && !ip; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const d = (await doApi('GET', `/droplets/${droplet.id}`)).droplet
    ip = d.networks?.v4?.find(n => n.type === 'public')?.ip_address
  }
  if (!ip) throw new Error('droplet never got a public address')
  const dns = dnsAble ? await cfDns(order.slug, ip) : false
  const host = dns ? `${order.slug}.${DOMAIN}` : `${ip}.sslip.io`
  if (dnsAble && !dns) log('dns-failed', `DNS for ${order.slug}.${DOMAIN} could not be written; using ${host}`)
  log('installing', 'installing your team (about ten minutes)')
  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, 10000))
    try { const r = await fetch(`https://${host}/healthz`, { signal: AbortSignal.timeout(5000) }); if (r.ok) break } catch {}
    if (i === 179) throw new Error('box did not come up in 30 minutes')
  }
  return { ip, host, password, dropletId: droplet.id, dns }
}
