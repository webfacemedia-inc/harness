// Step-by-step setup wizards (Google's own app, WordPress). One step per
// screen, a button per step, and a check before "Next" wherever we can
// verify something (pasted JSON, site reachable, credentials accepted).
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { layout, ICONS } from './ui.js'
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const PROGRESS = process.env.DESK_WIZARD_FILE ?? '/srv/desk/wizards.json'
const readP = () => { try { return JSON.parse(readFileSync(PROGRESS, 'utf8')) } catch { return {} } }
const writeP = (p) => { mkdirSync(dirname(PROGRESS), { recursive: true }); writeFileSync(PROGRESS, JSON.stringify(p, null, 2), { mode: 0o600 }) }

function shell(title, business, inner) { return layout({ title, business, back: '/connections', body: `<script>function cp(t,b){navigator.clipboard.writeText(t).then(()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)})}</script>` + inner }) }
const bar = (n, total, done) => `<div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i + 1 < n || done.includes(i + 1) ? 'done' : i + 1 === n ? 'now' : ''}"></i>`).join('')}</div>`
const copyRow = (t) => `<div class="copy"><code>${esc(t)}</code><button type="button" class="ghost" onclick="cp(${JSON.stringify(t)},this)">Copy</button></div>`

// ── Google: the owner's own Google app ──────────────────────────────────────
export function googleStep({ business, host, step, msg, err, google, cfg }) {
  const P = readP().google ?? {}; const done = P.done ?? []
  const uri = `https://${host}/oauth/google/callback`; const pid = google.projectId
  const q = pid ? `?project=${encodeURIComponent(pid)}` : ''
  const next = (n, label = 'I did this — next') => `<form method="post" action="/connections/google/setup" style="display:inline"><input type="hidden" name="done" value="${n}"><button type="submit">${label}</button></form>`
  const back = (n) => n > 1 ? `<a class="btn ghost" href="/connections/google/setup?step=${n - 1}">Back</a>` : '<span></span>'
  const S = {
    1: ['Create a Google Cloud project', `<p>Google needs a project that belongs to <strong>${esc(business)}</strong>. Name it after the business and press <em>Create</em>. It takes about ten seconds to appear.</p><p class="mute">Use the Google account the business runs on (the one whose email Desk should read).</p><a class="btn" href="https://console.cloud.google.com/projectcreate" target="desk-console" rel="noopener">Open “Create project”${ICONS.ext}</a>`],
    2: ['Turn on the four Google APIs', `<p>Press <em>Enable</em> on each of these. They open in one Google tab; switch back here after each one.</p>${['gmail.googleapis.com|Gmail', 'calendar-json.googleapis.com|Calendar', 'drive.googleapis.com|Drive', 'people.googleapis.com|People (contacts)'].map(x => { const [api, l] = x.split('|'); return `<a class="btn ghost" href="https://console.cloud.google.com/apis/library/${api}${q}" target="desk-console" rel="noopener">Enable ${l}${ICONS.ext}</a>` }).join('')}`],
    3: ['Set up the consent screen', `<p>Open <em>Google Auth Platform</em> → <em>Get started</em>. App name: <strong>${esc(business)}</strong>. Support and contact email: yours. Audience: <strong>External</strong>. Finish the short form.</p><a class="btn" href="https://console.cloud.google.com/auth/overview${q}" target="desk-console" rel="noopener">Open Google Auth Platform${ICONS.ext}</a>`],
    4: ['Add yourself as a test user', `<p>Until Google reviews the app, only listed “test users” can sign in. Under <em>Audience</em> → <em>Test users</em> add the Google address you will connect (the business mailbox).</p><a class="btn" href="https://console.cloud.google.com/auth/audience${q}" target="desk-console" rel="noopener">Open Audience${ICONS.ext}</a>`],
    5: ['Create the client', `<p><em>Clients</em> → <em>Create client</em>. Type: <strong>Web application</strong>. Name: <strong>Desk</strong>. Under <em>Authorised redirect URIs</em> press <em>Add URI</em> and paste exactly:</p>${copyRow(uri)}<p>Press <em>Create</em>, then <em>Download JSON</em> on the new client.</p><a class="btn" href="https://console.cloud.google.com/auth/clients/create${q}" target="desk-console" rel="noopener">Open “Create client”${ICONS.ext}</a>`],
    6: ['Paste the client file', `<p>Open the downloaded JSON file, select all, copy, and paste it here. Desk checks it before saving.</p><form method="post" action="/connections/google/client"><input type="hidden" name="from" value="wizard"><textarea name="json" placeholder='{"web":{"client_id":"…"}}' required></textarea><button type="submit">Check and save</button></form>`],
    7: ['Connect the Google account', `<p>${google.accounts?.length ? `Connected: <strong>${google.accounts.map(esc).join(', ')}</strong>. You can connect another account or go back to Connections.` : 'Sign in with the business Google account and allow the permissions. Your sign-in stays on this Desk.'}</p><a class="btn" href="/oauth/google/start">${google.accounts?.length ? 'Connect another account →' : 'Connect a Google account →'}</a> <a class="btn ghost" href="/connections">Back to Connections</a>`],
  }
  const [title, body] = S[step]
  return shell('Set up Google', business, `${bar(step, 7, done)}<p class="eyebrow">${ICONS.mail} Google · step ${step} of 7</p><h1>${title}</h1>${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${err ? `<div class="msg err">${esc(err)}</div>` : ''}<div class="card">${body}</div><div class="nav">${back(step)}${step < 6 ? next(step) : step === 6 ? (google.clientConfigured ? `<a class="btn" href="/connections/google/setup?step=7">Next</a>` : '<span></span>') : ''}</div>`)
}
export function googleMarkDone(n) { const p = readP(); const g = p.google ?? { done: [] }; if (!g.done.includes(n)) g.done.push(n); p.google = g; writeP(p) }

// ── WordPress ────────────────────────────────────────────────────────────────
export function wpStep({ business, step, msg, err, state }) {
  const P = readP().wordpress ?? {}; const url = state?.url ?? P.url ?? ''
  const S = {
    1: ['Your website address', `<p>Enter the site address. Desk checks that it is a WordPress site it can talk to.</p><form method="post" action="/connections/wordpress/setup"><input type="hidden" name="step" value="1"><label for="u">Site address</label><input id="u" name="url" type="url" placeholder="https://www.yourbusiness.com" value="${esc(url)}" required><button type="submit">Check site</button></form>`],
    2: ['Create an application password', `<p>WordPress found at <strong>${esc(url)}</strong>${P.name ? ` (“${esc(P.name)}”)` : ''}. Now sign in to its admin and, on your profile page, scroll to <em>Application Passwords</em>: enter the name <strong>Desk</strong> and press <em>Add New Application Password</em>. Copy the password it shows (spaces are fine) — it is shown once.</p><a class="btn" href="${esc(url)}/wp-admin/profile.php#application-passwords-section" target="desk-console" rel="noopener">Open my WordPress profile${ICONS.ext}</a><p class="mute">Don't see “Application Passwords”? Your host may disable it or the site is not on HTTPS — ask them to enable it.</p><div class="nav"><a class="btn ghost" href="/connections/wordpress/setup?step=1">Back</a><a class="btn" href="/connections/wordpress/setup?step=3">I have the password — next</a></div>`],
    3: ['Connect', `<p>Your WordPress username (not email, unless that is your username) and the application password from the previous step. Desk tests them against ${esc(url)} before saving.</p><form method="post" action="/connections/wordpress"><input type="hidden" name="url" value="${esc(url)}"><input type="hidden" name="from" value="wizard"><label for="n">WordPress username</label><input id="n" name="user" required autocomplete="off"><label for="p">Application password</label><input id="p" name="password" type="password" required autocomplete="off"><button type="submit">Test and connect</button></form><div class="nav"><a class="btn ghost" href="/connections/wordpress/setup?step=2">Back</a><span></span></div>`],
  }
  const [title, body] = S[step]
  return shell('Connect WordPress', business, `${bar(step, 3, [])}<p class="eyebrow">${ICONS.wordpress} WordPress · step ${step} of 3</p><h1>${title}</h1>${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${err ? `<div class="msg err">${esc(err)}</div>` : ''}<div class="card">${body}</div>`)
}
export async function wpProbe(url) {
  const base = url.replace(/\/+$/, '')
  const r = await fetch(`${base}/wp-json/`, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } }).catch(() => null)
  if (!r || !r.ok) return { ok: false, why: r ? `The site answered ${r.status} at /wp-json — it does not look like WordPress, or its REST API is turned off.` : 'The site did not answer. Check the address (including https://).' }
  const j = await r.json().catch(() => null); if (!j?.namespaces?.some(n => n.startsWith('wp/v2'))) return { ok: false, why: 'The site answered, but not with the WordPress REST API (wp/v2). It may be a different platform.' }
  const p = readP(); p.wordpress = { url: base, name: j.name ?? '' }; writeP(p)
  return { ok: true, name: j.name ?? '', url: base }
}
