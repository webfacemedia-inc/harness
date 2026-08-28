// Connections: the owner connects Google (their OWN Google app — Google will
// not allow a shared one for Gmail scopes) and adds any MCP server. MCP rows
// are written into the Desk profile patch and the harness is restarted.
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { execFile } from 'node:child_process'

const PATCH = process.env.DESK_PROFILE_PATCH ?? '/srv/desk/home/profiles/desk/cordis.patch.yml'
const NAME = /^[a-z][a-z0-9-]{1,30}$/
const MARK_BEGIN = '# --- connections (managed by Desk; edit from the Connections page) ---'
const MARK_END = '# --- end connections ---'
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const yq = s => JSON.stringify(String(s))

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
  writeFileSync(PATCH, s)
}
function restartHarness() {
  return new Promise(r => execFile('sudo', ['-n', '/usr/bin/systemctl', 'restart', 'desk-harness'], () => r()))
}

function shell(title, inner, business) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · webfaCe Desk</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fa;--card:#fff;--ink:#16212b;--mute:#5b6b7a;--line:#dde4ea;--blue:#3499cc;--blue-ink:#22729c;--ok:#1f8a5b;--err:#b42318}
@media(prefers-color-scheme:dark){:root{--bg:#0f151b;--card:#161e26;--ink:#eef3f7;--mute:#9db0c0;--line:#25313c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 -apple-system,"Segoe UI",Inter,system-ui,sans-serif}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--card)}.top a{color:var(--blue-ink);text-decoration:none;font-weight:600}
main{max-width:760px;margin:0 auto;padding:22px 20px 60px}h1{font-size:24px;margin:0 0 4px}p.sub{color:var(--mute);margin:0 0 22px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px}section h2{font-size:18px;margin:0 0 6px;display:flex;align-items:center;gap:10px}
.pill{font-size:12px;padding:3px 9px;border-radius:999px;background:rgba(31,138,91,.12);color:var(--ok);font-weight:600}.pill.off{background:rgba(91,107,122,.12);color:var(--mute)}
ol{padding-left:20px;color:var(--mute)}ol li{margin:6px 0}ol code,pre code{font-size:13px;background:rgba(127,127,127,.12);padding:2px 6px;border-radius:5px;overflow-wrap:anywhere;word-break:break-all}main{overflow-x:hidden}a{overflow-wrap:anywhere}.row small{overflow-wrap:anywhere}
label{display:block;font-weight:600;font-size:13px;margin:14px 0 6px}input,textarea,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font:inherit}textarea{min-height:110px;font-family:ui-monospace,Menlo,monospace;font-size:13px}
button,.btn{display:inline-block;margin-top:14px;padding:10px 16px;border:0;border-radius:8px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}button:hover,.btn:hover{background:var(--blue-ink)}button.quiet{background:transparent;color:var(--err);border:1px solid var(--line);padding:6px 10px;font-size:13px;margin:0}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}.row small{color:var(--mute);display:block}
.msg{padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:14px}.msg.ok{background:rgba(31,138,91,.1);color:var(--ok)}.msg.err{background:rgba(180,35,24,.08);color:var(--err)}
details{margin-top:10px}summary{cursor:pointer;color:var(--blue-ink);font-weight:600}
</style><body>
<div class="top"><a href="/">← Back to Desk</a><span style="color:var(--mute);font-size:13px">${esc(business)}</span></div><main>${inner}</main>
<script>
(function(){
  if (location.search) history.replaceState(null, '', location.pathname)
  var m = document.querySelector('.msg'); if (!m) return
  var restarting = /restarting/i.test(m.textContent)
  if (!restarting) { setTimeout(function(){ m.style.transition='opacity .6s'; m.style.opacity='0'; setTimeout(function(){ m.remove() }, 700) }, 8000); return }
  var tries = 0
  var t = setInterval(function(){
    tries++
    fetch('/deskd/status', {credentials:'same-origin'}).then(function(r){ return r.json() }).then(function(s){
      if (s.harness === true) { clearInterval(t); m.textContent = 'Desk is back. Your tools are ready.'; setTimeout(function(){ m.style.transition='opacity .6s'; m.style.opacity='0'; setTimeout(function(){ m.remove() }, 700) }, 4000) }
      else if (tries > 40) { clearInterval(t); m.className = 'msg err'; m.textContent = 'Desk is taking longer than usual to restart. Refresh in a minute; if it stays down, write to tommy@webfacemedia.com.' }
    }).catch(function(){})
  }, 3000)
})()
</script></body></html>`
}

export function page({ business, host, google, servers, msg, err }) {
  const gc = google.clientConfigured, accounts = google.accounts
  const inner = `<h1>Connections</h1><p class="sub">Your team uses these on your behalf. Every account here is yours — nothing is shared with anyone else.</p>
${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${err ? `<div class="msg err">${esc(err)}</div>` : ''}
<section><h2>Google — Gmail, Calendar, Drive, Contacts ${accounts.length ? `<span class="pill">${accounts.length} connected</span>` : gc ? '<span class="pill off">app saved · no account yet</span>' : '<span class="pill off">not set up</span>'}</h2>
<p style="color:var(--mute);margin:0 0 8px">Google requires each business to use its own Google app for email access. It takes about five minutes and is done once.</p>
${accounts.length ? accounts.map(a => `<div class="row"><span>${esc(a)}<small>Gmail · Calendar · Drive (read) · Contacts (read)</small></span><form method="post" action="/connections/google/disconnect" style="margin:0"><input type="hidden" name="account" value="${esc(a)}"><button class="quiet" type="submit">Disconnect</button></form></div>`).join('') : ''}
<details ${gc ? '' : 'open'}><summary>${gc ? 'Change the Google app' : 'Set up your Google app'}</summary>
<ol>
<li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">console.cloud.google.com/projectcreate</a>, name the project after your business, create it.</li>
<li>Enable the APIs: <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener">Gmail</a>, <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noopener">Calendar</a>, <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Drive</a>, <a href="https://console.cloud.google.com/apis/library/people.googleapis.com" target="_blank" rel="noopener">People</a> — press <em>Enable</em> on each.</li>
<li><a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noopener">Google Auth Platform → Get started</a>: app name = your business, your email as support and developer contact, audience <strong>External</strong>. Then under <em>Audience</em> add the Google account(s) you will connect as <strong>test users</strong>.</li>
<li><a href="https://console.cloud.google.com/auth/clients/create" target="_blank" rel="noopener">Create an OAuth client</a>: type <strong>Web application</strong>, name "Desk", and under <em>Authorised redirect URIs</em> add exactly:<br><code>https://${esc(host)}/oauth/google/callback</code></li>
<li>Press <em>Download JSON</em> on the new client and paste the file's contents below.</li>
</ol>
<form method="post" action="/connections/google/client"><label for="cj">Client JSON</label><textarea id="cj" name="json" placeholder='{"web":{"client_id":"…","client_secret":"…",…}}' required></textarea><button type="submit">Save Google app</button></form>
</details>
${gc ? `<a class="btn" href="/oauth/google/start">Connect a Google account →</a>` : ''}
</section>

${(() => { const w = servers.find(x => x.name === 'webface'); return `<section><h2>webfaCeMEdia — your website, campaigns, contacts and analytics ${w ? '<span class="pill">connected</span>' : '<span class="pill off">not connected</span>'}</h2>
<p style="color:var(--mute);margin:0 0 8px">If webfaCeMEdia built or runs your website, connect it and Desk can update pages, draft campaigns, look up contacts and read your analytics — with your approval on anything that goes live.</p>
${w ? `<div class="row"><span><strong>Connected</strong><small>mcp.webfacemedia.com · token ${esc((w.headers?.Authorization ?? '').replace(/^Bearer /, '').slice(0, 12))}…</small></span><form method="post" action="/connections/mcp/remove" style="margin:0"><input type="hidden" name="name" value="webface"><button class="quiet" type="submit">Disconnect</button></form></div>`
: `<form method="post" action="/connections/webface/connect" style="margin:0"><button type="submit">Connect webfaCeMEdia</button></form>
<details><summary style="font-size:13px">Have a connection key instead?</summary><form method="post" action="/connections/webface"><label for="wt">Connection key</label><input id="wt" name="token" pattern="wfs_[a-f0-9]{48}" placeholder="wfs_…" required title="Starts with wfs_"><button type="submit">Connect with key</button></form></details>`}
</section>` })()}
${(() => { const w = servers.find(x => x.name === 'wordpress'); return `<section><h2>WordPress ${w ? '<span class="pill">connected</span>' : '<span class="pill off">not connected</span>'}</h2>
<p style="color:var(--mute);margin:0 0 8px">If your website runs on WordPress, connect it with an Application Password and Desk can read pages and posts, draft new ones, update content and upload images — publishing and edits to live pages always wait for your approval.</p>
${w ? `<div class="row"><span><strong>${esc(w.env?.WP_URL ?? '')}</strong><small>as ${esc(w.env?.WP_USER ?? '')} · posts, pages, media</small></span><form method="post" action="/connections/mcp/remove" style="margin:0"><input type="hidden" name="name" value="wordpress"><button class="quiet" type="submit">Disconnect</button></form></div>`
: `<details><summary>Connect WordPress</summary>
<ol><li>In WordPress go to <strong>Users → Profile</strong>, scroll to <strong>Application Passwords</strong>, enter the name <code>Desk</code> and press <em>Add New Application Password</em>.</li><li>Copy the password it shows (spaces are fine) and paste it below with your WordPress username and the site address.</li></ol>
<form method="post" action="/connections/wordpress"><label for="wpu">Site address</label><input id="wpu" name="url" type="url" placeholder="https://www.yourbusiness.com" required><label for="wpn">WordPress username</label><input id="wpn" name="user" required autocomplete="off"><label for="wpp">Application password</label><input id="wpp" name="password" type="password" required autocomplete="off"><button type="submit">Connect WordPress</button></form></details>`}
</section>` })()}
<section><h2>Other tools ${servers.filter(x => !['webface', 'wordpress'].includes(x.name)).length ? `<span class="pill">${servers.filter(x => x.name !== 'webface').length} added</span>` : ''}</h2>
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
    return res.end(page({ business, host, google: status().google, servers: readServers(), msg: u.searchParams.get('msg'), err: u.searchParams.get('err') }))
  }
  if (p === '/connections/google/client' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); let raw
    try { raw = JSON.parse(f.get('json') ?? '') } catch { return redirect({ err: 'That was not valid JSON. Download the client file from Google and paste its whole contents.' }) }
    const c = raw.web ?? raw.installed
    if (!c?.client_id || !c?.client_secret) return redirect({ err: 'That JSON is not a Google OAuth client (expected a "web" client with client_id and client_secret).' })
    if (raw.web && !(raw.web.redirect_uris ?? []).includes(`https://${host}/oauth/google/callback`)) return redirect({ err: `The client has no redirect URI https://${host}/oauth/google/callback — add it in Google Cloud, download the JSON again, and paste that.` })
    cfg.saveClient(raw); return redirect({ msg: 'Google app saved. Now connect a Google account.' })
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
    if (!/^https?:\/\//.test(url) || !user || !password) return redirect({ err: 'Site address, username and application password are all needed.' })
    const probe = await fetch(`${url}/wp-json/wp/v2/users/me?context=edit`, { headers: { authorization: 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64') }, signal: AbortSignal.timeout(15000) }).catch(() => null)
    if (!probe || !probe.ok) return redirect({ err: `WordPress at ${url} did not accept that username and application password (${probe ? probe.status : 'no reply'}). Check the site address and that Application Passwords are enabled.` })
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
      // Disconnect = revoke the key on the platform too, so it cannot be reused.
      const w = readServers().find(x => x.name === 'webface'); const prefix = (w?.headers?.Authorization ?? '').replace(/^Bearer /, '').slice(0, 12)
      const api = process.env.DESK_API_URL, slug = process.env.DESK_SLUG, boxTok = process.env.DESK_BOX_TOKEN
      if (api && boxTok && prefix.startsWith('wfs_')) await fetch(`${api}/boxes/${slug}/webface-token/revoke`, { method: 'POST', headers: { authorization: `Bearer ${boxTok}`, 'content-type': 'application/json' }, body: JSON.stringify({ prefix }), signal: AbortSignal.timeout(15000) }).catch(() => {})
      writeServers(readServers().filter(x => x.name !== 'webface')); restartHarness(); return redirect({ msg: 'webfaCeMEdia disconnected and its key revoked. Desk is restarting.' })
    }
    writeServers(readServers().filter(s => s.name !== name)); restartHarness(); return redirect({ msg: `${name} removed. Your team is restarting.` })
  }
  return false
}
