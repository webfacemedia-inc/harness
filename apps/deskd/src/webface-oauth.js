// webfaCeMEdia connection = the owner signs in to webfaCeMEdia (OAuth 2.1 +
// PKCE, dynamic client registration — the same flow Claude's connector uses).
// The platform decides which client/org they are. Tokens stay on this box;
// the harness talks to a loopback proxy (/mcp/webface) that injects the
// current access token and refreshes it, so the connector row needs no secret.
import { existsSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'

const RESOURCE = 'https://mcp.webfacemedia.com'
const MCP_URL = `${RESOURCE}/mcp`
export const STATE_FILE = process.env.DESK_WEBFACE_OAUTH_FILE ?? '/srv/desk/webface-oauth.json'
const read = () => { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} } }
const write = (s) => { writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 }); chmodSync(STATE_FILE, 0o600) }
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let meta
async function metadata() {
  if (meta) return meta
  const pr = await (await fetch(`${RESOURCE}/.well-known/oauth-protected-resource`)).json()
  const as = pr.authorization_servers[0]
  meta = await (await fetch(`${as}/.well-known/oauth-authorization-server`)).json()
  return meta
}
async function client(host) {
  const s = read()
  if (s.client?.client_id && s.client.redirect === `https://${host}/oauth/webface/callback`) return s.client
  const m = await metadata()
  const r = await fetch(m.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: `webfaCe Desk (${host})`, redirect_uris: [`https://${host}/oauth/webface/callback`], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'openid email profile offline_access user:org:read' }) })
  const j = await r.json(); if (!r.ok || !j.client_id) throw new Error(`registration failed: ${JSON.stringify(j).slice(0, 200)}`)
  const c = { client_id: j.client_id, redirect: `https://${host}/oauth/webface/callback` }
  write({ ...s, client: c }); return c
}

/** Where to send the owner. Stores verifier + state for the callback. */
export async function startUrl(host) {
  const m = await metadata(); const c = await client(host)
  const verifier = b64url(randomBytes(48)); const state = b64url(randomBytes(16))
  write({ ...read(), pending: { verifier, state, at: Date.now() } })
  const q = new URLSearchParams({ response_type: 'code', client_id: c.client_id, redirect_uri: c.redirect, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', scope: 'openid email profile offline_access user:org:read', state, resource: RESOURCE })
  return `${m.authorization_endpoint}?${q}`
}

/** Exchange the code; returns the identity we could learn. */
export async function finish(host, code, state) {
  const s = read(); const p = s.pending
  if (!p || p.state !== state || Date.now() - p.at > 15 * 60_000) throw new Error('This sign-in link is stale — start again from Connections.')
  const m = await metadata(); const c = await client(host)
  const r = await fetch(m.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: c.redirect, client_id: c.client_id, code_verifier: p.verifier, resource: RESOURCE }) })
  const t = await r.json(); if (!r.ok || !t.access_token) throw new Error(`webfaCeMEdia did not issue a token: ${t.error_description ?? t.error ?? r.status}`)
  const tokens = { access: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 }
  const who = await identity(tokens.access).catch(() => ({}))
  write({ client: c, tokens, who, connectedAt: new Date().toISOString() })
  return who
}

async function identity(access) {
  // Ask the MCP itself who we are: initialize succeeds only when the tenant resolves.
  const r = await fetch(MCP_URL, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'webface-desk', version: '1' } } }) })
  const text = await r.text()
  if (!r.ok) { let j; try { j = JSON.parse(text) } catch { j = {} } return { error: j.error ?? `HTTP ${r.status}`, detail: j.detail ?? '' } }
  let email
  try { const u = await (await fetch('https://clerk.webfacemedia.com/oauth/userinfo', { headers: { authorization: `Bearer ${access}` } })).json(); email = u.email } catch {}
  // Which client? list_clients returns the one tenant this token is scoped to.
  let client
  try {
    const lc = await fetch(MCP_URL, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_clients', arguments: {} } }) })
    const body = (await lc.text()).split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l)).pop()
    const txt = body?.result?.content?.map(c => c.text).join('') ?? ''
    client = JSON.parse(txt).clients?.map(c => c.slug).join(', ')
  } catch {}
  return { email, client }
}

async function accessToken(host) {
  const s = read(); if (!s.tokens) return null
  if (Date.now() < s.tokens.expiresAt - 60_000) return s.tokens.access
  if (!s.tokens.refresh) return s.tokens.access
  const m = await metadata(); const c = await client(host)
  const r = await fetch(m.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.tokens.refresh, client_id: c.client_id, resource: RESOURCE }) })
  const t = await r.json(); if (!r.ok || !t.access_token) { console.error('webface refresh failed', t.error ?? r.status); return s.tokens.access }
  s.tokens = { access: t.access_token, refresh: t.refresh_token ?? s.tokens.refresh, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 }; write(s)
  return s.tokens.access
}

export function status() { const s = read(); return s.tokens ? { connected: true, ...(s.who ?? {}), connectedAt: s.connectedAt } : { connected: false } }
export function disconnect() { const s = read(); if (existsSync(STATE_FILE)) unlinkSync(STATE_FILE); if (s.client) write({ client: s.client }) }

/** Loopback proxy: the harness posts MCP traffic here; we add the live token. */
export async function proxy(req, res, host, body) {
  const token = await accessToken(host)
  if (!token) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'webfaCeMEdia is not connected' })) }
  const up = await fetch(MCP_URL, { method: req.method, headers: { authorization: `Bearer ${token}`, 'content-type': req.headers['content-type'] ?? 'application/json', accept: req.headers.accept ?? 'application/json, text/event-stream', ...(req.headers['mcp-session-id'] ? { 'mcp-session-id': req.headers['mcp-session-id'] } : {}) }, body: req.method === 'GET' ? undefined : body, signal: AbortSignal.timeout(120000) })
  const h = { 'content-type': up.headers.get('content-type') ?? 'application/json' }; const sid = up.headers.get('mcp-session-id'); if (sid) h['mcp-session-id'] = sid
  res.writeHead(up.status, h)
  if (!up.body) return res.end()
  for await (const chunk of up.body) res.write(chunk)
  res.end()
}
