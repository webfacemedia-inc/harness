#!/usr/bin/env node
// deskd — the small agent that runs on every Desk computer.
//   GET  /healthz                      liveness
//   GET  /deskd/status                 what this box is (slug, host, ready, accounts)
//   GET  /oauth/google/start           send the owner to Google consent (their own app)
//   GET  /oauth/google/callback        store the token on this box, never centrally
//   POST /deskd/google/client          save the owner's pasted OAuth client JSON
// Heartbeats to DESK_API_URL every 60s when set. Loopback only; Caddy fronts it.
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OAuth2Client } from 'google-auth-library'
import { google } from 'googleapis'
import * as files from './files.js'
import * as connections from './connections.js'
import * as profile from './profile.js'
import * as routines from './routines.js'
import * as wf from './webface-oauth.js'
import { layout } from './ui.js'
import * as push from './push.js'
import { usage } from './usage.js'
import { execFile } from 'node:child_process'
import { findUser, checkPassword, issueSession, verifySession, cookieHeader, cookieOf, loginPage } from './auth.js'

const here = dirname(fileURLToPath(import.meta.url))
// Same Google home as the harness's Google connector row, or the token lands where the tools never look.
if (!process.env.GOOGLE_MCP_HOME && process.env.DESK_GOOGLE_HOME) process.env.GOOGLE_MCP_HOME = process.env.DESK_GOOGLE_HOME
const cfg = await import(join(here, '..', '..', 'google-mcp', 'src', 'config.js'))

const PORT = Number(process.env.DESKD_PORT ?? 8090)
const HOST = process.env.DESK_HOST ?? 'localhost'
const SLUG = process.env.DESK_SLUG ?? 'desk'
const API = process.env.DESK_API_URL
const READY = process.env.DESK_READY_FILE ?? '/srv/desk/READY'
const BILLING = process.env.DESK_BILLING_FILE ?? '/srv/desk/billing.json'
const PATCH = process.env.DESK_PROFILE_PATCH ?? '/srv/desk/home/profiles/desk/cordis.patch.yml'
const readBilling = () => { try { return JSON.parse(readFileSync(BILLING, 'utf8')) } catch { return { state: 'ok' } } }
const systemctl = (...a) => new Promise(r => execFile('sudo', ['-n', '/usr/bin/systemctl', ...a], () => r()))
/** past_due → Guided (read-only) until paid; cancelled → harness stopped; ok → restore the owner's mode. */
async function applyBilling(b) {
  writeFileSync(BILLING, JSON.stringify({ ...b, at: new Date().toISOString() }, null, 2), { mode: 0o600 })
  if (!existsSync(PATCH)) return
  let y = readFileSync(PATCH, 'utf8')
  const want = b.state === 'past_due' ? 'read-only' : (b.state === 'ok' ? (b.restoreMode ?? 'read-only') : null)
  if (want) { const m = y.match(/(- id: sandbox-policy\n  config:\n    mode: )(\S+)/); if (m && m[2] !== want) { y = y.replace(m[0], m[1] + want); writeFileSync(PATCH, y) } }
  if (b.state === 'cancelled') await systemctl('stop', 'desk-harness')
  else await systemctl('restart', 'desk-harness')
}
const REDIRECT = `https://${HOST}/oauth/google/callback`
const BUSINESS_ENV = process.env.DESK_BUSINESS ?? 'Your business'
const businessName = () => profile.readProfile()?.business || BUSINESS_ENV
const SIGNIN = process.env.DESK_SIGNIN_CLIENT_ID && process.env.DESK_SIGNIN_CLIENT_SECRET
  ? new OAuth2Client(process.env.DESK_SIGNIN_CLIENT_ID, process.env.DESK_SIGNIN_CLIENT_SECRET, `https://${HOST}/auth/google/callback`) : null
const safeNext = n => (typeof n === 'string' && n.startsWith('/') && !n.startsWith('//')) ? n : '/'
const started = Date.now()

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
const page = (title, body) => layout({ title, business: businessName(), body: `<h1>${title}</h1>${body}` })

let harnessUp = false
async function probeHarness() { try { const r = await fetch('http://127.0.0.1:3080/', { signal: AbortSignal.timeout(2000) }); harnessUp = r.ok } catch { harnessUp = false } }
probeHarness(); setInterval(probeHarness, 3000).unref()
function status() {
  let accounts = []
  try { accounts = cfg.listAccounts() } catch {}
  return {
    slug: SLUG, host: HOST, ready: existsSync(READY), uptimeSec: Math.round((Date.now() - started) / 1000),
    google: { clientConfigured: existsSync(cfg.CLIENT_SECRET), projectId: (() => { try { return cfg.readClient().projectId } catch { return undefined } })(), redirectUri: REDIRECT, accounts },
    webface: wf.status(),
    billing: readBilling(),
    harness: harnessUp,
    push: { devices: push.count() },
    usage: usage(process.env.DESK_TZ ?? 'America/Toronto'),
  }
}

function oauthClient() {
  const { clientId, clientSecret } = cfg.readClient()
  return new OAuth2Client(clientId, clientSecret, REDIRECT)
}

async function readBody(req) {
  const chunks = []; for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://${HOST}`)
  try {
    // ── sign-in (Caddy forward_auth asks /auth/verify for every other route) ──
    if (u.pathname === '/auth/verify') {
      const s = verifySession(cookieOf(req))
      if (s) { res.writeHead(200, { 'x-desk-user': s.u, 'x-desk-role': s.r ?? 'owner' }); return res.end() }
      res.writeHead(401); return res.end()
    }
    if (u.pathname === '/login' && req.method === 'GET' && readBilling().state === 'cancelled') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(page('This Desk is paused', `<p>The subscription for <strong>${businessName()}</strong> has ended, so Desk is paused. Your files and conversations are kept for 30 days.</p><p>To pick up where you left off, write to <a href="mailto:tommy@webfacemedia.com">tommy@webfacemedia.com</a>.</p>`))
    }
    if (u.pathname === '/login' && req.method === 'GET') {
      if (verifySession(cookieOf(req))) { res.writeHead(302, { location: safeNext(u.searchParams.get('next')) }); return res.end() }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(loginPage({ business: businessName(), google: Boolean(SIGNIN), next: safeNext(u.searchParams.get('next')) }))
    }
    if (u.pathname === '/login' && req.method === 'POST') {
      const f = new URLSearchParams(await readBody(req))
      const user = findUser({ username: f.get('username')?.trim() })
      await new Promise(r => setTimeout(r, 300))
      if (!user || !checkPassword(f.get('password') ?? '', user.scrypt)) {
        console.log(`login failed from ${req.headers['x-forwarded-for']?.split(',')[0]?.trim() ?? req.socket.remoteAddress} user=${JSON.stringify((f.get('username') ?? '').slice(0, 40))}`)
        res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(loginPage({ business: businessName(), google: Boolean(SIGNIN), next: safeNext(f.get('next')), error: 'That username or password is not right.' }))
      }
      const landing = profile.isComplete(profile.readProfile()) ? safeNext(f.get('next')) : '/profile'
      res.writeHead(302, { location: landing, 'set-cookie': cookieHeader(issueSession(user, f.get('phone') ? 'phone' : 'owner')) }); return res.end()
    }
    if (u.pathname === '/logout') { res.writeHead(302, { location: '/login', 'set-cookie': cookieHeader('', true) }); return res.end() }
    if (u.pathname === '/auth/google') {
      if (!SIGNIN) { res.writeHead(404); return res.end('Google sign-in is not set up on this Desk.') }
      const url = SIGNIN.generateAuthUrl({ scope: ['openid', 'email'], state: safeNext(u.searchParams.get('next')), prompt: 'select_account' })
      res.writeHead(302, { location: url }); return res.end()
    }
    if (u.pathname === '/auth/google/callback') {
      if (!SIGNIN) { res.writeHead(404); return res.end() }
      const code = u.searchParams.get('code')
      if (!code) { res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }); return res.end(loginPage({ business: businessName(), google: true, error: 'Google did not sign you in.' })) }
      const { tokens } = await SIGNIN.getToken(code)
      const ticket = await SIGNIN.verifyIdToken({ idToken: tokens.id_token, audience: process.env.DESK_SIGNIN_CLIENT_ID })
      const email = ticket.getPayload()?.email
      const user = email && findUser({ email })
      if (!user) { res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }); return res.end(loginPage({ business: businessName(), google: true, error: `${email ?? 'That account'} is not an owner of this Desk.` })) }
      res.writeHead(302, { location: safeNext(u.searchParams.get('state')), 'set-cookie': cookieHeader(issueSession(user)) }); return res.end()
    }
    if (u.pathname === '/browser') {
      if (!verifySession(cookieOf(req))) { res.writeHead(302, { location: '/login?next=/browser' }); return res.end() }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(layout({ title: 'Browser', business: businessName(), head: '<style>main{max-width:none;padding:0;height:calc(100dvh - 53px)}iframe{display:block;width:100%;height:100%;border:0;background:#111}.bar{display:flex;gap:10px;align-items:center;padding:8px 14px;font-size:13px;color:var(--mute);background:var(--card);border-bottom:1px solid var(--line)}@media(max-width:600px){.bar span{display:none}main{height:calc(100dvh - 53px)}}</style>', body: `<div class="bar"><span>Desk's browser. Tap inside to take the mouse — sign in here once and Desk keeps the session.</span><a class="btn" href="/" style="margin:0 0 0 auto;padding:7px 12px;font-size:13px">I'm done — back to Desk</a></div><iframe src="/vnc/vnc.html?autoconnect=1&resize=scale&show_dot=1" allow="clipboard-read; clipboard-write" title="Desk browser"></iframe>` }))
    }
    if (u.pathname === '/routines' || u.pathname.startsWith('/routines/')) {
      if (!verifySession(cookieOf(req))) { res.writeHead(302, { location: '/login?next=/routines' }); return res.end() }
      if (await routines.handle(req, res, u, { business: businessName(), readBody, tz: process.env.DESK_TZ ?? 'America/Toronto' }) !== false) return
    }
    if (u.pathname === '/profile') {
      if (!verifySession(cookieOf(req))) { res.writeHead(302, { location: `/login?next=/profile` }); return res.end() }
      if (await profile.handle(req, res, u, { business: businessName(), readBody }) !== false) return
    }
    if (u.pathname === '/connections' || u.pathname.startsWith('/connections/')) {
      if (!verifySession(cookieOf(req))) { res.writeHead(302, { location: `/login?next=${encodeURIComponent(u.pathname)}` }); return res.end() }
      const saveClient = raw => { mkdirSync(dirname(cfg.CLIENT_SECRET), { recursive: true, mode: 0o700 }); writeFileSync(cfg.CLIENT_SECRET, JSON.stringify(raw, null, 2), { mode: 0o600 }); chmodSync(cfg.CLIENT_SECRET, 0o600) }
      if (await connections.handle(req, res, u, { business: businessName(), host: HOST, cfg: { ...cfg, saveClient }, readBody, status }) !== false) return
    }
    if (u.pathname === '/files' || u.pathname.startsWith('/files/')) {
      if (!verifySession(cookieOf(req))) { res.writeHead(302, { location: `/login?next=${encodeURIComponent(u.pathname)}` }); return res.end() }
      if (await files.handle(req, res, u, { business: businessName() }) !== false) return
    }
    if (u.pathname === '/deskd/billing' && req.method === 'POST') {
      const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      if (!process.env.DESK_BOX_TOKEN || tok !== process.env.DESK_BOX_TOKEN) { res.writeHead(401); return res.end() }
      const b = JSON.parse(await readBody(req) || '{}')
      if (!['ok', 'past_due', 'cancelled'].includes(b.state)) { res.writeHead(400); return res.end('state?') }
      const cur = readBilling()
      const restoreMode = cur.state === 'ok' ? (readFileSync(PATCH, 'utf8').match(/mode: (\S+)/)?.[1] ?? 'read-only') : (cur.restoreMode ?? 'read-only')
      await applyBilling({ state: b.state, portalUrl: b.portalUrl ?? cur.portalUrl ?? '', restoreMode })
      return json(res, 200, { ok: true, state: b.state })
    }
    if (u.pathname === '/sw.js') { res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache', 'service-worker-allowed': '/' }); return res.end(push.SW) }
    if (u.pathname === '/deskd/notify' && req.method === 'POST') {
      const ra = req.socket.remoteAddress; if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(ra)) { res.writeHead(403); return res.end() }
      const notice = JSON.parse(await readBody(req) || '{}'); if (!notice.kind || !notice.title) { res.writeHead(400); return res.end() }
      const r = await push.send(HOST, notice); console.log('notify', notice.kind, notice.sessionId, r); return json(res, 200, r)
    }
    if (u.pathname === '/deskd/push/key') { if (!verifySession(cookieOf(req))) { res.writeHead(401); return res.end() } return json(res, 200, { key: push.publicKey(HOST), devices: push.count() }) }
    if (u.pathname === '/deskd/push/subscribe' && req.method === 'POST') {
      if (!verifySession(cookieOf(req))) { res.writeHead(401); return res.end() }
      const b = JSON.parse(await readBody(req) || '{}'); if (!b.subscription?.endpoint) { res.writeHead(400); return res.end('subscription?') }
      return json(res, 200, { devices: push.subscribe(b.subscription, b.label) })
    }
    if (u.pathname === '/deskd/push/test' && req.method === 'POST') {
      if (!verifySession(cookieOf(req))) { res.writeHead(401); return res.end() }
      return json(res, 200, await push.send(HOST, { kind: 'test', sessionId: '', title: 'Desk notifications are on', body: 'You will hear from Desk when it needs you.' }))
    }
    if (u.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok') }
    if (u.pathname === '/deskd/status') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(status())) }
    if (u.pathname === '/deskd/google/client' && req.method === 'POST') {
      const raw = JSON.parse(await readBody(req))
      const c = raw.web ?? raw.installed
      if (!c?.client_id || !c?.client_secret) { res.writeHead(400); return res.end('That is not a Google OAuth client JSON (expected a "web" client).') }
      mkdirSync(dirname(cfg.CLIENT_SECRET), { recursive: true, mode: 0o700 })
      writeFileSync(cfg.CLIENT_SECRET, JSON.stringify(raw, null, 2), { mode: 0o600 }); chmodSync(cfg.CLIENT_SECRET, 0o600)
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, redirectUri: REDIRECT }))
    }
    if (u.pathname === '/oauth/webface/start') {
      if (!verifySession(cookieOf(req))) { res.writeHead(302, { location: '/login?next=/connections' }); return res.end() }
      res.writeHead(302, { location: await wf.startUrl(HOST) }); return res.end()
    }
    if (u.pathname === '/oauth/webface/callback') {
      const code = u.searchParams.get('code'), state = u.searchParams.get('state') ?? '', err = u.searchParams.get('error')
      if (!code) { res.writeHead(302, { location: `/connections?err=${encodeURIComponent(`webfaCeMEdia sign-in did not complete (${err ?? 'no code'}).`)}` }); return res.end() }
      try {
        const who = await wf.finish(HOST, code, state)
        if (who.error) { wf.disconnect(); res.writeHead(302, { location: `/connections?err=${encodeURIComponent(`Signed in, but webfaCeMEdia could not match your account to a client (${who.error}${who.detail ? ': ' + who.detail : ''}). Ask webfaCeMEdia to link your account.`)}` }); return res.end() }
        const list = connections.readServers().filter(x => x.name !== 'webface')
        list.push({ name: 'webface', transport: 'streamable-http', url: `http://127.0.0.1:${PORT}/mcp/webface`, headers: {} })
        connections.writeServers(list); connections.restartHarness()
        res.writeHead(302, { location: `/connections?msg=${encodeURIComponent(`webfaCeMEdia connected as ${who.email ?? 'you'}${who.client ? ` (${who.client})` : ''}. Desk is restarting — give it half a minute.`)}` }); return res.end()
      } catch (e) { res.writeHead(302, { location: `/connections?err=${encodeURIComponent(e.message)}` }); return res.end() }
    }
    if (u.pathname === '/mcp/webface') {
      // Loopback only: the harness calls deskd directly; Caddy never routes this path.
      if (req.socket.remoteAddress !== '127.0.0.1' && req.socket.remoteAddress !== '::ffff:127.0.0.1' && req.socket.remoteAddress !== '::1') { res.writeHead(403); return res.end() }
      return wf.proxy(req, res, HOST, req.method === 'GET' ? undefined : await readBody(req))
    }
    if (u.pathname === '/oauth/google/start') {
      const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: cfg.SCOPES })
      res.writeHead(302, { location: url }); return res.end()
    }
    if (u.pathname === '/oauth/google/callback') {
      const code = u.searchParams.get('code'); const err = u.searchParams.get('error')
      if (!code) { res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page('Not connected', `<p>${err ?? 'Google sent no code.'}</p>`)) }
      const oauth = oauthClient()
      const { tokens } = await oauth.getToken(code); oauth.setCredentials(tokens)
      const me = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get()
      const email = me.data.email; if (!email) throw new Error('Google returned no email address')
      cfg.writeToken(email, tokens)
      res.writeHead(303, { location: `/connections?msg=${encodeURIComponent(email + ' connected.')}` }); return res.end()
    }
    res.writeHead(404); res.end('not found')
  } catch (e) {
    console.error(e)
    const msg = String(e.message ?? e)
    const hint = /redirect_uri_mismatch/.test(msg) ? 'The redirect URI on the Google client does not match this Desk. Open Connections → "Redirect URIs" and add the one shown there.'
      : /access_denied|unverified|not completed the Google verification/.test(msg) ? 'Google blocked the sign-in because this account is not a test user of your app yet. Open Connections → "Add test users" and add the Google address you are signing in with.'
      : /accessNotConfigured|has not been used in project|API has not been enabled/i.test(msg) ? 'One of the Google APIs is not enabled on your project. Open Connections and press each "Enable … API" link.'
      : 'Try again from Desk\'s Connections page.'
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page('Google sign-in did not complete', `<p>${msg}</p><p>${hint}</p><p><a href="/connections">Back to Connections</a></p>`))
  }
})
server.listen(PORT, '127.0.0.1', () => console.log(`deskd on 127.0.0.1:${PORT} for ${SLUG} (${HOST})`))

if (API) {
  const beat = async () => {
    try { await fetch(`${API}/v1/boxes/${SLUG}/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DESK_BOX_TOKEN ?? ''}` }, body: JSON.stringify(status()) }) }
    catch (e) { console.error('heartbeat failed:', e.message) }
  }
  beat(); setInterval(beat, 60_000).unref()
}
