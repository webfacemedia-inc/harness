// The control plane's channel onto this box, all behind the box token (the
// same auth /deskd/billing has always used — never a session cookie):
//
//   POST /deskd/config        { profile?, brand?, restart? }   merge + save + AGENTS.md
//   PUT  /deskd/config/logo   raw bytes, x-filename            the brand logo
//   POST /deskd/seed          { files: [{path,content}], memory: [...] }   demo seeding
//   POST /deskd/record        { op: start|stop|list|link|open-desk }       screen capture
//   GET  /deskd/record/dl     ?f=..&exp=..&sig=..              signed, short-lived download
//
// Creating files, saving a profile or recording this Desk's own screen is the
// operator configuring a machine they run; nothing here reads owner content.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { readProfile, saveProfile, saveProfileRaw, BRAND_DIR } from './profile.js'

const WORK = process.env.DESK_WORK_DIR ?? '/srv/desk/work'
const RECORDINGS = process.env.DESK_RECORDINGS_DIR ?? '/srv/desk/recordings'
const PIDFILE = join(RECORDINGS, '.ffmpeg.pid')
const MAX_RECORD_MS = 30 * 60 * 1000
const CDP = process.env.DESK_BROWSER_CDP ?? 'http://127.0.0.1:9222'

const boxToken = () => process.env.DESK_BOX_TOKEN ?? ''
const tokenOk = req => {
  const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const want = boxToken()
  return Boolean(tok) && Boolean(want) && tok.length === want.length && timingSafeEqual(Buffer.from(tok), Buffer.from(want))
}
const hex = /^#?[0-9a-f]{6}$/i
const clean = (v, max = 4000) => String(v ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, max)

/** profile/brand fields merged over what is already there; unknown keys ignored. */
function applyConfig({ profile, brand }) {
  const cur = readProfile() ?? {}
  const next = { ...cur }
  if (profile && typeof profile === 'object') {
    for (const k of ['business', 'does', 'address', 'phone', 'email', 'website', 'hours', 'voice', 'rules']) {
      if (typeof profile[k] === 'string') next[k] = clean(profile[k])
    }
  }
  if (brand && typeof brand === 'object') {
    const b = { ...(cur.brand ?? {}) }
    for (const k of ['primary', 'accent']) {
      if (typeof brand[k] === 'string' && hex.test(brand[k].trim())) b[k] = '#' + brand[k].trim().replace(/^#/, '').toLowerCase()
    }
    if (['editorial', 'classic', 'plain'].includes(brand.font)) b.font = brand.font
    if (typeof brand.tagline === 'string') b.tagline = clean(brand.tagline, 200)
    next.brand = b
  }
  saveProfile(next)  // regenerates work/AGENTS.md, so the change reaches the model next turn
}

const sign = (payload) => createHmac('sha256', boxToken()).update(payload).digest('hex')
const sigOk = (payload, sig) => {
  const want = sign(payload)
  return typeof sig === 'string' && sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want))
}

const recordingsHousekeeping = () => {
  try {
    const cutoff = Date.now() - 30 * 86400000
    for (const f of readdirSync(RECORDINGS)) {
      if (f.endsWith('.mp4') && statSync(join(RECORDINGS, f)).mtimeMs < cutoff) unlinkSync(join(RECORDINGS, f))
    }
  } catch { /* housekeeping never breaks a request */ }
}

function recorderPid() {
  try {
    const pid = Number(readFileSync(PIDFILE, 'utf8'))
    if (pid > 0) { process.kill(pid, 0); return pid }
  } catch { /* not running */ }
  return null
}

function startRecording() {
  mkdirSync(RECORDINGS, { recursive: true, mode: 0o700 })
  recordingsHousekeeping()
  if (recorderPid()) return { error: 'already recording' }
  const file = `${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`
  const child = spawn('ffmpeg', [
    '-loglevel', 'error', '-f', 'x11grab', '-framerate', '15', '-i', process.env.DISPLAY ?? ':1',
    '-t', String(MAX_RECORD_MS / 1000), '-pix_fmt', 'yuv420p', '-preset', 'veryfast', join(RECORDINGS, file),
  ], { stdio: 'ignore', detached: true })
  child.unref()
  writeFileSync(PIDFILE, String(child.pid), { mode: 0o600 })
  writeFileSync(join(RECORDINGS, '.current'), file, { mode: 0o600 })
  return { started: file }
}

async function stopRecording() {
  const pid = recorderPid()
  if (!pid) return { error: 'not recording' }
  try { process.kill(pid, 'SIGINT') } catch { /* it may have hit the time cap */ }
  try { unlinkSync(PIDFILE) } catch {}
  // ffmpeg finalises the mp4 on SIGINT; answering before it exits reports a
  // half-written file (seen live: 48 bytes that became 16 KB a moment later).
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0) } catch { break }
    await new Promise(r => setTimeout(r, 100))
  }
  let file = null
  try { file = readFileSync(join(RECORDINGS, '.current'), 'utf8').trim() } catch {}
  const stat = file && existsSync(join(RECORDINGS, file)) ? statSync(join(RECORDINGS, file)) : null
  return { stopped: file, bytes: stat?.size ?? 0 }
}

const listRecordings = () => {
  try {
    return readdirSync(RECORDINGS).filter(f => f.endsWith('.mp4')).sort().map(f => {
      const st = statSync(join(RECORDINGS, f))
      return { file: f, bytes: st.size, at: st.mtime.toISOString() }
    })
  } catch { return [] }
}

export async function handle(req, res, u, { readBody, host }) {
  // The signed download carries no bearer token — the signature is the auth.
  if (u.pathname === '/deskd/record/dl' && req.method === 'GET') {
    const f = normalize(u.searchParams.get('f') ?? '').replace(/^([./\\])+/, '')
    const exp = u.searchParams.get('exp') ?? ''
    if (!/^[A-Za-z0-9-]+\.mp4$/.test(f) || !sigOk(`${f}.${exp}`, u.searchParams.get('sig')) || Date.now() > Number(exp)) {
      res.writeHead(403); return res.end('no')
    }
    const path = join(RECORDINGS, f)
    if (!existsSync(path)) { res.writeHead(404); return res.end('gone') }
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': statSync(path).size, 'content-disposition': `attachment; filename="${f}"` })
    createReadStream(path).pipe(res)
    return true
  }

  if (!u.pathname.startsWith('/deskd/config') && u.pathname !== '/deskd/seed' && u.pathname !== '/deskd/record') return false
  if (!tokenOk(req)) { res.writeHead(401); return res.end('no') }

  if (u.pathname === '/deskd/config' && req.method === 'POST') {
    let b = {}
    try { b = JSON.parse((await readBody(req)).toString() || '{}') } catch { res.writeHead(400); return res.end('json?') }
    if (b.profile || b.brand) applyConfig(b)
    if (b.restart === true) execFile('sudo', ['-n', 'systemctl', 'restart', 'desk-harness'], () => {})
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }

  if (u.pathname === '/deskd/config/logo' && req.method === 'PUT') {
    const name = String(req.headers['x-filename'] ?? 'logo.png')
    const ext = (/\.(png|jpe?g|svg|webp)$/i.exec(name)?.[1] ?? 'png').toLowerCase()
    mkdirSync(BRAND_DIR, { recursive: true })
    const chunks = []; let size = 0
    for await (const chunk of req) { size += chunk.length; if (size > 5 * 1024 * 1024) { res.writeHead(413); return res.end('too big') } chunks.push(chunk) }
    for (const f of readdirSync(BRAND_DIR)) if (/^logo\./i.test(f)) unlinkSync(join(BRAND_DIR, f))
    const dest = join(BRAND_DIR, `logo.${ext}`)
    writeFileSync(dest, Buffer.concat(chunks), { mode: 0o644 })
    const cur = readProfile() ?? {}
    saveProfileRaw({ ...cur, brand: { ...(cur.brand ?? {}), logo: dest } })
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, logo: dest }))
  }

  if (u.pathname === '/deskd/seed' && req.method === 'POST') {
    let b = {}
    try { b = JSON.parse((await readBody(req)).toString() || '{}') } catch { res.writeHead(400); return res.end('json?') }
    const written = []
    for (const f of Array.isArray(b.files) ? b.files.slice(0, 40) : []) {
      const raw = String(f.path ?? '')
      // A path that tries to leave the Desk folder is refused outright, not "helpfully" rewritten.
      if (raw.includes('..') || raw.startsWith('/') || raw.includes('\\')) continue
      const rel = normalize(raw).replace(/^(\.\/)+/, '')
      if (!rel || rel.startsWith('AGENTS')) continue  // the profile owns AGENTS.md
      const dest = join(WORK, rel)
      if (!dest.startsWith(WORK)) continue
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, String(f.content ?? '').slice(0, 200_000), { mode: 0o644 })
      written.push(rel)
    }
    let seeded = 0
    if (Array.isArray(b.memory) && b.memory.length) {
      // The memory ledger is desk-memory's module — one definition of what is remembered.
      const { append, read, writeBlock, newId, cleanAbout, clean: cleanNote } = await import('../../desk-memory/src/ledger.js')
      const ledger = process.env.DESK_MEMORY_FILE ?? '/srv/desk/memory.jsonl'
      const block = process.env.DESK_MEMORY_BLOCK ?? join(process.env.DSH_HOME ?? '/srv/desk/home', 'AGENTS.md')
      for (const m of b.memory.slice(0, 50)) {
        const text = cleanNote(m.text)
        if (!text) continue
        append(ledger, {
          id: newId(), at: new Date().toISOString(),
          kind: ['fact', 'decision', 'commitment', 'preference'].includes(m.kind) ? m.kind : 'fact',
          about: cleanAbout(m.about), text, pinned: Boolean(m.pinned), sessionId: 'seed',
        })
        seeded++
      }
      writeBlock(block, read(ledger))
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, files: written, memory: seeded }))
  }

  if (u.pathname === '/deskd/record' && req.method === 'POST') {
    let b = {}
    try { b = JSON.parse((await readBody(req)).toString() || '{}') } catch { res.writeHead(400); return res.end('json?') }
    let out
    if (b.op === 'start') out = startRecording()
    else if (b.op === 'stop') out = await stopRecording()
    else if (b.op === 'list') out = { recordings: listRecordings(), recording: Boolean(recorderPid()) }
    else if (b.op === 'link') {
      const f = normalize(String(b.file ?? '')).replace(/^([./\\])+/, '')
      if (!/^[A-Za-z0-9-]+\.mp4$/.test(f) || !existsSync(join(RECORDINGS, f))) { res.writeHead(404); return res.end('gone') }
      const exp = String(Date.now() + 10 * 60 * 1000)
      out = { url: `https://${host}/deskd/record/dl?f=${encodeURIComponent(f)}&exp=${exp}&sig=${sign(`${f}.${exp}`)}` }
    } else if (b.op === 'open-desk') {
      // Point the box's own Chrome at this Desk so a recording shows the chat, not a blank page.
      try {
        const tabs = await fetch(`${CDP}/json`).then(r => r.json())
        const page = tabs.find(t => t.type === 'page')
        if (page) await fetch(`${CDP}/json/new?https://${host}/`, { method: 'PUT' }).catch(() => fetch(`${CDP}/json/new?https://${host}/`))
        out = { ok: true }
      } catch (e) { out = { error: `browser not reachable: ${e.message}` } }
    } else { res.writeHead(400); return res.end('op?') }
    res.writeHead(out.error ? 409 : 200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(out))
  }

  return false
}
