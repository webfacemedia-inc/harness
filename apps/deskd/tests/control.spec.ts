// deskd is a plain-JS Node service shipped as source, outside both TypeScript programs; these tests
// are .ts only because the vitest include glob is *.spec.ts, which leaves every value crossing the
// import boundary untyped — the rules disabled below report that boundary, never a defect.
/* oxlint-disable typescript/no-unsafe-assignment */
/* oxlint-disable typescript/no-unsafe-call */
/* oxlint-disable typescript/no-unsafe-member-access */
/* oxlint-disable typescript/no-unsafe-argument */
/* oxlint-disable typescript/no-unsafe-return */
/* oxlint-disable typescript/no-redundant-type-constituents */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dirs: string[] = []
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'desk-control-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.resetModules() })

/** The handler under its real contract: a request-shaped async iterable and a recording response. */
function fakeReq(
  method: string, path: string,
  { token, body, headers = {} }: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
) {
  const raw = Buffer.from(typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body))
  const req = {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    async *[Symbol.asyncIterator]() { if (raw.length) yield raw },
  }
  const chunks: Buffer[] = []
  let status = 0
  const res = {
    writeHead(code: number) { status = code },
    end(data?: string | Buffer) { if (data) chunks.push(Buffer.from(data)) },
    // Enough writable-stream surface for createReadStream().pipe(res) in the download path.
    write(data: string | Buffer) { chunks.push(Buffer.from(data)); return true },
    on() { return this }, once() { return this }, emit() { return false }, removeListener() { return this },
    get status() { return status },
    get body() { return Buffer.concat(chunks).toString() },
    get json() { try { return JSON.parse(this.body) } catch { return null } },
  }
  return { req, res, u: new URL(`https://box.example${path}`) }
}

const readBody = async (req: AsyncIterable<Buffer>) => {
  const c: Buffer[] = []; for await (const x of req) c.push(x); return Buffer.concat(c)
}

async function load(dir: string) {
  vi.stubEnv('DESK_BOX_TOKEN', 'tok_test')
  vi.stubEnv('DESK_WORK_DIR', join(dir, 'work'))
  vi.stubEnv('DESK_PROFILE_FILE', join(dir, 'profile.json'))
  vi.stubEnv('DESK_BRAND_DIR', join(dir, 'brand'))
  vi.stubEnv('DESK_RECORDINGS_DIR', join(dir, 'recordings'))
  vi.stubEnv('DESK_MEMORY_FILE', join(dir, 'memory.jsonl'))
  vi.stubEnv('DESK_MEMORY_BLOCK', join(dir, 'AGENTS-home.md'))
  return await import('../src/control.js')
}

describe('the control channel refuses everything but its own token', () => {
  it('401s a wrong token and a missing one', async () => {
    const control = await load(scratch())
    for (const token of ['tok_wrong', undefined]) {
      const { req, res, u } = fakeReq('POST', '/deskd/config', { token, body: { profile: { business: 'X' } } })
      await control.handle(req, res, u, { readBody, host: 'box.example' })
      expect(res.status).toBe(401)
    }
  })

  it('is not fooled by an owner-style path it does not own', async () => {
    const control = await load(scratch())
    const { req, res, u } = fakeReq('POST', '/profile', { token: 'tok_test' })
    expect(await control.handle(req, res, u, { readBody, host: 'box.example' })).toBe(false)
  })
})

describe('config push', () => {
  it('merges profile fields, keeps the rest, and regenerates AGENTS.md', async () => {
    const dir = scratch()
    const control = await load(dir)
    const first = fakeReq('POST', '/deskd/config', { token: 'tok_test', body: { profile: { business: 'Maple & Main', does: 'Plumbing across the GTA' } } })
    await control.handle(first.req, first.res, first.u, { readBody, host: 'box.example' })
    expect(first.res.json.ok).toBe(true)
    const second = fakeReq('POST', '/deskd/config', { token: 'tok_test', body: { profile: { phone: '416-555-0100' } } })
    await control.handle(second.req, second.res, second.u, { readBody, host: 'box.example' })
    const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8'))
    expect(profile.business).toBe('Maple & Main')
    expect(profile.phone).toBe('416-555-0100')
    const agents = readFileSync(join(dir, 'work', 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Maple & Main')
    expect(agents).toContain('416-555-0100')
  })

  it('validates brand colours and ignores garbage', async () => {
    const dir = scratch()
    const control = await load(dir)
    const { req, res, u } = fakeReq('POST', '/deskd/config', { token: 'tok_test', body: { brand: { primary: '3499CC', accent: 'not-a-colour', font: 'classic', tagline: 'Fast, tidy.' } } })
    await control.handle(req, res, u, { readBody, host: 'box.example' })
    expect(res.status).toBe(200)
    const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8'))
    expect(profile.brand.primary).toBe('#3499cc')
    expect(profile.brand.accent).toBeUndefined()
    expect(profile.brand.font).toBe('classic')
  })

  it('accepts a logo upload and records it on the brand', async () => {
    const dir = scratch()
    const control = await load(dir)
    const png = Buffer.from('89504e470d0a1a0a', 'hex').toString()
    const { req, res, u } = fakeReq('PUT', '/deskd/config/logo', { token: 'tok_test', body: png, headers: { 'x-filename': 'mark.PNG' } })
    await control.handle(req, res, u, { readBody, host: 'box.example' })
    expect(res.status).toBe(200)
    expect(existsSync(join(dir, 'brand', 'logo.png'))).toBe(true)
    const profile = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8'))
    expect(profile.brand.logo).toBe(join(dir, 'brand', 'logo.png'))
  })
})

describe('demo seeding', () => {
  it('writes files inside the Desk folder only, and seeds memory through the one ledger', async () => {
    const dir = scratch()
    const control = await load(dir)
    const { req, res, u } = fakeReq('POST', '/deskd/seed', { token: 'tok_test', body: {
      files: [
        { path: 'price-list.md', content: '# Prices\n| Growth site | $6,900 |' },
        { path: '../outside.txt', content: 'must not land' },
        { path: 'AGENTS.md', content: 'must not clobber the profile' },
      ],
      memory: [
        { kind: 'commitment', about: 'Dana Okafor', text: 'Quoted $2,400 for the rebuild', pinned: false },
        { kind: 'decision', text: 'No jobs outside the GTA', pinned: true },
      ],
    } })
    await control.handle(req, res, u, { readBody, host: 'box.example' })
    expect(res.json).toMatchObject({ ok: true, files: ['price-list.md'], memory: 2 })
    expect(readFileSync(join(dir, 'work', 'price-list.md'), 'utf8')).toContain('$6,900')
    expect(existsSync(join(dir, 'outside.txt'))).toBe(false)
    expect(existsSync(join(dir, 'work', 'AGENTS.md'))).toBe(false)
    const block = readFileSync(join(dir, 'AGENTS-home.md'), 'utf8')
    expect(block).toContain('Quoted $2,400 for the rebuild')
    expect(block).toContain('No jobs outside the GTA (pinned)')
  })
})

describe('capture and reset', () => {
  it('reads back the setup a template captures: profile, brand, price list, memory', async () => {
    const dir = scratch()
    const control = await load(dir)
    const cfg = fakeReq('POST', '/deskd/config', { token: 'tok_test', body: {
      profile: { business: 'Maple & Main', phone: '416-555-0100' },
      brand: { primary: '3499cc', tagline: 'Fast, tidy.' },
    } })
    await control.handle(cfg.req, cfg.res, cfg.u, { readBody, host: 'box.example' })
    const seed = fakeReq('POST', '/deskd/seed', { token: 'tok_test', body: {
      files: [{ path: 'price-list.md', content: '# Prices' }],
      memory: [{ kind: 'decision', text: 'No Sundays', pinned: true }],
    } })
    await control.handle(seed.req, seed.res, seed.u, { readBody, host: 'box.example' })

    const read = fakeReq('POST', '/deskd/config', { token: 'tok_test', body: { read: true } })
    await control.handle(read.req, read.res, read.u, { readBody, host: 'box.example' })
    expect(read.res.status).toBe(200)
    expect(read.res.json.profile.business).toBe('Maple & Main')
    expect(read.res.json.brand.tagline).toBe('Fast, tidy.')
    expect(read.res.json.brand.logo).toBeUndefined() // paths are box-local; the logo travels separately
    expect(read.res.json.priceListMd).toBe('# Prices')
    expect(read.res.json.memory).toEqual([{ kind: 'decision', about: 'business', text: 'No Sundays', pinned: true }])
  })

  it('resetMemory replaces the ledger with the seeds — what a prospect typed is gone', async () => {
    const dir = scratch()
    const control = await load(dir)
    const first = fakeReq('POST', '/deskd/seed', { token: 'tok_test', body: {
      memory: [{ kind: 'fact', text: 'from the prospect', pinned: false }],
    } })
    await control.handle(first.req, first.res, first.u, { readBody, host: 'box.example' })
    const reset = fakeReq('POST', '/deskd/seed', { token: 'tok_test', body: {
      resetMemory: true,
      memory: [{ kind: 'decision', text: 'the rehearsed default', pinned: true }],
    } })
    await control.handle(reset.req, reset.res, reset.u, { readBody, host: 'box.example' })
    const block = readFileSync(join(dir, 'AGENTS-home.md'), 'utf8')
    expect(block).toContain('the rehearsed default')
    expect(block).not.toContain('from the prospect')
  })

  it('resetMemory with no seeds leaves an honestly empty memory', async () => {
    const dir = scratch()
    const control = await load(dir)
    const first = fakeReq('POST', '/deskd/seed', { token: 'tok_test', body: { memory: [{ kind: 'fact', text: 'stale note' }] } })
    await control.handle(first.req, first.res, first.u, { readBody, host: 'box.example' })
    const reset = fakeReq('POST', '/deskd/seed', { token: 'tok_test', body: { resetMemory: true } })
    await control.handle(reset.req, reset.res, reset.u, { readBody, host: 'box.example' })
    expect(readFileSync(join(dir, 'AGENTS-home.md'), 'utf8')).toContain('Nothing recorded yet.')
  })
})

describe('recordings', () => {
  it('signs download links that expire and refuse tampering', async () => {
    const dir = scratch()
    const control = await load(dir)
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(dir, 'recordings'), { recursive: true })
    writeFileSync(join(dir, 'recordings', '2026-09-02T00-00-00-000Z.mp4'), 'video-bytes')

    const link = fakeReq('POST', '/deskd/record', { token: 'tok_test', body: { op: 'link', file: '2026-09-02T00-00-00-000Z.mp4' } })
    await control.handle(link.req, link.res, link.u, { readBody, host: 'box.example' })
    const url = new URL(link.res.json.url)
    expect(url.pathname).toBe('/deskd/record/dl')

    const dl = fakeReq('GET', `/deskd/record/dl?${url.searchParams}`)
    const dlU: never = { pathname: '/deskd/record/dl', searchParams: url.searchParams } as never
    const ok = await control.handle(dl.req, dl.res, dlU, { readBody, host: 'box.example' })
    expect(ok).toBe(true)
    expect(dl.res.status).toBe(200)

    url.searchParams.set('f', '2026-09-02T00-00-00-000Z.mp4')
    url.searchParams.set('exp', String(Date.now() - 1000))
    const stale = fakeReq('GET', '/deskd/record/dl')
    const staleU = { pathname: '/deskd/record/dl', searchParams: url.searchParams } as never
    await control.handle(stale.req, stale.res, staleU, { readBody, host: 'box.example' })
    expect(stale.res.status).toBe(403)
  })

  it('lists recordings without a recorder running', async () => {
    const control = await load(scratch())
    const { req, res, u } = fakeReq('POST', '/deskd/record', { token: 'tok_test', body: { op: 'list' } })
    await control.handle(req, res, u, { readBody, host: 'box.example' })
    expect(res.json).toEqual({ recordings: [], recording: false })
  })
})
