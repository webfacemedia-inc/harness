// Sign-in for a Desk computer. Owner accounts live in $DESK_AUTH_FILE
// (/srv/desk/auth.json, 0600): [{ username, email, scrypt: "salt:hash" }].
// Sessions are HMAC-signed cookies (no server state), 30 days.
// Google sign-in is optional: set DESK_SIGNIN_CLIENT_ID/SECRET (a webfaCe
// Web OAuth client, openid+email only) and it appears on the login page;
// only emails listed in auth.json may sign in with it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'

export const AUTH_FILE = process.env.DESK_AUTH_FILE ?? '/srv/desk/auth.json'
const SECRET_FILE = process.env.DESK_SESSION_SECRET_FILE ?? AUTH_FILE.replace(/auth\.json$/, 'session.secret')
export const COOKIE = 'desk_session'
const DAYS = 30

function secret() {
  if (!existsSync(SECRET_FILE)) writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600 })
  return readFileSync(SECRET_FILE, 'utf8').trim()
}
export function readUsers() { return existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf8')) : [] }
export function hashPassword(pw) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(pw, salt, 64).toString('hex')}` }
export function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':'); if (!salt || !hash) return false
  const a = scryptSync(pw, salt, 64), b = Buffer.from(hash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
export function findUser({ username, email }) {
  return readUsers().find(u => (username && u.username === username) || (email && u.email && u.email.toLowerCase() === email.toLowerCase()))
}
export function issueSession(user) {
  const body = Buffer.from(JSON.stringify({ u: user.username, exp: Date.now() + DAYS * 864e5 })).toString('base64url')
  const sig = createHmac('sha256', secret()).update(body).digest('base64url')
  return `${body}.${sig}`
}
export function verifySession(token) {
  if (!token) return null
  const [body, sig] = token.split('.'); if (!body || !sig) return null
  const want = createHmac('sha256', secret()).update(body).digest('base64url')
  if (want.length !== sig.length || !timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
  try { const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return s.exp > Date.now() ? s : null } catch { return null }
}
export function cookieHeader(token, clear = false) {
  return `${COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : DAYS * 86400}`
}
export function cookieOf(req) {
  const m = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); return m?.[1]
}

const LOGO = '<svg width="34" height="34" viewBox="0 0 100 100" aria-hidden="true"><path fill="#3499cc" d="M50 4l9 27 27-9-18 22 22 18-28 3 3 28-15-24-15 24 3-28-28-3 22-18-18-22 27 9z"/></svg>'
export function loginPage({ business, error = '', google = false, next = '/' }) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · webfaCe Desk</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fa;--card:#fff;--ink:#16212b;--mute:#5b6b7a;--line:#dde4ea;--blue:#3499cc;--blue-ink:#22729c;--err:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#0f151b;--card:#161e26;--ink:#eef3f7;--mute:#9db0c0;--line:#25313c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Segoe UI",Inter,system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:32px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px;font-weight:700;font-size:20px}.brand span{font-weight:400}
p.sub{margin:0 0 22px;color:var(--mute)}label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--blue);outline-offset:1px;border-color:var(--blue)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:8px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer}button:hover{background:var(--blue-ink)}
.err{background:rgba(180,35,24,.08);color:var(--err);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:6px}
.or{display:flex;align-items:center;gap:12px;color:var(--mute);font-size:13px;margin:20px 0 0}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
a.g{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:14px;padding:11px;border:1px solid var(--line);border-radius:8px;color:inherit;text-decoration:none;font-weight:600}a.g:hover{border-color:var(--blue)}
.foot{margin-top:22px;font-size:13px;color:var(--mute);text-align:center}
</style>
<body><form class="card" method="post" action="/login">
<div class="brand">${LOGO}webfaCe <span>Desk</span></div>
<p class="sub">${esc(business)}</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<input type="hidden" name="next" value="${esc(next)}">
<label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Sign in</button>
${google ? `<div class="or">or</div><a class="g" href="/auth/google?next=${encodeURIComponent(next)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Sign in with Google</a>` : ''}
<div class="foot">This Desk belongs to ${esc(business)}. Only its owner can sign in.</div>
</form></body></html>`
}
