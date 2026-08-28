// Operator console + API: every Desk this store runs, with the actions an
// operator needs (create a Desk for a client, pause/resume, resend welcome,
// destroy). Gated by DESKAPI_OPS_KEY — Bearer for the API, a cookie for the
// page. Provisioning reuses the same path a paid order takes.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { provision } from './provision.js'

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const keyOk = (k) => { const K = process.env.DESKAPI_OPS_KEY ?? ''; return K.length > 0 && k.length === K.length && timingSafeEqual(Buffer.from(k), Buffer.from(K)) }
const auth = (req) => { const m = (req.headers.cookie ?? '').match(/(?:^|;\s*)desk_ops=([^;]+)/); const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, ''); return keyOk(bearer) || keyOk(m?.[1] ?? '') }
const when = iso => iso ? new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

function page(orders, msg, err) {
  const rows = Object.values(orders).sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')).map(o => `<tr>
<td><strong>${esc(o.business)}</strong><br><small>${esc(o.email)} · ${esc(o.plan)}${o.webfaceClient ? ' · webface: ' + esc(o.webfaceClient) : ''}</small></td>
<td>${o.host ? `<a href="https://${esc(o.host)}/" target="_blank" rel="noopener">${esc(o.host)}</a>` : esc(o.slug)}<br><small>${o.ip ?? ''} ${o.dropletId ? '· #' + o.dropletId : ''}</small></td>
<td><span class="pill ${o.status === 'ready' ? '' : 'off'}">${esc(o.status)}</span>${o.usage ? `<br><small>${Math.round((o.usage.monthTokens ?? 0) / 1000)}k tokens this month · ${o.usage.sessions ?? 0} sessions</small>` : ''}${o.billing && o.billing !== 'ok' ? `<br><span class="pill warn">${esc(o.billing)}</span>` : ''}<br><small>beat ${when(o.lastHeartbeat)}</small><br><small>snap ${when(o.lastSnapshot)}</small></td>
<td class="a"><form method="post" action="/ops/action" style="display:inline"><input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="op" value="resend"><button class="ghost">Resend welcome</button></form>
<form method="post" action="/ops/action" style="display:inline"><input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="op" value="${o.billing === 'past_due' || o.billing === 'cancelled' ? 'resume' : 'pause'}"><button class="ghost">${o.billing === 'past_due' || o.billing === 'cancelled' ? 'Resume' : 'Pause'}</button></form>
<form method="post" action="/ops/action" style="display:inline" onsubmit="return confirm('Destroy ${esc(o.slug)}? The droplet and DNS are deleted.')"><input type="hidden" name="id" value="${esc(o.id)}"><input type="hidden" name="op" value="destroy"><button class="quiet">Destroy</button></form></td></tr>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Desks · webfaCe Desk ops</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--blue:#3499cc;--deep:#1f6f99;--ink:#152029;--mute:#5a6a78;--line:#dfe6ec;--tint:#eef6fb;--ok:#1f8a5b;--err:#b42318}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:15px/1.5 "Inter Tight",-apple-system,system-ui,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:28px 24px}h1{font-family:Fraunces,serif;font-weight:600;font-size:30px;margin:0 0 4px}p.sub{color:var(--mute);margin:0 0 20px}h2{font-family:Fraunces,serif;font-weight:600;font-size:20px;margin:26px 0 8px}
table{width:100%;border-collapse:collapse;border:1px solid var(--line);border-radius:12px;overflow:hidden}th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}td.a{text-align:right;white-space:nowrap}small{color:var(--mute)}
.pill{font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(31,138,91,.12);color:var(--ok);font-weight:600}.pill.off{background:rgba(90,106,120,.12);color:var(--mute)}.pill.warn{background:rgba(180,35,24,.1);color:var(--err)}
button{font:inherit;font-weight:600;padding:7px 11px;border-radius:8px;border:1px solid var(--blue);background:var(--blue);color:#fff;cursor:pointer;margin:2px}button.ghost{background:transparent;color:var(--deep);border-color:var(--line)}button.ghost:hover{background:var(--tint);border-color:var(--blue)}button.quiet{background:transparent;color:var(--err);border-color:var(--line)}button.quiet:hover{background:rgba(180,35,24,.08);border-color:var(--err)}
form.new{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;border:1px solid var(--line);border-radius:12px;padding:16px}form.new label{font-size:12px;font-weight:600;color:var(--mute)}form.new input,form.new select{width:100%;padding:9px 10px;border:1px solid var(--line);border-radius:8px;font:inherit;margin-top:4px}
.msg{padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:14px}.ok{background:rgba(31,138,91,.1);color:var(--ok)}.err{background:rgba(180,35,24,.08);color:var(--err)}</style>
<body><div class="wrap"><h1>Desks</h1><p class="sub">${Object.keys(orders).length} on this store · webfacedesk.app operator console</p>
${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}${err ? `<div class="msg err">${esc(err)}</div>` : ''}
<table><thead><tr><th>Customer</th><th>Desk</th><th>State</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="4"><small>No Desks yet.</small></td></tr>'}</tbody></table>
<h2>Create a Desk for a client</h2><p class="sub">Same build as a paid order, without the payment. The owner gets the welcome email with their sign-in.</p>
<form class="new" method="post" action="/ops/create">
<div><label>Business</label><input name="business" required placeholder="Maple & Main Home Services"></div>
<div><label>Owner email</label><input name="email" type="email" required></div>
<div><label>Address (slug)</label><input name="slug" pattern="[a-z0-9-]{2,24}" placeholder="maple-main"></div>
<div><label>Plan</label><select name="plan"><option value="business">Business</option><option value="operators">Operators</option></select></div>
<div><label>webfaCeMEdia client slug</label><input name="webfaceClient" placeholder="optional"></div>
<div><label>Mode</label><select name="sandbox"><option value="read-only">Guided</option><option value="workspace-write">Full</option></select></div>
<div style="align-self:end"><button type="submit">Create Desk</button></div>
</form></div></body></html>`
}

/** Wire into deskapi's request handler. Returns true when handled. */
export async function handle(req, res, u, ctx) {
  const { orders, save, json, html, body, slugify, fulfil, email, tellBox, destroyBox } = ctx
  if (u.pathname === '/ops/login' && req.method === 'POST') {
    const f = new URLSearchParams((await body(req)).toString()); if (!keyOk(f.get('key') ?? '')) { res.writeHead(401); return res.end('no') }
    res.writeHead(303, { location: '/ops', 'set-cookie': `desk_ops=${f.get('key')}; Path=/ops; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` }); return res.end()
  }
  if (u.pathname.startsWith('/ops') || u.pathname.startsWith('/api/ops')) {
    if (!auth(req)) {
      if (u.pathname === '/ops') return html(res, 401, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Operator console · webfaCe Desk</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--blue:#3499cc;--deep:#1f6f99;--ink:#152029;--mute:#5a6a78;--line:#dfe6ec;--bg:#f5f8fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 "Inter Tight",-apple-system,system-ui,sans-serif;padding:24px}
.card{width:100%;max-width:400px;background:#fff;border:1px solid var(--line);border-radius:16px;padding:32px}.brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:600;margin-bottom:6px}.brand span{font-weight:400}h1{font-family:Fraunces,serif;font-weight:600;font-size:26px;margin:14px 0 6px}p{color:var(--mute);margin:0 0 18px;font-size:15px}
label{display:block;font-weight:600;font-size:13px;margin:12px 0 6px}input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;font:inherit}input:focus{outline:2px solid var(--blue);border-color:var(--blue)}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer}button:hover{background:var(--deep)}</style>
<body><form class="card" method="post" action="/ops/login"><div class="brand"><b>webfaCe</b>&nbsp;<span>Desk</span></div><h1>Operator console</h1><p>Every Desk this store runs — create, pause, resend, destroy. Operators only.</p><label for="k">Ops key</label><input id="k" name="key" type="password" autocomplete="current-password" autofocus required><button type="submit">Open the console</button></form></body></html>`)
      return json(res, 401, { error: 'ops key required' })
    }
  } else return false
  if (u.pathname === '/ops' && req.method === 'GET') return html(res, 200, page(orders, u.searchParams.get('msg'), u.searchParams.get('err')))
  if (u.pathname === '/api/ops/boxes' && req.method === 'GET') return json(res, 200, Object.values(orders).map(o => ({ id: o.id, slug: o.slug, business: o.business, email: o.email, plan: o.plan, status: o.status, host: o.host, billing: o.billing ?? 'ok', lastHeartbeat: o.lastHeartbeat, lastSnapshot: o.lastSnapshot, webfaceClient: o.webfaceClient, usage: o.usage, heartbeat: o.heartbeat })))
  if ((u.pathname === '/ops/create' || u.pathname === '/api/ops/boxes') && req.method === 'POST') {
    const raw = (await body(req)).toString(); const f = req.headers['content-type']?.includes('json') ? new Map(Object.entries(JSON.parse(raw || '{}'))) : new URLSearchParams(raw)
    const get = k => (f.get(k) ?? '').toString().trim()
    const business = get('business'), emailAddr = get('email'); if (!business || !emailAddr) { if (u.pathname === '/ops/create') { res.writeHead(303, { location: '/ops?err=Business+and+email+are+needed' }); return res.end() } return json(res, 400, { error: 'business and email required' }) }
    let slug = slugify(get('slug') || business); if (Object.values(orders).some(o => o.slug === slug && o.status !== 'failed')) slug = `${slug}-${randomBytes(2).toString('hex')}`
    const plan = get('plan') === 'operators' ? 'operators' : 'business'
    const id = 'ord_' + randomBytes(8).toString('hex')
    orders[id] = { id, plan, size: plan === 'operators' ? 's-4vcpu-8gb' : 's-2vcpu-4gb', business, email: emailAddr, slug, status: 'paid', source: 'operator', webfaceClient: get('webfaceClient') || undefined, sandbox: get('sandbox') || 'read-only', createdAt: new Date().toISOString(), paidAt: new Date().toISOString() }; save()
    fulfil(orders[id])
    if (u.pathname === '/ops/create') { res.writeHead(303, { location: `/ops?msg=${encodeURIComponent(`Building ${slug} — the owner gets an email when it is ready.`)}` }); return res.end() }
    return json(res, 202, { id, slug, status: 'paid', welcome: `${process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'}/welcome?order=${id}` })
  }
  if ((u.pathname === '/ops/action' || u.pathname === '/api/ops/action') && req.method === 'POST') {
    const raw = (await body(req)).toString(); const f = req.headers['content-type']?.includes('json') ? new Map(Object.entries(JSON.parse(raw || '{}'))) : new URLSearchParams(raw)
    const o = orders[(f.get('id') ?? '').toString()]; const op = (f.get('op') ?? '').toString()
    const done = (m) => { if (u.pathname === '/ops/action') { res.writeHead(303, { location: `/ops?msg=${encodeURIComponent(m)}` }); return res.end() } return json(res, 200, { ok: true, message: m }) }
    if (!o) return json(res, 404, { error: 'no such desk' })
    if (op === 'resend') { await email(o).catch(e => console.error(e.message)); return done(`Welcome email resent to ${o.email}.`) }
    if (op === 'pause') { o.billing = 'past_due'; save(); await tellBox(o, 'past_due').catch(() => {}); return done(`${o.slug} paused (Guided mode + banner).`) }
    if (op === 'resume') { o.billing = 'ok'; save(); await tellBox(o, 'ok').catch(() => {}); return done(`${o.slug} resumed.`) }
    if (op === 'destroy') { await destroyBox(o); return done(`${o.slug} destroyed.`) }
    return json(res, 400, { error: 'op?' })
  }
  return false
}
