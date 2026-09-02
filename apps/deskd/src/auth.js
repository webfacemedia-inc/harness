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

// Generated once per box; created exclusively so two first requests cannot write different secrets.
let SECRET
function secret() {
  if (SECRET) return SECRET
  if (!existsSync(SECRET_FILE)) { try { writeFileSync(SECRET_FILE, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' }) } catch { /* another worker created it first; read below */ } }
  SECRET = readFileSync(SECRET_FILE, 'utf8').trim()
  return SECRET
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
export function issueSession(user, role = 'owner') {
  const body = Buffer.from(JSON.stringify({ u: user.username, r: role === 'phone' ? 'phone' : 'owner', exp: Date.now() + DAYS * 864e5 })).toString('base64url')
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

const LOGO = '<svg width="30" height="31" viewBox="0 0 171.28 177.92" aria-hidden="true"><path fill="#3499cc" d="M170.38,128.74l.45-.99.36-.72v-.77l.09-.52-.2-.97-.29-.81-.49-.77-.45-.67-46.66-64.72-.23-.36,37.44-22.82.95-2.83-.29-.45-.14-.22v-.14l-.65-.77-.58-.83-.68-.74-.45-.52-.32-.38-.81-.9-.31-.29-.14-.16h0l-.43-.43-.99-.9-2.31-2.56-2.31-2.23-2.54-2.16-2.54-2.11-.9-.67-.9-.45-.9-.29h-1.78l-.92.22-.9.38-.74.67-52.22,33.35-1.33-.38,19.02-40.59-.4-2.7-1.53-1.04-1.66-.81-1.93-.83-2-.67-2.32-.68-2.38-.52-2.61-.52-2.76-.38-1.71-.07-.74.23-.67.36-.67.38-.52.67-.45.88-.38.97-.14.45-34.02,80.01-.38.31-.36.43-.52.31-.67.43-36.48-18.08-2.9.38-.43.68-.27.88-.76,1.94-.88,2.32-.79,2.79-.95,3.6-.83,3.37-.65,3.06-.4,2.92-.14,1.01v.95l.22.9.4.9.43.68.76.61.79.61.97.5.16.09.67.36,1.04.52,1.57.83,1.8.97,2.45,1.26,2.76,1.42,3.26,1.8,1.8.83,1.8.97,1.93.95,2.16,1.13,4.47,2.32,4.99,2.61,5.28,2.77,2.83,1.4,3.06,1.58,6.18,3.21,6.77,3.6.14,1.49-44.26,3.71-2.11,1.8-.13,1.64v1.8l.23,2.03.36,2.16.54,2.16.74,2.47.83,2.54,1.1,2.77.31.74.52.67.5.54.77.36.67.23.88.16h2.09l78.41-10.5,2.81,1.49.74,33.19.97.97.99,1.35.58-.09h.81l.9-.16,1.12-.14,1.12-.31,1.33-.31,1.42-.36,1.57-.31,3.6-1.04,1.8-.45,1.62-.45,1.51-.52,1.4-.43,2.67-.9.97-.61.38-.29.43-.22.31-.38.38-.31.29-.36.31-.31.14-.45v-.22h0l.14-.16v-.45l.14-.38v-1.93l-2.72-62.11,1.19-.97,25.34,36.63,2.59,1.13,1.26-.85,1.51-.95,1.46-1.28,1.66-1.35,1.64-1.64,1.8-1.8,1.8-2.09,2.02-2.18.14-.22.11.02Z"/></svg>'
export function loginPage({ business, error = '', google = false, next = '/' }) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · webfaCe Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light dark;--bg:#fafafa;--card:#fff;--ink:#111111;--mute:#6b6b6b;--line:#e4e4e4;--blue:#3499cc;--blue-ink:#22729c;--err:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#070707;--card:#141414;--ink:#f2f2f2;--mute:#a3a3a3;--line:#282828}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,"Segoe UI",Inter,system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
.card{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:32px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:6px;font-weight:600;font-size:20px}h2{font-family:Fraunces,Georgia,serif;font-weight:600}.brand .wm em{font-style:normal;font-family:Fraunces,Georgia,serif;font-weight:600;font-size:1.1em;color:var(--blue-deep,#1f6f99);margin-left:.22em}
p.sub{margin:0 0 22px;color:var(--mute)}label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}
input:focus{outline:2px solid var(--blue);outline-offset:1px;border-color:var(--blue)}
button{width:100%;margin-top:20px;padding:12px;border:0;border-radius:10px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer}button:hover{background:var(--blue-ink);color:#fff}
.err{background:rgba(180,35,24,.08);color:var(--err);border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:6px}
.or{display:flex;align-items:center;gap:12px;color:var(--mute);font-size:13px;margin:20px 0 0}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
a.g{display:flex;justify-content:center;align-items:center;gap:10px;margin-top:14px;padding:11px;border:1px solid var(--line);border-radius:8px;color:inherit;text-decoration:none;font-weight:600}a.g:hover{border-color:var(--blue)}
.foot{margin-top:22px;font-size:13px;color:var(--mute);text-align:center}
.chk{display:flex;gap:10px;align-items:flex-start;margin-top:14px;font-weight:500;font-size:14px}.chk input{width:auto;margin-top:3px}.chk small{display:block;font-weight:400;color:var(--mute)}
</style>
<body><form class="card" method="post" action="/login">
<div class="brand">${LOGO}<span class="wm">webfaCe<em>Desk</em></span></div>
<p class="sub">${esc(business)}</p>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<input type="hidden" name="next" value="${esc(next)}">
<label for="u">Username</label><input id="u" name="username" autocomplete="username" required autofocus>
<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<label class="chk"><input type="checkbox" name="phone" value="1" id="phone"> <span>This is a phone or shared device <small>— chat, approvals and the browser only; settings stay on your computer</small></span></label>
<button type="submit">Sign in</button>
<script>if (/iPhone|Android|Mobile/i.test(navigator.userAgent)) document.getElementById('phone').checked = true</script>
${google ? `<div class="or">or</div><a class="g" href="/auth/google?next=${encodeURIComponent(next)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.2 5.5-4.7 7.2l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.6z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>Sign in with Google</a>` : ''}
<div class="foot">This Desk belongs to ${esc(business)}. Only its owner can sign in.</div>
</form></body></html>`
}
