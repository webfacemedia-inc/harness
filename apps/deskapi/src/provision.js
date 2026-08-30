// Turn a paid order into a Desk computer: droplet from bootstrap.sh in tor1,
// DNS record when the Cloudflare token allows, wait for the front door.
import { readFileSync } from 'node:fs'
import { buildUserData } from './core.js'
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
const defaultSleep = ms => new Promise(r => setTimeout(r, ms))
/** Is the box answering yet? Any failure means "not yet", never "give up". */
async function defaultProbe(host) {
  try { return (await fetch(`https://${host}/healthz`, { signal: AbortSignal.timeout(5000) })).ok } catch { return false }
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
  return buildUserData(env, readFileSync(join(here, '..', '..', '..', 'infra', 'desk-box', 'bootstrap.sh'), 'utf8'))
}

/**
 * @param order - { id, slug, business, email, plan, size }
 * @param log - progress callback(status, detail)
 * @param update - persists a partial order patch as soon as each fact is known, so an
 *   interrupted run can be picked up where it stopped instead of starting a second box
 * @param deps - the calls this makes to the outside world; a test supplies its own
 * @returns { ip, host, password, dropletId, dns }
 */
export async function provision(order, log = () => {}, update = () => {}, deps = {}) {
  const { api = doApi, dns: writeDns = cfDns, probe = defaultProbe, sleep = defaultSleep } = deps
  // Baked into the box at boot: a resumed run must reuse it, never mint a second one.
  const password = order.password ?? randomBytes(12).toString('base64url')
  update({ password })
  const dnsAble = Boolean(process.env.CLOUDFLARE_API_TOKEN)
  const env = {
    DESK_SLUG: order.slug, DESK_BUSINESS: order.business, DESK_HOST: dnsAble ? `${order.slug}.${DOMAIN}` : '',
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, DESK_OWNER_PASSWORD: password, DESK_OWNER_USER: 'owner', DESK_OWNER_EMAIL: order.email,
    DESK_HARNESS_REF: process.env.DESK_HARNESS_REF ?? 'desk', DESK_SANDBOX: order.sandbox === 'full' ? 'workspace-write' : 'read-only', DESK_DEFAULT_PRESET: 'team', DESK_PLAN: order.plan ?? 'business', FAL_KEY: process.env.FAL_KEY ?? '',
    DESK_API_URL: process.env.DESK_PUBLIC_URL ? `${process.env.DESK_PUBLIC_URL}/api` : '', DESK_BOX_TOKEN: order.boxToken ?? '',
  }
  log('creating', 'creating your Desk in Toronto')
  // An interrupted run already has a box: adopt it rather than creating a second one that
  // would be billed forever. The tag covers the window between creation and the first save.
  let droplet = null
  if (order.dropletId) droplet = await api('GET', `/droplets/${order.dropletId}`).then(r => r.droplet).catch(() => null)
  if (!droplet) droplet = await api('GET', `/droplets?tag_name=order:${order.id}`).then(r => r.droplets?.[0] ?? null).catch(() => null)
  if (!droplet) {
    const keys = (await api('GET', '/account/keys?per_page=50')).ssh_keys.map(k => k.id)
    droplet = (await api('POST', '/droplets', { name: `desk-${order.slug}`, region: 'tor1', size: order.size ?? 's-2vcpu-4gb', image: 'ubuntu-24-04-x64', ssh_keys: keys, tags: ['webface-desk', `plan:${order.plan ?? 'business'}`, `order:${order.id}`], user_data: userData(env), monitoring: true })).droplet
  }
  update({ dropletId: droplet.id })
  // From here a failure must not leave a droplet running and billed: tear it down and rethrow.
  try {
    let ip
    for (let i = 0; i < 60 && !ip; i++) {
      await sleep(5000)
      const d = (await api('GET', `/droplets/${droplet.id}`)).droplet
      ip = d.networks?.v4?.find(n => n.type === 'public')?.ip_address
    }
    if (!ip) throw new Error('droplet never got a public address')
    update({ ip })
    const dns = dnsAble ? await writeDns(order.slug, ip) : false
    const host = dns ? `${order.slug}.${DOMAIN}` : `${ip}.sslip.io`
    update({ host, dns })
    if (dnsAble && !dns) log('dns-failed', `DNS for ${order.slug}.${DOMAIN} could not be written; using ${host}`)
    log('installing', 'setting up your Desk')
    for (let i = 0; i < 180; i++) {
      await sleep(10000)
      if (await probe(host)) break
      if (i === 179) throw new Error('box did not come up in 30 minutes')
    }
    return { ip, host, password, dropletId: droplet.id, dns }
  } catch (e) {
    await api('DELETE', `/droplets/${droplet.id}`).catch(err => console.error('cleanup of failed droplet failed', droplet.id, err.message))
    throw e
  }
}
