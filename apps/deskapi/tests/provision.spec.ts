// deskapi is a plain-JS Node service: it ships as source to the storefront box with no build step, so it sits
// outside both TypeScript programs and its sources are unlinted like every other **/*.js here. These tests are
// .ts only because the vitest include glob is *.spec.ts, which leaves every value crossing the import boundary
// untyped — the rules disabled below report that boundary, never a defect. Every other rule still applies.
/* oxlint-disable typescript/no-unsafe-assignment */
/* oxlint-disable typescript/no-unsafe-member-access */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { provision } from '../src/provision.js'

/** A DigitalOcean stand-in that records every call, so a test can assert what was NOT done. */
function fakeApi({ byId, byTag }: { byId?: DropletLike; byTag?: DropletLike } = {}) {
  const calls: Array<{ method: string; path: string }> = []
  const droplets = new Map<number, DropletLike>()
  if (byId) droplets.set(byId.id, byId)
  if (byTag) droplets.set(byTag.id, byTag)
  const api = async (method: string, path: string) => {
    calls.push({ method, path })
    if (path.startsWith('/account/keys')) return { ssh_keys: [{ id: 1 }] }
    if (method === 'POST' && path === '/droplets') { const made = withIp(999); droplets.set(made.id, made); return { droplet: made } }
    if (path.startsWith('/droplets?tag_name=')) return { droplets: byTag ? [byTag] : [] }
    if (method === 'GET' && path.startsWith('/droplets/')) {
      const found = droplets.get(Number(path.split('/')[2]))
      if (!found) throw new Error('404 droplet not found')
      return { droplet: found }
    }
    return {}
  }
  return { api, calls }
}
interface DropletLike { id: number; networks: { v4: Array<{ type: string; ip_address: string }> } }
const withIp = (id: number) => ({ id, networks: { v4: [{ type: 'public', ip_address: '10.0.0.9' }] } })
const order = { id: 'ord_x', slug: 'acme', business: 'Acme', email: 'a@example.com', plan: 'business' }
const deps = (api: unknown) => ({ api, dns: async () => false, probe: async () => true, sleep: async () => {} })

beforeEach(() => { vi.stubEnv('CLOUDFLARE_API_TOKEN', ''); vi.stubEnv('DIGITALOCEAN_TOKEN', 'test') })

describe('provision adopts rather than duplicates', () => {
  it('reuses the droplet an interrupted run already created, by id', async () => {
    const { api, calls } = fakeApi({ byId: withIp(555) })
    const out = await provision({ ...order, dropletId: 555 }, () => {}, () => {}, deps(api))
    expect(out.dropletId).toBe(555)
    expect(calls.some(c => c.method === 'POST' && c.path === '/droplets')).toBe(false)
  })

  it('finds a droplet whose id was never saved, by its order tag', async () => {
    const { api, calls } = fakeApi({ byTag: withIp(777) })
    const out = await provision({ ...order }, () => {}, () => {}, deps(api))
    expect(out.dropletId).toBe(777)
    expect(calls.some(c => c.path === '/droplets?tag_name=order:ord_x')).toBe(true)
    expect(calls.some(c => c.method === 'POST' && c.path === '/droplets')).toBe(false)
  })

  it('creates one only when there is nothing to adopt', async () => {
    const { api, calls } = fakeApi()
    let ipSaved = false
    const out = await provision({ ...order }, () => {}, (patch: Record<string, unknown>) => { if (patch.ip) ipSaved = true }, deps(api))
    expect(out.dropletId).toBe(999)
    expect(calls.filter(c => c.method === 'POST' && c.path === '/droplets').length).toBe(1)
    expect(ipSaved).toBe(true)
  })

  it('keeps the password a resumed box already booted with', async () => {
    const { api } = fakeApi({ byId: withIp(555) })
    const out = await provision({ ...order, dropletId: 555, password: 'already-set' }, () => {}, () => {}, deps(api))
    expect(out.password).toBe('already-set')
  })

  it('saves each fact as it happens, so the next resume starts further along', async () => {
    const { api } = fakeApi({ byId: withIp(555) })
    const patches: Array<Record<string, unknown>> = []
    await provision({ ...order, dropletId: 555 }, () => {}, (p: Record<string, unknown>) => patches.push(p), deps(api))
    const keys = patches.flatMap(p => Object.keys(p))
    expect(keys).toEqual(expect.arrayContaining(['password', 'dropletId', 'ip', 'host']))
  })

  it('destroys the box it could not finish, so nothing is billed for nothing', async () => {
    const { api, calls } = fakeApi({ byId: { id: 555, networks: { v4: [] } } })
    await expect(provision({ ...order, dropletId: 555 }, () => {}, () => {}, { ...deps(api), sleep: async () => {} }))
      .rejects.toThrow(/public address/)
    expect(calls.some(c => c.method === 'DELETE' && c.path === '/droplets/555')).toBe(true)
  })
})
