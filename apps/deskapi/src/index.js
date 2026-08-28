#!/usr/bin/env node
// deskapi — the webfacedesk.app storefront back end (runs behind Caddy on the apex).
//   GET  /checkout?plan=business|operators      order form
//   POST /api/checkout                          → Stripe Checkout (setup fee + subscription)
//   POST /api/stripe/webhook                    checkout.session.completed → provision
//   GET  /api/orders/:id                        status JSON (polled by /welcome)
//   GET  /welcome?order=:id                     "your Desk is being built" → credentials once ready
//   POST /api/boxes/:slug/heartbeat             deskd heartbeats (bearer = box token)
// State: DESKAPI_DATA/orders.json (0600). Keys: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// STRIPE_PRICE_* (see PLANS), DIGITALOCEAN_TOKEN, OPENROUTER_API_KEY, optional CLOUDFLARE_API_TOKEN, BREVO_API_KEY.
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { provision } from './provision.js'
import * as ops from './ops.js'

const PORT = Number(process.env.DESKAPI_PORT ?? 8095)
const PUBLIC = process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'
const DATA = process.env.DESKAPI_DATA ?? '/srv/deskapi'
const STRIPE = process.env.STRIPE_SECRET_KEY
const PLANS = {
  business: { name: 'Desk for Business', setup: process.env.STRIPE_PRICE_BUSINESS_SETUP, monthly: process.env.STRIPE_PRICE_BUSINESS_MONTHLY, size: 's-2vcpu-4gb' },
  operators: { name: 'Desk for Operators', setup: process.env.STRIPE_PRICE_OPERATORS_SETUP, monthly: process.env.STRIPE_PRICE_OPERATORS_MONTHLY, size: 's-4vcpu-8gb' },
}
mkdirSync(DATA, { recursive: true, mode: 0o700 })
const FILE = join(DATA, 'orders.json')
const orders = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}
const save = () => writeFileSync(FILE, JSON.stringify(orders, null, 2), { mode: 0o600 })
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'desk'
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
const html = (res, code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body) }
async function body(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c) }

async function stripe(path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${STRIPE}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  const j = await r.json(); if (!r.ok) throw new Error(`stripe ${path}: ${j.error?.message ?? r.status}`); return j
}
function verifyStripe(payload, header, secret) {
  const parts = Object.fromEntries((header ?? '').split(',').map(p => p.split('=')))
  if (!parts.t || !parts.v1) return false
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false
  const want = createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex')
  return want.length === parts.v1.length && timingSafeEqual(Buffer.from(want), Buffer.from(parts.v1))
}

const shell = (title, inner) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · webfaCe Desk</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--blue:#3499cc;--deep:#1f6f99;--ink:#152029;--mute:#5a6a78;--line:#dfe6ec;--tint:#eef6fb}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:16px/1.55 "Inter Tight",-apple-system,system-ui,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:56px 24px}h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:34px;margin:0 0 8px;letter-spacing:-.01em}p.sub{color:var(--mute);margin:0 0 28px}
label{display:block;font-weight:600;font-size:14px;margin:16px 0 6px}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;font:inherit}input:focus{outline:2px solid var(--blue);border-color:var(--blue)}
.btn{display:inline-block;margin-top:22px;padding:14px 22px;border:0;border-radius:10px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}.btn:hover{background:var(--deep)}
.card{border:1px solid var(--line);border-radius:14px;padding:22px;margin-top:20px;background:var(--tint)}.card code{font-size:17px;background:#fff;padding:4px 8px;border-radius:6px;border:1px solid var(--line)}
.steps{margin:0;padding-left:20px;color:var(--mute)}.err{color:#b42318}.brand{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:28px}.brand a{color:inherit;text-decoration:none}</style>
<body><div class="wrap"><div class="brand"><a href="/">webfaCe Desk</a></div>${inner}</div></body></html>`

function checkoutPage(plan, error) {
  const p = PLANS[plan] ?? PLANS.business; const key = PLANS[plan] ? plan : 'business'
  return shell('Get your Desk', `<h1>${esc(p.name)}</h1><p class="sub">Tell us who the Desk is for. Payment is on the next screen; your computer is built the moment it clears.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/api/checkout"><input type="hidden" name="plan" value="${key}">
<label for="b">Business name</label><input id="b" name="business" required maxlength="80" placeholder="Maple &amp; Main Home Services">
<label for="e">Your email</label><input id="e" name="email" type="email" required placeholder="you@business.com">
<label for="s">Your Desk address</label><input id="s" name="slug" pattern="[a-z0-9-]{2,24}" placeholder="maple-main" title="letters, numbers and dashes"><p class="sub" style="margin:6px 0 0;font-size:13px">yourname.webfacedesk.app — leave blank and we'll pick from the business name.</p>
<button class="btn" type="submit">Continue to payment →</button></form>`)
}
function welcomePage(o) {
  if (!o) return shell('Order', '<h1>Order not found</h1><p class="sub">Check the link in your email, or write to tommy@webfacemedia.com.</p>')
  const stages = { created: 'Waiting for payment…', paid: 'Paid. Creating your Desk computer in Toronto…', creating: 'Creating your Desk computer in Toronto…', installing: 'Installing your team (about ten minutes)…', ready: 'Your Desk is ready.', failed: 'Something went wrong — we are on it and will email you.' }
  const inner = o.status === 'ready'
    ? `<h1>Your Desk is ready</h1><p class="sub">Save these — they are shown once here and sent to ${esc(o.email)}.</p>
<div class="card"><p><strong>Address</strong><br><a href="https://${esc(o.host)}/">https://${esc(o.host)}/</a></p><p><strong>Username</strong> <code>owner</code></p><p><strong>Password</strong> <code>${esc(o.password)}</code></p></div>
<p>Next:</p><ol class="steps"><li>Sign in and press <em>Get started</em>.</li><li>Tell your team about the business — it asks.</li><li>Connect Google from Connections when you're ready.</li></ol><a class="btn" href="https://${esc(o.host)}/">Open your Desk →</a>`
    : `<h1>${esc(stages[o.status] ?? o.status)}</h1><p class="sub">${esc(o.business)} · this page updates itself.</p><div class="card"><p>${esc(o.detail ?? '')}</p></div><script>setTimeout(()=>location.reload(),15000)</script>`
  return shell('Your Desk', inner)
}

async function fulfil(o) {
  const log = (status, detail) => { o.status = status === 'dns-failed' ? o.status : status; o.detail = detail; o.updatedAt = new Date().toISOString(); save() }
  try {
    o.boxToken = randomBytes(16).toString('hex'); save()
    const box = await provision(o, log)
    Object.assign(o, box, { status: 'ready', detail: '', readyAt: new Date().toISOString() }); save()
    await email(o).catch(e => console.error('email failed:', e.message))
  } catch (e) { console.error('provision failed for', o.id, e); o.status = 'failed'; o.detail = e.message; save() }
}
async function tellBox(o, state) {
  if (!o.host || !o.boxToken) return
  let portalUrl = ''
  if (state === 'past_due' && o.stripeCustomer) { try { portalUrl = (await stripe('billing_portal/sessions', { customer: o.stripeCustomer, return_url: `https://${o.host}/` })).url } catch (e) { console.error('portal session failed', e.message) } }
  const r = await fetch(`https://${o.host}/deskd/billing`, { method: 'POST', headers: { authorization: `Bearer ${o.boxToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ state, portalUrl }), signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`box said ${r.status}`)
  console.log('box', o.slug, 'billing →', state)
}
/** Delete a Desk's droplet and DNS record; the order stays as a record. */
async function destroyBox(o) {
  const tok = process.env.DIGITALOCEAN_TOKEN
  if (o.dropletId && tok) await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}`, { method: 'DELETE', headers: { authorization: `Bearer ${tok}` } }).catch(e => console.error('droplet delete failed', e.message))
  const cf = process.env.CLOUDFLARE_API_TOKEN; const zone = process.env.CLOUDFLARE_ZONE_ID ?? 'd3fc4cb5dfad60b2064472906607a170'
  if (cf && o.host?.endsWith('.webfacedesk.app')) {
    const h = { authorization: `Bearer ${cf}` }
    const q = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?name=${o.host}`, { headers: h })).json().catch(() => ({}))
    for (const r of q.result ?? []) await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${r.id}`, { method: 'DELETE', headers: h }).catch(() => {})
  }
  o.status = 'destroyed'; o.destroyedAt = new Date().toISOString(); save()
}
/** Nightly DigitalOcean snapshot per live box, keeping the newest three. */
async function snapshots() {
  const tok = process.env.DIGITALOCEAN_TOKEN; if (!tok) return
  const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
  // Static boxes (the demo/apex box itself) join the nightly snapshot loop: DESKAPI_STATIC_BOXES=slug:dropletId,…
  const statics = (process.env.DESKAPI_STATIC_BOXES ?? '').split(',').filter(Boolean).map(x => { const [slug, dropletId] = x.split(':'); return { slug, dropletId: Number(dropletId), status: 'ready', static: true } })
  for (const o of [...Object.values(orders).filter(x => x.status === 'ready' && x.dropletId && x.billing !== 'cancelled'), ...statics]) {
    try {
      const a = await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}/actions`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'snapshot', name: `desk-${o.slug}-${new Date().toISOString().slice(0, 10)}` }) })
      if (!a.ok) throw new Error(`snapshot action ${a.status}`)
      const snaps = (await (await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}/snapshots?per_page=50`, { headers: h })).json()).snapshots ?? []
      for (const s of snaps.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(3)) await fetch(`https://api.digitalocean.com/v2/snapshots/${s.id}`, { method: 'DELETE', headers: h })
      o.lastSnapshot = new Date().toISOString(); if (!o.static) save(); console.log('snapshot ok', o.slug, snaps.length)
    } catch (e) { console.error('snapshot failed', o.slug, e.message) }
  }
}
const msToNextSnapshot = () => { const d = new Date(); d.setUTCHours(7, 30, 0, 0); if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1); return d - new Date() }
setTimeout(function tick() { snapshots().finally(() => setTimeout(tick, msToNextSnapshot())) }, msToNextSnapshot()).unref()

async function email(o) {
  if (!process.env.BREVO_API_KEY) return
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({
    sender: { name: 'webfaCe Desk', email: process.env.DESK_FROM_EMAIL ?? 'desk@webfacemedia.com' }, to: [{ email: o.email }], subject: `${o.business}: your Desk is ready`,
    htmlContent: `<p>Your Desk is ready.</p><p><a href="https://${o.host}/">Open your Desk</a> — username <b>owner</b>, password <b>${o.password}</b>.</p><p>Sign in, press Get started, and tell your team about the business. Reply to this email if anything is unclear.</p><p>— webfaCeMEdia, Toronto</p>`,
  }) })
  if (!r.ok) throw new Error(`brevo ${r.status}: ${await r.text()}`)
  console.log('welcome email sent to', o.email, 'for', o.slug)
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, PUBLIC)
  try {
    if (await ops.handle(req, res, u, { orders, save, json, html, body, slugify, fulfil, email, tellBox, destroyBox }) !== false) return
    if (u.pathname === '/checkout') return html(res, 200, checkoutPage(u.searchParams.get('plan')))
    if (u.pathname === '/welcome') return html(res, 200, welcomePage(orders[u.searchParams.get('order') ?? '']))
    if (u.pathname === '/api/checkout' && req.method === 'POST') {
      if (!STRIPE) return html(res, 503, checkoutPage('business', 'Checkout is not open yet — write to tommy@webfacemedia.com and we will set you up by hand.'))
      const f = new URLSearchParams((await body(req)).toString())
      const plan = PLANS[f.get('plan')] ? f.get('plan') : 'business'; const p = PLANS[plan]
      const business = f.get('business')?.trim(); const emailAddr = f.get('email')?.trim()
      if (!business || !emailAddr) return html(res, 400, checkoutPage(plan, 'Business name and email are needed.'))
      let slug = slugify(f.get('slug') || business)
      if (Object.values(orders).some(o => o.slug === slug && o.status !== 'failed')) slug = `${slug}-${randomBytes(2).toString('hex')}`
      const id = 'ord_' + randomBytes(8).toString('hex')
      const session = await stripe('checkout/sessions', {
        mode: 'subscription', client_reference_id: id, customer_email: emailAddr,
        'line_items[0][price]': p.monthly, 'line_items[0][quantity]': '1', 'line_items[1][price]': p.setup, 'line_items[1][quantity]': '1',
        success_url: `${PUBLIC}/welcome?order=${id}`, cancel_url: `${PUBLIC}/checkout?plan=${plan}`, 'metadata[order]': id, 'metadata[slug]': slug,
        'subscription_data[metadata][order]': id, 'subscription_data[metadata][slug]': slug,
      })
      orders[id] = { id, plan, size: p.size, business, email: emailAddr, slug, status: 'created', stripeSession: session.id, createdAt: new Date().toISOString() }; save()
      res.writeHead(303, { location: session.url }); return res.end()
    }
    if (u.pathname === '/api/stripe/webhook' && req.method === 'POST') {
      const raw = (await body(req)).toString()
      if (!verifyStripe(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET ?? '')) return json(res, 400, { error: 'bad signature' })
      const ev = JSON.parse(raw); const obj = ev.data?.object ?? {}
      if (ev.type === 'checkout.session.completed') {
        const o = orders[obj.client_reference_id ?? obj.metadata?.order]
        if (!o) { console.error('webhook for unknown order', obj.id); return json(res, 200, { ok: true, unknown: true }) }
        if (o.status === 'created') { o.status = 'paid'; o.stripeCustomer = obj.customer; o.stripeSubscription = obj.subscription; o.paidAt = new Date().toISOString(); save(); fulfil(o) }
        return json(res, 200, { ok: true })
      }
      if (ev.type === 'invoice.payment_failed' || ev.type === 'customer.subscription.deleted' || ev.type === 'invoice.paid') {
        const o = Object.values(orders).find(x => x.stripeSubscription === (obj.subscription ?? obj.id))
        if (o) {
          const state = ev.type === 'invoice.paid' ? 'ok' : ev.type === 'invoice.payment_failed' ? 'past_due' : 'cancelled'
          if (!(state === 'ok' && (o.billing ?? 'ok') === 'ok')) { o.billing = state; o.billingAt = new Date().toISOString(); save(); tellBox(o, state).catch(e => console.error('box billing notify failed', o.slug, e.message)) }
        }
      }
      return json(res, 200, { ok: true })
    }
    const rs = u.pathname.match(/^\/api\/orders\/(ord_[a-f0-9]+)\/resend$/)
    if (rs && req.method === 'POST') {
      const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      if (!process.env.DESKAPI_ADMIN_TOKEN || tok !== process.env.DESKAPI_ADMIN_TOKEN) return json(res, 401, { error: 'no' })
      const o = orders[rs[1]]; if (!o || o.status !== 'ready') return json(res, 404, { error: 'no ready order' })
      try { await email(o); return json(res, 200, { ok: true }) } catch (e) { return json(res, 502, { error: e.message }) }
    }
    if (u.pathname.startsWith('/api/orders/')) {
      const o = orders[u.pathname.split('/')[3]]; if (!o) return json(res, 404, { error: 'not found' })
      return json(res, 200, { id: o.id, status: o.status, detail: o.detail ?? '', host: o.status === 'ready' ? o.host : undefined })
    }
    // One-click webfaCeMEdia connection: the box asks with its own token; the
    // client slug comes from the order (studio clients) or DESKAPI_STATIC_CLIENTS
    // ("slug:client,slug:client" — e.g. demo:webface). Mints a wfs_ key on the platform.
    const wc = u.pathname.match(/^\/api\/boxes\/([a-z0-9-]+)\/webface-token$/)
    if (wc && req.method === 'POST') {
      const slug = wc[1]; const o = Object.values(orders).find(x => x.slug === slug); const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const staticTok = (process.env.DESKAPI_STATIC_BOX_TOKENS ?? '').split(',').map(x => x.split(':')).find(([s]) => s === slug)?.[1]
      if (!((o && o.boxToken && tok === o.boxToken) || (staticTok && tok === staticTok))) return json(res, 401, { error: 'no' })
      const client = o?.webfaceClient ?? (process.env.DESKAPI_STATIC_CLIENTS ?? '').split(',').map(x => x.split(':')).find(([s]) => s === slug)?.[1]
      if (!client) return json(res, 404, { error: 'not_a_client', message: 'This Desk is not linked to a webfaCeMEdia client yet.' })
      const secret = process.env.AGENT_API_SECRET; const site = process.env.PLATFORM_CONVEX_SITE_URL ?? 'https://qualified-clownfish-173.convex.site'
      if (!secret) return json(res, 503, { error: 'platform_unavailable' })
      const r = await fetch(`${site}/serviceTokens/mint`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-secret': secret }, body: JSON.stringify({ clerkOrgId: process.env.WEBFACE_ORG_ID ?? 'org_3ESfU569aFHHJPiV9dAUhqpc8e0', createdBy: process.env.WEBFACE_MINT_USER ?? 'user_34rSBDwip8mI5VaHkovOt6mTzIJ', clientSlug: client, label: `Desk ${slug}` }) })
      const j = await r.json().catch(() => ({})); if (!r.ok) return json(res, 502, { error: 'mint_failed', detail: j.error })
      if (o) { o.webfacePrefix = j.prefix; save() }
      return json(res, 200, { token: j.token, prefix: j.prefix, client })
    }
    const wr = u.pathname.match(/^\/api\/boxes\/([a-z0-9-]+)\/webface-token\/revoke$/)
    if (wr && req.method === 'POST') {
      const slug = wr[1]; const o = Object.values(orders).find(x => x.slug === slug); const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const staticTok = (process.env.DESKAPI_STATIC_BOX_TOKENS ?? '').split(',').map(x => x.split(':')).find(([s]) => s === slug)?.[1]
      if (!((o && o.boxToken && tok === o.boxToken) || (staticTok && tok === staticTok))) return json(res, 401, { error: 'no' })
      const { prefix } = JSON.parse((await body(req)).toString() || '{}'); if (!/^wfs_[a-f0-9]{8}$/.test(prefix ?? '')) return json(res, 400, { error: 'prefix?' })
      const r = await fetch(`${process.env.PLATFORM_CONVEX_SITE_URL ?? 'https://qualified-clownfish-173.convex.site'}/serviceTokens/revoke`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-secret': process.env.AGENT_API_SECRET ?? '' }, body: JSON.stringify({ prefix }) })
      return json(res, r.ok ? 200 : 502, await r.json().catch(() => ({})))
    }
    const hb = u.pathname.match(/^\/api\/boxes\/([a-z0-9-]+)\/heartbeat$/)
    if (hb && req.method === 'POST') {
      const o = Object.values(orders).find(x => x.slug === hb[1]); const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      if (!o || !o.boxToken || tok !== o.boxToken) return json(res, 401, { error: 'no' })
      o.lastHeartbeat = new Date().toISOString(); const hb = JSON.parse((await body(req)).toString() || '{}'); o.heartbeat = { ready: hb.ready, harness: hb.harness, google: hb.google?.accounts?.length ?? 0, push: hb.push?.devices ?? 0 }; if (hb.usage) o.usage = { monthTokens: hb.usage.monthTokens, totalTokens: hb.usage.totalTokens, sessions: hb.usage.sessions, turns: hb.usage.turns }; save(); return json(res, 200, { ok: true })
    }
    if (u.pathname === '/api/ops/snapshot' && req.method === 'POST') {
      const k = (req.headers.authorization ?? '').replace(/^Bearer /, ''); if (!process.env.DESKAPI_OPS_KEY || k !== process.env.DESKAPI_OPS_KEY) return json(res, 401, { error: 'no' })
      await snapshots(); return json(res, 200, { ok: true })
    }
    if (u.pathname === '/api/health') return json(res, 200, { ok: true, stripe: Boolean(STRIPE), provisioning: Boolean(process.env.DIGITALOCEAN_TOKEN), dns: Boolean(process.env.CLOUDFLARE_API_TOKEN), orders: Object.keys(orders).length })
    res.writeHead(404); res.end('not found')
  } catch (e) { console.error(e); json(res, 500, { error: e.message }) }
})
server.listen(PORT, '127.0.0.1', () => console.log(`deskapi on 127.0.0.1:${PORT} → ${PUBLIC}`))
