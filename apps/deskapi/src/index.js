#!/usr/bin/env node
// deskapi — the webfacedesk.app storefront back end (runs behind Caddy on the apex).
//   GET  /checkout?plan=business|operators      order form
//   POST /api/checkout                          → Stripe Checkout (setup fee + subscription)
//   POST /api/stripe/webhook                    checkout.session.completed → provision
//   GET  /api/orders/:id                        status JSON (polled by /welcome)
//   GET  /welcome?order=:id                     "your Desk is being built" → credentials once ready
//   POST /api/boxes/:slug/heartbeat             deskd heartbeats (bearer = box token)
//   GET  /auth/google/{start,callback}          Google sign-in relay for every Desk (DESK_SIGNIN_CLIENT_ID/SECRET)
// State: DESKAPI_DATA/orders.json (0600). Keys: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
// STRIPE_PRICE_* (see PLANS), DIGITALOCEAN_TOKEN, OPENROUTER_API_KEY, optional CLOUDFLARE_API_TOKEN, BREVO_API_KEY.
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, copyFileSync } from 'node:fs'
import { createHmac, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { provision } from './provision.js'
import { billingStateFor, cleanName, equalSecret, resumableOrders, verifyStripeSignature, IN_FLIGHT, MAX_ATTEMPTS } from './core.js'
import * as ops from './ops.js'
import { renderEmail, esc as em, p as ep, btn as ebtn, link as elink, panel as epanel, muted as emuted } from './email.js'

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
const orders = (() => {
  if (!existsSync(FILE)) return {}
  try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch (e) {
    // A torn orders.json must not crash-loop the store; keep the evidence and start from the last good copy if any.
    copyFileSync(FILE, FILE + '.corrupt'); console.error('orders.json unreadable, kept as orders.json.corrupt:', e.message)
    try { return JSON.parse(readFileSync(FILE + '.bak', 'utf8')) } catch { return {} }
  }
})()
setInterval(() => { try { copyFileSync(FILE, FILE + '.bak') } catch {} }, 3600000).unref()
const save = () => { writeFileSync(FILE + '.tmp', JSON.stringify(orders, null, 2), { mode: 0o600 }); renameSync(FILE + '.tmp', FILE) }
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'desk'
// An upstream timeout must not take the store down with it.
process.on('unhandledRejection', e => console.error('unhandled rejection:', e instanceof Error ? e.message : e))
process.on('uncaughtException', e => console.error('uncaught exception:', e instanceof Error ? e.stack ?? e.message : e))

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
const html = (res, code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body) }
async function body(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c) }

async function stripe(path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method: 'POST', headers: { authorization: `Bearer ${STRIPE}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) })
  const j = await r.json(); if (!r.ok) throw new Error(`stripe ${path}: ${j.error?.message ?? r.status}`); return j
}
const verifyStripe = (payload, header, secret) => verifyStripeSignature(payload, header, secret)

const shell = (title, inner) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light"><title>${esc(title)} · webfaCe Desk</title><script src="https://insights.webfacemedia.com/api/script.js" data-site="webface" defer></script>
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
  const stages = { created: 'Waiting for payment…', paid: 'Paid. Creating your Desk in Toronto…', creating: 'Creating your Desk in Toronto…', installing: 'Setting up your Desk…', ready: 'Your Desk is ready.', failed: 'Something went wrong — we are on it and will email you.', destroyed: 'This Desk has been closed.' }
  const showPassword = o.status === 'ready' && !o.passwordShown
  if (showPassword) { o.passwordShown = new Date().toISOString(); save() }
  const inner = o.status === 'ready'
    ? `<h1>Your Desk is ready</h1><p class="sub">${showPassword ? `Save the password now — this page shows it once. It was also sent to ${esc(o.email)}.` : `Your sign-in details were sent to ${esc(o.email)}.`}</p>
<div class="card"><p><strong>Address</strong><br><a href="https://${esc(o.host)}/">https://${esc(o.host)}/</a></p><p><strong>Username</strong> <code>owner</code> (or your email ${esc(o.email)})</p>${showPassword ? `<p><strong>Password</strong> <code>${esc(o.password)}</code></p>` : `<p><strong>Password</strong> in your email — <a href="mailto:tommy@webfacemedia.com?subject=Desk%20password">write to us</a> if it never arrived.</p>`}</div>
<p>Next:</p><ol class="steps"><li><a href="https://book.webface.cloud/book/tommyadeniyi">Book your set-up call</a> — 30 minutes, we do it together on screen.</li><li>Sign in — Desk opens the Business page and asks about your business in plain words.</li><li>On your computer, <a href="/download">get the app</a>; on your phone, open your Desk address and add it to the Home Screen.</li></ol><a class="btn" href="https://${esc(o.host)}/">Open your Desk</a>`
    : `<h1>${esc(stages[o.status] ?? o.status)}</h1><p class="sub">${esc(o.business)} · ${o.status === 'failed' || o.status === 'destroyed' ? `<a href="mailto:tommy@webfacemedia.com?subject=Desk%20order%20${esc(o.id)}">tommy@webfacemedia.com</a>` : 'this page updates itself.'}</p><div class="card"><p>${esc(o.detail ?? '')}</p></div>${o.status === 'failed' || o.status === 'destroyed' ? '' : '<script>setTimeout(()=>location.reload(),15000)</script>'}`
  return shell('Your Desk', inner)
}

/**
 * Record a failure on the order (and in the log) instead of dropping it: every one of
 * these used to be a console line nobody would ever read.
 * @param o - the order it happened to, or null for a store-wide job.
 * @param step - what was being attempted.
 * @param err - the failure.
 */
function note(o, step, err) {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[${o?.slug ?? 'store'}] ${step}: ${message}`)
  if (!o) return
  o.lastError = { step, message, at: new Date().toISOString() }
  save()
}

const running = new Set()
async function fulfil(o) {
  if (running.has(o.id)) return
  running.add(o.id)
  const log = (status, detail) => { o.status = status === 'dns-failed' ? o.status : status; o.detail = detail; o.updatedAt = new Date().toISOString(); save() }
  // Each fact is saved the moment it is known, so a store that dies mid-run can pick the
  // same box back up rather than stranding the order or building a second droplet.
  const update = (patch) => { Object.assign(o, patch); o.updatedAt = new Date().toISOString(); save() }
  try {
    o.attempts = (o.attempts ?? 0) + 1
    o.boxToken = o.boxToken ?? randomBytes(16).toString('hex'); save()
    const box = await provision(o, log, update)
    Object.assign(o, box, { status: 'ready', detail: '', lastError: undefined, readyAt: new Date().toISOString() }); save()
    await email(o).catch(e => note(o, 'welcome-email', e))
  } catch (e) {
    note(o, 'provision', e)
    o.status = 'failed'; o.detail = e.message; save()
  } finally { running.delete(o.id) }
}

/**
 * Pick up orders whose provisioning was cut short by a restart. Without this they sit in
 * `creating` or `installing` for ever, because the only thing driving them was a promise
 * in a process that no longer exists.
 */
function resumeInterrupted() {
  // An alert that was mid-send when the process died left this set; a restart is proof it is over.
  for (const o of Object.values(orders)) if (o.usageAlerting) delete o.usageAlerting
  const pending = resumableOrders(orders)
  if (pending.length === 0) return
  console.log(`resuming ${pending.length} interrupted order(s):`, pending.map(o => o.slug).join(', '))
  for (const o of pending) fulfil(o)
  for (const o of Object.values(orders)) {
    if (!o.static && IN_FLIGHT.includes(o.status) && (o.attempts ?? 0) >= MAX_ATTEMPTS && !running.has(o.id)) {
      note(o, 'provision', new Error(`gave up after ${o.attempts} attempts`))
      o.status = 'failed'; o.detail = 'Setting up this Desk did not finish; we are on it.'; save()
    }
  }
}
async function tellBox(o, state) {
  if (!o.host || !o.boxToken) return
  let portalUrl = ''
  if (state === 'past_due' && o.stripeCustomer) { try { portalUrl = (await stripe('billing_portal/sessions', { customer: o.stripeCustomer, return_url: `https://${o.host}/` })).url } catch (e) { note(o, 'billing-portal', e) } }
  const r = await fetch(`https://${o.host}/deskd/billing`, { method: 'POST', headers: { authorization: `Bearer ${o.boxToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ state, portalUrl }), signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`box said ${r.status}`)
  console.log('box', o.slug, 'billing →', state)
}
/** Delete a Desk's droplet and DNS record after a final snapshot; the order stays as a record. */
async function destroyBox(o) {
  const tok = process.env.DIGITALOCEAN_TOKEN
  if (o.dropletId && tok) {
    // Farewell snapshot: kept 30 days for a come-back or an export (terms), deleted by the 90-day sweep.
    try {
      const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
      const a = await (await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}/actions`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'snapshot', name: `desk-${o.slug}-final-${new Date().toISOString().slice(0, 10)}` }) })).json()
      for (let i = 0; i < 120 && a.action?.status === 'in-progress'; i++) { await new Promise(r => setTimeout(r, 10000)); const st = await (await fetch(`https://api.digitalocean.com/v2/actions/${a.action.id}`, { headers: h })).json(); a.action = st.action }
      o.finalSnapshot = a.action?.status === 'completed' ? a.action.resource_id : undefined
    } catch (e) { note(o, 'final-snapshot', e) }
  }
  if (o.dropletId && tok) await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}`, { method: 'DELETE', headers: { authorization: `Bearer ${tok}` } }).catch(e => note(o, 'droplet-delete', e))
  const cf = process.env.CLOUDFLARE_API_TOKEN; const zone = process.env.CLOUDFLARE_ZONE_ID ?? 'd3fc4cb5dfad60b2064472906607a170'
  if (cf && o.host?.endsWith('.webfacedesk.app')) {
    const h = { authorization: `Bearer ${cf}` }
    const q = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?name=${o.host}`, { headers: h })).json().catch(() => ({}))
    for (const r of q.result ?? []) await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${r.id}`, { method: 'DELETE', headers: h }).catch(e => note(o, 'dns-delete', e))
  }
  o.status = 'destroyed'; o.destroyedAt = new Date().toISOString(); save()
}
/** Usage watch: one alert per month to the operator when a Desk crosses the plan's token allowance (DESKAPI_MONTHLY_TOKEN_CAP, default 20M). */
function usageWatch(o) {
  const cap = Number(process.env.DESKAPI_MONTHLY_TOKEN_CAP ?? 20_000_000); const month = new Date().toISOString().slice(0, 7)
  if (!cap || !o.usage?.monthTokens || o.usage.monthTokens < cap || o.usageAlerted === month || o.usageAlerting) return
  // Marked only after the send succeeds, so a failed alert is retried next heartbeat
  // instead of being silently marked as delivered for the rest of the month.
  o.usageAlerting = true
  const to = process.env.DESKAPI_ALERT_EMAIL ?? 'tommy@webfacemedia.com'
  fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY ?? '', 'content-type': 'application/json' }, body: JSON.stringify({ sender: { name: 'webfaCe Desk', email: 'desk@webfacedesk.app' }, to: [{ email: to }], subject: `Desk ${o.slug} passed ${Math.round(cap / 1e6)}M tokens this month`, htmlContent: renderEmail({ title: 'A Desk is running hot', preheader: `${o.business ?? o.slug} — ${Math.round(o.usage.monthTokens / 1e6)}M tokens in ${month}.`, body: ep(`<strong>${em(o.business ?? o.slug)}</strong> (${em(o.slug)}) has used <strong>${Math.round(o.usage.monthTokens / 1e6)}M tokens</strong> in ${em(month)}, past the ${Math.round(cap / 1e6)}M mark. Plan: ${em(o.plan ?? '')}.`) }) }) }).then(r => { o.usageAlerting = false; if (!r.ok) throw new Error(`brevo ${r.status}`); o.usageAlerted = month; save() })
    .catch(e => { o.usageAlerting = false; note(o, 'usage-alert', e) })
}
/** Terms: 14 days read-only after a failed payment, then the Desk stops; a closed Desk's snapshot goes after 90 days. */
async function sweep() {
  const now = Date.now()
  for (const o of Object.values(orders)) {
    if (o.billing === 'past_due' && o.pastDueSince && now - Date.parse(o.pastDueSince) > 14 * 86400000 && o.status === 'ready') {
      o.billing = 'cancelled'; o.billingAt = new Date().toISOString(); save()
      await tellBox(o, 'cancelled').catch(e => note(o, 'stop-after-14-days', e))
    }
    if (o.status === 'destroyed' && o.finalSnapshot && o.destroyedAt && now - Date.parse(o.destroyedAt) > 90 * 86400000 && process.env.DIGITALOCEAN_TOKEN) {
      await fetch(`https://api.digitalocean.com/v2/snapshots/${o.finalSnapshot}`, { method: 'DELETE', headers: { authorization: `Bearer ${process.env.DIGITALOCEAN_TOKEN}` } }).catch(() => {})
      delete o.finalSnapshot; save()
    }
  }
}
/** Nightly DigitalOcean snapshot per live box, kept 30 days. */
async function snapshots() {
  await sweep().catch(e => note(null, 'sweep', e))
  const tok = process.env.DIGITALOCEAN_TOKEN; if (!tok) return
  const h = { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }
  // Static boxes (the demo/apex box itself) join the nightly snapshot loop: DESKAPI_STATIC_BOXES=slug:dropletId,…
  const statics = (process.env.DESKAPI_STATIC_BOXES ?? '').split(',').filter(Boolean).map(x => { const [slug, dropletId] = x.split(':'); return { slug, dropletId: Number(dropletId), status: 'ready', static: true } })
  for (const o of [...Object.values(orders).filter(x => x.status === 'ready' && x.dropletId && x.billing !== 'cancelled'), ...statics]) {
    try {
      const a = await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}/actions`, { method: 'POST', headers: h, body: JSON.stringify({ type: 'snapshot', name: `desk-${o.slug}-${new Date().toISOString().slice(0, 10)}` }) })
      if (!a.ok) throw new Error(`snapshot action ${a.status}`)
      const snaps = (await (await fetch(`https://api.digitalocean.com/v2/droplets/${o.dropletId}/snapshots?per_page=50`, { headers: h })).json()).snapshots ?? []
      // Retention is by age (30 days), and a final snapshot from a closed Desk is never in this list.
      const cutoff = Date.now() - 30 * 86400000
      for (const s of snaps.filter(x => !x.name.includes('-final-') && Date.parse(x.created_at) < cutoff)) await fetch(`https://api.digitalocean.com/v2/snapshots/${s.id}`, { method: 'DELETE', headers: h })
      o.lastSnapshot = new Date().toISOString(); if (!o.static) save(); console.log('snapshot ok', o.slug, snaps.length)
    } catch (e) { note(o, 'snapshot', e) }
  }
}
const msToNextSnapshot = () => { const d = new Date(); d.setUTCHours(7, 30, 0, 0); if (d <= new Date()) d.setUTCDate(d.getUTCDate() + 1); return d - new Date() }
setTimeout(function tick() { snapshots().finally(() => setTimeout(tick, msToNextSnapshot())) }, msToNextSnapshot()).unref()

async function email(o) {
  if (!process.env.BREVO_API_KEY) return
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({
    sender: { name: 'webfaCe Desk', email: process.env.DESK_FROM_EMAIL ?? 'desk@webfacemedia.com' }, to: [{ email: o.email }], subject: `${o.business}: your Desk is ready`,
    htmlContent: renderEmail({
      title: 'Your Desk is ready',
      preheader: `${o.business} is set up at ${o.host}. Your sign-in details are inside.`,
      body:
        ep(`The Desk for <strong>${em(o.business)}</strong> is set up and waiting.`) +
        ebtn(`https://${o.host}/`, 'Open your Desk') +
        epanel(ep(`Username <strong>owner</strong> (or this email address)<br>Password <strong>${em(o.password)}</strong>`).replace('margin:0 0 14px', 'margin:0')) +
        ep(`If your Google address is ${em(o.email)}, <strong>Sign in with Google</strong> works too.`) +
        ep(`${elink('https://book.webface.cloud/book/tommyadeniyi', 'Book your set-up call')} — 30 minutes, together on screen. Or just sign in: your Desk opens the Business page and asks about the business. On your computer you can also ${elink(`${process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'}/download`, 'get the desktop app')}.`) +
        emuted('Your subscription, invoices and card live under Billing in your Desk&rsquo;s sidebar — you can cancel there at any time.'),
    }),
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
      const business = cleanName(f.get('business'))?.trim(); const emailAddr = f.get('email')?.trim()
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
        if (!o) { note(null, 'webhook-unmatched', new Error(`${ev.type} for ${obj.subscription ?? obj.id} matches no order`)); return json(res, 200, { ok: true, unknown: true }) }
        if (o.status === 'created') { o.status = 'paid'; o.stripeCustomer = obj.customer; o.stripeSubscription = obj.subscription; o.paidAt = new Date().toISOString(); save(); fulfil(o) }
        return json(res, 200, { ok: true })
      }
      if (ev.type === 'invoice.payment_failed' || ev.type === 'customer.subscription.deleted' || ev.type === 'invoice.paid') {
        const o = Object.values(orders).find(x => x.stripeSubscription === (obj.subscription ?? obj.id))
        if (o) {
          const state = billingStateFor(ev.type)
          if (state === 'past_due' && o.billing !== 'past_due') o.pastDueSince = new Date().toISOString()
          if (state !== 'past_due') delete o.pastDueSince
          if (!(state === 'ok' && (o.billing ?? 'ok') === 'ok')) { o.billing = state; o.billingAt = new Date().toISOString(); save(); tellBox(o, state).catch(e => note(o, 'billing-notify', e)) }
        } else note(null, 'billing-unmatched', new Error(`${ev.type} for subscription ${obj.subscription ?? obj.id} matches no order`))
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
      return json(res, 200, { token: j.token, prefix: j.prefix, client })
    }
    const hb = u.pathname.match(/^\/api\/boxes\/([a-z0-9-]+)\/heartbeat$/)
    if (hb && req.method === 'POST') {
      const slug = hb[1]; const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const staticTok = (process.env.DESKAPI_STATIC_BOX_TOKENS ?? '').split(',').map(x => x.split(':')).find(([s]) => s === slug)?.[1]
      let o = Object.values(orders).find(x => x.slug === slug)
      if (!o && staticTok && equalSecret(tok, staticTok)) { o = orders[`static_${slug}`] ??= { id: `static_${slug}`, slug, host: `${slug}.${new URL(PUBLIC).hostname}`, status: 'ready', static: true, created: new Date().toISOString() } }
      if (!o || !(o.boxToken ? equalSecret(tok, o.boxToken) : o.static)) return json(res, 401, { error: 'no' })
      o.lastHeartbeat = new Date().toISOString(); const beat = JSON.parse((await body(req)).toString() || '{}'); o.heartbeat = { ready: beat.ready, harness: beat.harness, google: beat.google?.accounts?.length ?? 0, push: beat.push?.devices ?? 0 }; if (beat.usage) o.usage = { monthTokens: beat.usage.monthTokens, totalTokens: beat.usage.totalTokens, sessions: beat.usage.sessions, turns: beat.usage.turns }; usageWatch(o); save(); return json(res, 200, { ok: true })
    }
    // The Desk's Billing link: a fresh Stripe customer-portal session for this box's owner.
    const pm = u.pathname.match(/^\/api\/boxes\/([a-z0-9-]+)\/portal$/)
    if (pm && req.method === 'POST') {
      const o = Object.values(orders).find(x => x.slug === pm[1]); const tok = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      const staticTok = (process.env.DESKAPI_STATIC_BOX_TOKENS ?? '').split(',').map(x => x.split(':')).find(([s]) => s === pm[1])?.[1]
      const okTok = (want) => equalSecret(tok, want)
      if (!(okTok(o?.boxToken) || okTok(staticTok))) return json(res, 401, { error: 'no' })
      if (!o.stripeCustomer || !STRIPE) return json(res, 404, { error: 'no_billing', message: 'This Desk is not billed through the store.' })
      try { const p = await stripe('billing_portal/sessions', { customer: o.stripeCustomer, return_url: `https://${o.host}/` }); return json(res, 200, { url: p.url }) } catch (e) { return json(res, 502, { error: 'stripe', message: e.message }) }
    }
    if (u.pathname === '/api/ops/snapshot' && req.method === 'POST') {
      const k = (req.headers.authorization ?? '').replace(/^Bearer /, ''); if (!process.env.DESKAPI_OPS_KEY || k !== process.env.DESKAPI_OPS_KEY) return json(res, 401, { error: 'no' })
      await snapshots(); return json(res, 200, { ok: true })
    }
    // Google sign-in relay: ONE Google client (DESK_SIGNIN_CLIENT_ID/SECRET, scopes
    // openid+email only — no mail or files) signs owners into every Desk. The box sends
    // the owner here; Google returns here; we hand the box a ticket signed with that
    // box's own token, which only it can verify. Nothing about the sign-in is stored.
    const boxTokenFor = slug => Object.values(orders).find(x => x.slug === slug)?.boxToken || (process.env.DESKAPI_STATIC_BOX_TOKENS ?? '').split(',').map(x => x.split(':')).find(([s]) => s === slug)?.[1]
    const boxHostOk = box => { const slug = box.split('.')[0]; return /^[a-z0-9-]+$/.test(slug) && box === `${slug}.${new URL(PUBLIC).hostname}` && boxTokenFor(slug) }
    if (u.pathname === '/auth/google/start') {
      if (!process.env.DESK_SIGNIN_CLIENT_ID) return html(res, 404, 'Google sign-in is not set up yet.')
      const box = u.searchParams.get('box') ?? ''; if (!boxHostOk(box)) return html(res, 400, 'Unknown Desk.')
      const state = Buffer.from(JSON.stringify({ box, next: u.searchParams.get('next') ?? '/', n: randomBytes(8).toString('hex') })).toString('base64url')
      const sig = createHmac('sha256', boxTokenFor(box.split('.')[0])).update(state).digest('hex')
      const q = new URLSearchParams({ client_id: process.env.DESK_SIGNIN_CLIENT_ID, redirect_uri: `${PUBLIC}/auth/google/callback`, response_type: 'code', scope: 'openid email', prompt: 'select_account', state: `${state}.${sig}` })
      res.writeHead(302, { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` }); return res.end()
    }
    if (u.pathname === '/auth/google/callback') {
      const [state, sig] = (u.searchParams.get('state') ?? '').split('.')
      let st = null; try { st = JSON.parse(Buffer.from(state ?? '', 'base64url').toString()) } catch { st = null }
      if (!st || !boxHostOk(String(st.box ?? ''))) return html(res, 400, 'Unknown Desk.')
      const tok = boxTokenFor(st.box.split('.')[0]); const want = createHmac('sha256', tok).update(state).digest('hex')
      if (!equalSecret(sig, want)) return html(res, 400, 'Bad sign-in state.')
      const fail = m => { res.writeHead(302, { location: `https://${st.box}/login?gerr=${encodeURIComponent(m)}` }); res.end() }
      const code = u.searchParams.get('code'); if (!code) return fail('Google did not sign you in.')
      const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.DESK_SIGNIN_CLIENT_ID, client_secret: process.env.DESK_SIGNIN_CLIENT_SECRET ?? '', redirect_uri: `${PUBLIC}/auth/google/callback`, grant_type: 'authorization_code' }) })
      const tj = await tr.json().catch(() => ({})); if (!tj.id_token) return fail('Google did not sign you in.')
      const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tj.id_token)}`).then(r => r.json()).catch(() => ({}))
      if (info.aud !== process.env.DESK_SIGNIN_CLIENT_ID || info.email_verified !== 'true' || !info.email) return fail('Google did not sign you in.')
      const body = Buffer.from(JSON.stringify({ email: info.email, exp: Date.now() + 120000, n: st.n })).toString('base64url')
      res.writeHead(302, { location: `https://${st.box}/auth/google/finish?ticket=${body}.${createHmac('sha256', tok).update(body).digest('hex')}&next=${encodeURIComponent(String(st.next ?? '/'))}` }); return res.end()
    }
    if (u.pathname === '/api/health') return json(res, 200, { ok: true, stripe: Boolean(STRIPE), provisioning: Boolean(process.env.DIGITALOCEAN_TOKEN), dns: Boolean(process.env.CLOUDFLARE_API_TOKEN), orders: Object.keys(orders).length })
    res.writeHead(404); res.end('not found')
  } catch (e) { console.error(e); if (res.headersSent) return res.end(); json(res, 500, { error: e.message }) }
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`deskapi on 127.0.0.1:${PORT} → ${PUBLIC}`)
  resumeInterrupted()
})
