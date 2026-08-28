// Connections: the owner connects Google (their OWN Google app — Google will
// not allow a shared one for Gmail scopes) and adds any MCP server. MCP rows
// are written into the Desk profile patch and the harness is restarted.
import { writeAtomic } from './fsx.js'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { layout, ICONS } from './ui.js'
import * as wiz from './wizards.js'

const PATCH = process.env.DESK_PROFILE_PATCH ?? '/srv/desk/home/profiles/desk/cordis.patch.yml'
const NAME = /^[a-z][a-z0-9-]{1,30}$/
const MARK_BEGIN = '# --- connections (managed by Desk; edit from the Connections page) ---'
const MARK_END = '# --- end connections ---'
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const yq = s => JSON.stringify(String(s))

export { writeServers, restartHarness }
export function readServers() {
  if (!existsSync(PATCH)) return []
  const s = readFileSync(PATCH, 'utf8'); const a = s.indexOf(MARK_BEGIN), b = s.indexOf(MARK_END)
  if (a < 0 || b < 0) return []
  const block = s.slice(a, b)
  return [...block.matchAll(/# server: (\{.*\})/g)].map(m => JSON.parse(m[1]))
}
function writeServers(list) {
  let s = existsSync(PATCH) ? readFileSync(PATCH, 'utf8') : ''
  const a = s.indexOf(MARK_BEGIN), b = s.indexOf(MARK_END)
  if (a >= 0 && b >= 0) s = s.slice(0, a) + s.slice(b + MARK_END.length)
  const rows = list.map(x => {
    const head = `# server: ${JSON.stringify(x)}\n    - id: mcp-${x.name}\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: ${yq(x.name)}\n        toolCallTimeoutMs: 90000\n`
    return x.transport === 'stdio'
      ? head + `        transport: stdio\n        command: ${yq(x.command)}\n        args: [${x.args.map(yq).join(', ')}]\n        env:\n          PATH: '/usr/local/bin:/usr/bin:/bin'\n${Object.entries(x.env ?? {}).map(([k, v]) => `          ${yq(k)}: ${yq(v)}\n`).join('')}`
      : head + `        transport: streamable-http\n        url: ${yq(x.url)}\n        headers:\n${Object.entries(x.headers).map(([k, v]) => `          ${yq(k)}: ${yq(v)}\n`).join('') || '          {}\n'}`
  }).join('')
  // New plugin rows only mount from an `insert:` list; a bare top-level id
  // would be read as a patch to an existing row and silently ignored.
  const block = rows ? `- insert:\n${rows}` : ''
  s = s.trimEnd() + `\n\n${MARK_BEGIN}\n${block}${MARK_END}\n`
  writeAtomic(PATCH, s)  // holds MCP headers / app passwords: private + atomic
}
function restartHarness() {
  return new Promise(r => execFile('sudo', ['-n', '/usr/bin/systemctl', 'restart', 'desk-harness'], () => r()))
}

function shell(title, inner, business) { return layout({ title, business, body: inner }) }

export function page({ business, host, google, webface, servers, msg, err }) {
  const gc = google.clientConfigured, accounts = google.accounts
  const inner = `<h1>Connections</h1><p class="sub">Desk uses these on your behalf. Every account here is yours — nothing is shared with anyone else.</p>
${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${err ? `<div class="msg err">${esc(err)}</div>` : ''}
<section><h2>${ICONS.mail}Google — Gmail, Calendar, Drive, Contacts ${accounts.length ? `<span class="pill">${accounts.length} connected</span>` : gc ? '<span class="pill off">app saved · no account yet</span>' : '<span class="pill off">not set up</span>'}</h2>
<p style="color:var(--mute);margin:0 0 8px">Google requires each business to use its own Google app for email access. It takes about five minutes and is done once.</p>
${accounts.length ? accounts.map(a => `<div class="row"><span>${esc(a)}<small>Gmail · Calendar · Drive (read) · Contacts (read)</small></span><form method="post" action="/connections/google/disconnect" style="margin:0"><input type="hidden" name="account" value="${esc(a)}"><button class="quiet" type="submit">Disconnect</button></form></div>`).join('') : ''}
<a class="btn" href="/connections/google/setup?step=${gc ? 7 : 1}">${gc ? (accounts.length ? 'Manage Google' : 'Finish Google setup →') : 'Set up Google — step by step →'}</a>
<details><summary style="font-size:13px">${gc ? 'Replace the Google app (paste JSON)' : 'Already have the client JSON? Paste it'}</summary>
<ol>
<li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com/projectcreate</a>, name the project after your business, create it.</li>
<li>Enable the APIs: <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">Gmail</a>, <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Calendar</a>, <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Drive</a>, <a href="https://console.cloud.google.com/apis/library/people.googleapis.com" target="_blank" rel="noopener">People</a> — press <em>Enable</em> on each.</li>
<li><a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform → Get started</a>: app name = your business, your email as support and developer contact, audience <strong>External</strong>. Then under <em>Audience</em> add the Google account(s) you will connect as <strong>test users</strong>.</li>
<li><a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener">Create an OAuth client</a>: type <strong>Web application</strong>, name "Desk", and under <em>Authorised redirect URIs</em> add exactly:<br><code>https://${esc(host)}/oauth/google/callback</code></li>
<li>Press <em>Download JSON</em> on the new client and paste the file's contents below.</li>
</ol>
<form method="post" action="/connections/google/client"><label for="cj">Client JSON</label><textarea id="cj" name="json" placeholder='{"web":{"client_id":"…","client_secret":"…",…}}' required></textarea><button type="submit">Save Google app</button></form>
</details>
${gc ? `<div class="row" style="border-top:0;padding-top:4px"><span><strong>Google app saved</strong><small>project <code>${esc(google.projectId ?? '?')}</code>. If the sign-in shows "access blocked" or "API not enabled", use these — they open on your project:</small>
<small style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px 14px">${['gmail.googleapis.com|Gmail API', 'calendar-json.googleapis.com|Calendar API', 'drive.googleapis.com|Drive API', 'people.googleapis.com|People API'].map(x => { const [api, label] = x.split('|'); return `<a href="https://console.cloud.google.com/apis/library/${api}?project=${encodeURIComponent(google.projectId ?? '')}" target="_blank" rel="noopener">Enable ${label}</a>` }).join('')}<a href="https://console.cloud.google.com/auth/audience?project=${encodeURIComponent(google.projectId ?? '')}" target="_blank" rel="noopener">Add test users</a><a href="https://console.cloud.google.com/auth/clients?project=${encodeURIComponent(google.projectId ?? '')}" target="_blank" rel="noopener">Redirect URIs</a></small></span></div>
<a class="btn" href="/oauth/google/start">Connect a Google account →</a>` : ''}
</section>

${(() => { const wfs = webface ?? { connected: false }; return `<section><h2>${ICONS.webface}webfaCeMEdia — your website, campaigns, contacts and analytics ${wfs.connected ? '<span class="pill">connected</span>' : '<span class="pill off">not connected</span>'}</h2>
<p style="color:var(--mute);margin:0 0 8px">If webfaCeMEdia built or runs your website, sign in with your webfaCeMEdia account and Desk can update pages, draft campaigns, look up contacts and read your analytics — with your approval on anything that goes live.</p>
${wfs.connected ? `<div class="row"><span><strong>${esc(wfs.email ?? 'Signed in')}</strong><small>${wfs.client ? 'client: ' + esc(wfs.client) + ' · ' : ''}connected ${esc((wfs.connectedAt ?? '').slice(0, 10))}</small></span><form method="post" action="/connections/mcp/remove" style="margin:0"><input type="hidden" name="name" value="webface"><button class="quiet" type="submit">Disconnect</button></form></div>`
: `<a class="btn" href="/oauth/webface/start">Sign in with webfaCeMEdia →</a>`}
</section>` })()}
${(() => { const w = servers.find(x => x.name === 'wordpress'); return `<section><h2>${ICONS.wordpress}WordPress ${w ? '<span class="pill">connected</span>' : '<span class="pill off">not connected</span>'}</h2>
<p style="color:var(--mute);margin:0 0 8px">If your website runs on WordPress, connect it with an Application Password and Desk can read pages and posts, draft new ones, update content and upload images — publishing and edits to live pages always wait for your approval.</p>
${w ? `<div class="row"><span><strong>${esc(w.env?.WP_URL ?? '')}</strong><small>as ${esc(w.env?.WP_USER ?? '')} · posts, pages, media</small></span><form method="post" action="/connections/mcp/remove" style="margin:0"><input type="hidden" name="name" value="wordpress"><button class="quiet" type="submit">Disconnect</button></form></div>`
: `<a class="btn" href="/connections/wordpress/setup?step=1">Connect WordPress — step by step →</a>
<details><summary style="font-size:13px">Have everything already? Enter it here</summary>
<ol><li>In WordPress go to <strong>Users → Profile</strong>, scroll to <strong>Application Passwords</strong>, enter the name <code>Desk</code> and press <em>Add New Application Password</em>.</li><li>Copy the password it shows (spaces are fine) and paste it below with your WordPress username and the site address.</li></ol>
<form method="post" action="/connections/wordpress"><label for="wpu">Site address</label><input id="wpu" name="url" type="url" placeholder="https://www.yourbusiness.com" required><label for="wpn">WordPress username</label><input id="wpn" name="user" required autocomplete="off"><label for="wpp">Application password</label><input id="wpp" name="password" type="password" required autocomplete="off"><button type="submit">Connect WordPress</button></form></details>`}
</section>` })()}
<section><h2>${ICONS.plug}Other tools ${servers.filter(x => !['webface', 'wordpress'].includes(x.name)).length ? `<span class="pill">${servers.filter(x => x.name !== 'webface').length} added</span>` : ''}</h2>
<p style="color:var(--mute);margin:0 0 8px">Add any tool server your business uses (MCP). Your team sees its tools after a short restart.</p>
${servers.filter(x => !['webface', 'wordpress'].includes(x.name)).map(s => `<div class="row"><span><strong>${esc(s.name)}</strong><small>${s.transport === 'stdio' ? esc([s.command, ...s.args].join(' ')) : esc(s.url)}</small></span><form method="post" action="/connections/mcp/remove" style="margin:0"><input type="hidden" name="name" value="${esc(s.name)}"><button class="quiet" type="submit">Remove</button></form></div>`).join('')}
<details><summary>Add a tool server</summary>
<form method="post" action="/connections/mcp/add">
<label for="n">Name</label><input id="n" name="name" pattern="[a-z][a-z0-9-]{1,30}" placeholder="bookings" required title="lowercase letters, numbers, dashes">
<label for="t">How it runs</label><select id="t" name="transport"><option value="streamable-http">Web address (URL)</option><option value="stdio">Command on this computer</option></select>
<label for="u">URL <small style="font-weight:400;color:var(--mute)">(for web address)</small></label><input id="u" name="url" placeholder="https://mcp.example.com/mcp">
<label for="h">Headers <small style="font-weight:400;color:var(--mute)">(one per line, Name: value — e.g. an API key)</small></label><textarea id="h" name="headers" style="min-height:60px" placeholder="Authorization: Bearer …"></textarea>
<label for="c">Command <small style="font-weight:400;color:var(--mute)">(for command)</small></label><input id="c" name="command" placeholder="npx -y some-mcp-server --flag">
<button type="submit">Add and restart</button></form></details>
</section>`
  return shell('Connections', inner, business)
}

export async function handle(req, res, u, ctx) {
  const { business, host, cfg, readBody, status } = ctx
  const redirect = (q) => { res.writeHead(303, { location: `/connections?${new URLSearchParams(q)}` }); res.end() }
  const p = u.pathname
  if (p === '/connections' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(page({ business, host, google: status().google, webface: status().webface, servers: readServers(), msg: u.searchParams.get('msg'), err: u.searchParams.get('err') }))
  }
  if (p === '/connections/google/setup' && req.method === 'GET') {
    const step = Math.min(7, Math.max(1, Number(u.searchParams.get('step') ?? 1) || 1))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(wiz.googleStep({ business, host, step, msg: u.searchParams.get('msg') ?? '', err: u.searchParams.get('err') ?? '', google: status().google, cfg }))
  }
  if (p === '/connections/google/setup' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const n = Number(f.get('done')); if (n >= 1 && n <= 7) wiz.googleMarkDone(n)
    res.writeHead(303, { location: `/connections/google/setup?step=${Math.min(7, n + 1)}` }); return res.end()
  }
  if (p === '/connections/wordpress/setup' && req.method === 'GET') {
    const step = Math.min(3, Math.max(1, Number(u.searchParams.get('step') ?? 1) || 1))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(wiz.wpStep({ business, step, msg: u.searchParams.get('msg') ?? '', err: u.searchParams.get('err') ?? '' }))
  }
  if (p === '/connections/wordpress/setup' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const url = (f.get('url') ?? '').trim()
    if (!/^https?:\/\//.test(url)) { res.writeHead(303, { location: '/connections/wordpress/setup?step=1&err=' + encodeURIComponent('Enter the full address, starting with https://') }); return res.end() }
    const r = await wiz.wpProbe(url)
    res.writeHead(303, { location: r.ok ? `/connections/wordpress/setup?step=2&msg=${encodeURIComponent(`WordPress found${r.name ? ': ' + r.name : ''}.`)}` : `/connections/wordpress/setup?step=1&err=${encodeURIComponent(r.why)}` }); return res.end()
  }
  if (p === '/connections/google/client' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); let raw
    const fromWizard = f.get('from') === 'wizard'
    const redirect0 = redirect; const redirectW = (q) => { if (!fromWizard) return redirect0(q); res.writeHead(303, { location: `/connections/google/setup?step=${q.err ? 6 : 7}&${new URLSearchParams(q)}` }); res.end() }
    try { raw = JSON.parse(f.get('json') ?? '') } catch { return redirectW({ err: 'That was not valid JSON. Download the client file from Google and paste its whole contents.' }) }
    const c = raw.web ?? raw.installed
    if (!c?.client_id || !c?.client_secret) return redirectW({ err: 'That JSON is not a Google OAuth client file. In Google Cloud → Clients, press the download icon on your "Desk" client and paste the whole file.' })
    if (raw.installed) return redirectW({ err: 'That client is a "Desktop app" type. Desk needs a "Web application" client — create one (step 4), add the redirect URI shown, download its JSON and paste that.' })
    if (!(raw.web.redirect_uris ?? []).includes(`https://${host}/oauth/google/callback`)) return redirectW({ err: `The client has no redirect URI https://${host}/oauth/google/callback — in Google Cloud → Clients → Desk, add it under "Authorised redirect URIs" exactly as shown, save, download the JSON again, and paste that.` })
    cfg.saveClient(raw); if (fromWizard) wiz.googleMarkDone(6); return redirectW({ msg: 'Google app saved. Now connect a Google account.' })
  }
  if (p === '/connections/google/disconnect' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const a = f.get('account') ?? ''
    const t = cfg.tokenPath(a); if (existsSync(t)) unlinkSync(t); return redirect({ msg: `${a} disconnected.` })
  }
  if (p === '/connections/webface/connect' && req.method === 'POST') {
    const api = process.env.DESK_API_URL, slug = process.env.DESK_SLUG, boxTok = process.env.DESK_BOX_TOKEN
    if (!api || !boxTok) return redirect({ err: 'This Desk is not registered with webfacedesk.app yet, so it cannot connect on its own. Use a connection key instead.' })
    const r = await fetch(`${api}/boxes/${slug}/webface-token`, { method: 'POST', headers: { authorization: `Bearer ${boxTok}` }, signal: AbortSignal.timeout(20000) }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r || !r.ok) return redirect({ err: j.message ?? 'webfaCeMEdia could not link this Desk. If webfaCeMEdia runs your website, write to tommy@webfacemedia.com and we will link it.' })
    const list = readServers().filter(x => x.name !== 'webface')
    list.push({ name: 'webface', transport: 'streamable-http', url: 'https://mcp.webfacemedia.com/mcp', headers: { Authorization: `Bearer ${j.token}` } })
    writeServers(list); restartHarness(); return redirect({ msg: `webfaCeMEdia connected (${j.client}). Desk is restarting — give it half a minute.` })
  }
  if (p === '/connections/wordpress' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const url = (f.get('url') ?? '').trim().replace(/\/+$/, ''), user = (f.get('user') ?? '').trim(), password = (f.get('password') ?? '').trim()
    const wizErr = (m) => { if (f.get('from') !== 'wizard') return redirect({ err: m }); res.writeHead(303, { location: `/connections/wordpress/setup?step=3&err=${encodeURIComponent(m)}` }); res.end() }
    if (!/^https?:\/\//.test(url) || !user || !password) return wizErr('Site address, username and application password are all needed.')
    const probe = await fetch(`${url}/wp-json/wp/v2/users/me?context=edit`, { headers: { authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') }, signal: AbortSignal.timeout(15000) }).catch(() => null)
    if (!probe || !probe.ok) return wizErr(`WordPress at ${url} did not accept that username and application password (${probe ? probe.status : 'no reply'}). Check the username (it is not always the email) and paste the application password again.`)
    const harness = process.env.DESK_HARNESS_DIR ?? '/srv/desk/harness'
    const list = readServers().filter(x => x.name !== 'wordpress')
    list.push({ name: 'wordpress', transport: 'stdio', command: process.execPath, args: [`${harness}/apps/wordpress-mcp/src/index.js`], env: { WP_URL: url, WP_USER: user, WP_APP_PASSWORD: password } })
    writeServers(list); restartHarness(); return redirect({ msg: `WordPress connected (${url}). Desk is restarting — give it half a minute.` })
  }
  if (p === '/connections/webface' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const token = (f.get('token') ?? '').trim()
    if (!/^wfs_[a-f0-9]{48}$/.test(token)) return redirect({ err: 'That is not a webfaCeMEdia connection key (it starts with wfs_).' })
    const probe = await fetch('https://mcp.webfacemedia.com/mcp', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'desk', version: '1' } } }), signal: AbortSignal.timeout(15000) }).catch(() => null)
    if (!probe || probe.status === 401 || probe.status === 403) return redirect({ err: 'webfaCeMEdia did not accept that key. Check it with your contact and try again.' })
    const list = readServers().filter(x => x.name !== 'webface')
    list.push({ name: 'webface', transport: 'streamable-http', url: 'https://mcp.webfacemedia.com/mcp', headers: { Authorization: `Bearer ${token}` } })
    writeServers(list); restartHarness(); return redirect({ msg: 'webfaCeMEdia connected. Desk is restarting — give it half a minute.' })
  }
  if (p === '/connections/mcp/add' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const name = (f.get('name') ?? '').trim()
    if (!NAME.test(name) || ['google', 'browser', 'webface', 'wordpress'].includes(name)) return redirect({ err: 'Pick a name with lowercase letters, numbers and dashes (not google or browser).' })
    const list = readServers().filter(s => s.name !== name)
    if (f.get('transport') === 'stdio') {
      const parts = (f.get('command') ?? '').trim().split(/\s+/).filter(Boolean); if (!parts.length) return redirect({ err: 'A command is needed.' })
      list.push({ name, transport: 'stdio', command: parts[0], args: parts.slice(1) })
    } else {
      const url = (f.get('url') ?? '').trim(); if (!/^https?:\/\//.test(url)) return redirect({ err: 'The URL must start with http:// or https://.' })
      const headers = Object.fromEntries((f.get('headers') ?? '').split('\n').map(l => l.split(/:\s*/, 2)).filter(x => x.length === 2 && x[0].trim()).map(([k, v]) => [k.trim(), v.trim()]))
      list.push({ name, transport: 'streamable-http', url, headers })
    }
    writeServers(list); restartHarness(); return redirect({ msg: `${name} added. Your team is restarting — give it half a minute.` })
  }
  if (p === '/connections/mcp/remove' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const name = f.get('name') ?? ''
    if (name === 'webface') {
      const { disconnect } = await import('./webface-oauth.js'); disconnect()
      writeServers(readServers().filter(x => x.name !== 'webface')); restartHarness(); return redirect({ msg: 'webfaCeMEdia disconnected — your sign-in was removed from this Desk. Desk is restarting.' })
    }
    writeServers(readServers().filter(s => s.name !== name)); restartHarness(); return redirect({ msg: `${name} removed. Your team is restarting.` })
  }
  return false
}
