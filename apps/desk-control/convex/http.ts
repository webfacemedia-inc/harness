// The public surface, kept shape-for-shape with deskapi so nothing on the
// boxes changes: the storefront pages, the Stripe webhook, the box heartbeat
// and portal, the ops-key API operator Desks use, and the Google sign-in relay.
import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { rateLimiter } from './lib'
import { equalSecret, hmacHex, verifyStripeSignature } from './core'

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const PUBLIC = () => process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'

const html = (status: number, body: string) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const b64urlEncode = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlDecode = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

const shell = (title: string, inner: string) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="light"><title>${esc(title)} · webfaCe Desk</title><script src="https://insights.webfacemedia.com/api/script.js" data-site="webface" defer></script>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>:root{--blue:#3499cc;--deep:#1f6f99;--ink:#152029;--mute:#5a6a78;--line:#dfe6ec;--tint:#eef6fb}*{box-sizing:border-box}body{margin:0;background:#fff;color:var(--ink);font:16px/1.55 "Inter Tight",-apple-system,system-ui,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:56px 24px}h1{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:34px;margin:0 0 8px;letter-spacing:-.01em}p.sub{color:var(--mute);margin:0 0 28px}
label{display:block;font-weight:600;font-size:14px;margin:16px 0 6px}input{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;font:inherit}input:focus{outline:2px solid var(--blue);border-color:var(--blue)}
.btn{display:inline-block;margin-top:22px;padding:14px 22px;border:0;border-radius:10px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}.btn:hover{background:var(--deep)}
.card{border:1px solid var(--line);border-radius:14px;padding:22px;margin-top:20px;background:var(--tint)}.card code{font-size:17px;background:#fff;padding:4px 8px;border-radius:6px;border:1px solid var(--line)}
.steps{margin:0;padding-left:20px;color:var(--mute)}.err{color:#b42318}.brand{display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:28px}.brand a{color:inherit;text-decoration:none}</style>
<body><div class="wrap"><div class="brand"><a href="/">webfaCe Desk</a></div>${inner}</div></body></html>`

const PLAN_NAMES: Record<string, string> = { business: 'Desk for Business', operators: 'Desk for Operators' }

const checkoutPage = (plan: string, error?: string) => {
  const key = PLAN_NAMES[plan] ? plan : 'business'
  return shell('Get your Desk', `<h1>${esc(PLAN_NAMES[key])}</h1><p class="sub">Tell us who the Desk is for. Payment is on the next screen; your computer is built the moment it clears.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/api/checkout"><input type="hidden" name="plan" value="${key}">
<label for="b">Business name</label><input id="b" name="business" required maxlength="80" placeholder="Maple &amp; Main Home Services">
<label for="e">Your email</label><input id="e" name="email" type="email" required placeholder="you@business.com">
<label for="s">Your Desk address</label><input id="s" name="slug" pattern="[a-z0-9-]{2,24}" placeholder="maple-main" title="letters, numbers and dashes"><p class="sub" style="margin:6px 0 0;font-size:13px">yourname.webfacedesk.app — leave blank and we'll pick from the business name.</p>
<button class="btn" type="submit">Continue to payment →</button></form>`)
}

const http = httpRouter()

http.route({ path: '/checkout', method: 'GET', handler: httpAction(async (_ctx, req) => {
  const plan = new URL(req.url).searchParams.get('plan') ?? 'business'
  return html(200, checkoutPage(plan))
}) })

http.route({ path: '/api/checkout', method: 'POST', handler: httpAction(async (ctx, req) => {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown'
  const { ok } = await rateLimiter.limit(ctx, 'checkout', { key: ip })
  if (!ok) return html(429, checkoutPage('business', 'Too many attempts just now — give it a minute.'))
  if (!process.env.STRIPE_SECRET_KEY) return html(503, checkoutPage('business', 'Checkout is not open yet — write to tommy@webfacemedia.com and we will set you up by hand.'))
  const f = new URLSearchParams(await req.text())
  const plan = PLAN_NAMES[f.get('plan') ?? ''] ? f.get('plan')! : 'business'
  const business = (f.get('business') ?? '').trim()
  const email = (f.get('email') ?? '').trim()
  if (!business || !email) return html(400, checkoutPage(plan, 'Business name and email are needed.'))
  const { orderId } = await ctx.runMutation(internal.ops.storefrontOrder, { plan, business, email, slug: f.get('slug') ?? undefined })
  const url = await ctx.runAction(internal.ops.checkoutForOrder, { orderId, plan })
  return new Response(null, { status: 303, headers: { location: url } })
}) })

http.route({ path: '/welcome', method: 'GET', handler: httpAction(async (ctx, req) => {
  const orderId = new URL(req.url).searchParams.get('order') ?? ''
  const o = orderId ? await ctx.runQuery(internal.orders.byOrderId, { orderId }) : null
  if (!o) return html(404, shell('Order', '<h1>Order not found</h1><p class="sub">Check the link in your email, or write to tommy@webfacemedia.com.</p>'))
  const stages: Record<string, string> = { created: 'Waiting for payment…', paid: 'Paid. Creating your Desk in Toronto…', creating: 'Creating your Desk in Toronto…', installing: 'Setting up your Desk…', ready: 'Your Desk is ready.', failed: 'Something went wrong — we are on it and will email you.', destroyed: 'This Desk has been closed.' }
  const password = o.status === 'ready' ? await ctx.runMutation(internal.secrets.revealPassword, { orderId }) : null
  const inner = o.status === 'ready'
    ? `<h1>Your Desk is ready</h1><p class="sub">${password ? `Save the password now — this page shows it once. It was also sent to ${esc(o.email)}.` : `Your sign-in details were sent to ${esc(o.email)}.`}</p>
<div class="card"><p><strong>Address</strong><br><a href="https://${esc(o.host)}/">https://${esc(o.host)}/</a></p><p><strong>Username</strong> <code>owner</code> (or your email ${esc(o.email)})</p>${password ? `<p><strong>Password</strong> <code>${esc(password)}</code></p>` : '<p><strong>Password</strong> in your email — <a href="mailto:tommy@webfacemedia.com?subject=Desk%20password">write to us</a> if it never arrived.</p>'}</div>
<p>Next:</p><ol class="steps"><li><a href="https://book.webface.cloud/book/tommyadeniyi">Book your set-up call</a> — 30 minutes, we do it together on screen.</li><li>Sign in — Desk opens the Business page and asks about your business in plain words.</li><li>On your computer, <a href="/download">get the app</a>; on your phone, open your Desk address and add it to the Home Screen.</li></ol><a class="btn" href="https://${esc(o.host)}/">Open your Desk</a>`
    : `<h1>${esc(stages[o.status] ?? o.status)}</h1><p class="sub">${esc(o.business)} · ${o.status === 'failed' || o.status === 'destroyed' ? `<a href="mailto:tommy@webfacemedia.com?subject=Desk%20order%20${esc(o.orderId)}">tommy@webfacemedia.com</a>` : 'this page updates itself.'}</p><div class="card"><p>${esc(o.detail ?? '')}</p></div>${o.status === 'failed' || o.status === 'destroyed' ? '' : '<script>setTimeout(()=>location.reload(),15000)</script>'}`
  return html(200, shell('Your Desk', inner))
}) })

http.route({ path: '/api/stripe/webhook', method: 'POST', handler: httpAction(async (ctx, req) => {
  const raw = await req.text()
  const okSig = await verifyStripeSignature(raw, req.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET ?? '')
  if (!okSig) return json(400, { error: 'bad signature' })
  const ev = JSON.parse(raw)
  const out = await ctx.runMutation(internal.billing.applyEvent, { stripeEventId: String(ev.id ?? ''), type: String(ev.type ?? ''), object: ev.data?.object ?? {} })
  if (out.fulfil) await ctx.runMutation(internal.ops.fulfil, { orderId: out.fulfil })
  if (out.tellBox) await ctx.runMutation(internal.billing.scheduleTellBox, out.tellBox)
  return json(200, { ok: true })
}) })

// Status JSON the welcome page and operator Desks poll. Never the password.
http.route({ pathPrefix: '/api/orders/', method: 'GET', handler: httpAction(async (ctx, req) => {
  const orderId = new URL(req.url).pathname.split('/')[3] ?? ''
  const o = await ctx.runQuery(internal.orders.byOrderId, { orderId })
  if (!o) return json(404, { error: 'no such order' })
  return json(200, { id: o.orderId, status: o.status, detail: o.detail ?? '', host: o.host ?? null, business: o.business })
}) })

http.route({ pathPrefix: '/api/orders/', method: 'POST', handler: httpAction(async (ctx, req) => {
  const parts = new URL(req.url).pathname.split('/')
  if (parts[4] !== 'resend') return json(404, { error: 'not found' })
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  if (!equalSecret(token, process.env.DESKAPI_ADMIN_TOKEN ?? '')) return json(401, { error: 'no' })
  await ctx.runMutation(internal.ops.opsBoxAction, { orderId: parts[3] ?? '', op: 'resend' })
  return json(200, { ok: true })
}) })

// The boxes' own calls: heartbeat every 60 s, portal from the /billing page.
http.route({ pathPrefix: '/api/boxes/', method: 'POST', handler: httpAction(async (ctx, req) => {
  const parts = new URL(req.url).pathname.split('/')
  const slug = parts[3] ?? '', op = parts[4] ?? ''
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  const orderId = await ctx.runQuery(internal.secrets.authenticateBox, { slug, token })
  if (!orderId) return json(401, { error: 'no' })
  if (orderId.startsWith('static_')) await ctx.runMutation(internal.secrets.ensureStaticOrder, { slug })
  if (op === 'heartbeat') {
    const body = await req.json().catch(() => ({}))
    await ctx.runMutation(internal.boxes.heartbeat, { orderId, body })
    return json(200, { ok: true })
  }
  if (op === 'portal') {
    const url = await ctx.runAction(internal.billing.portalUrl, { orderId })
    return url ? json(200, { url }) : json(404, { error: 'no_billing' })
  }
  return json(404, { error: 'not found' })
}) })

// The ops-key API operator Desks use (they cannot Clerk); same shapes as deskapi.
const opsKeyOk = (req: Request) => {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '')
  return equalSecret(token, process.env.DESKAPI_OPS_KEY ?? '')
}

http.route({ path: '/api/ops/boxes', method: 'GET', handler: httpAction(async (ctx, req) => {
  if (!opsKeyOk(req)) return json(401, { error: 'no' })
  const rows = await ctx.runQuery(internal.orders.opsList, {})
  return json(200, rows)
}) })

http.route({ path: '/api/ops/boxes', method: 'POST', handler: httpAction(async (ctx, req) => {
  if (!opsKeyOk(req)) return json(401, { error: 'no' })
  const b = await req.json().catch(() => ({}))
  if (!b.business || !b.email) return json(400, { error: 'business and email are needed' })
  const out = await ctx.runMutation(internal.ops.opsCreateBox, {
    business: String(b.business), email: String(b.email), plan: String(b.plan ?? 'business'),
    slug: b.slug ? String(b.slug) : undefined,
    webfaceClient: b.webfaceClient ? String(b.webfaceClient) : undefined,
    sandbox: Boolean(b.sandbox),
  })
  return json(202, out)
}) })

http.route({ path: '/api/ops/action', method: 'POST', handler: httpAction(async (ctx, req) => {
  if (!opsKeyOk(req)) return json(401, { error: 'no' })
  const b = await req.json().catch(() => ({}))
  await ctx.runMutation(internal.ops.opsBoxAction, { orderId: String(b.id ?? ''), op: String(b.op ?? '') })
  return json(200, { ok: true })
}) })

// Google sign-in relay: one OAuth client for the whole fleet; the ticket back
// to the box is signed with that box's own token, which only it can verify.
// Nothing about the sign-in is stored.
const boxHostOk = (box: string) => {
  const slug = box.split('.')[0] ?? ''
  return /^[a-z0-9-]+$/.test(slug) && box === `${slug}.${new URL(PUBLIC()).hostname}` ? slug : null
}

http.route({ path: '/auth/google/start', method: 'GET', handler: httpAction(async (ctx, req) => {
  if (!process.env.DESK_SIGNIN_CLIENT_ID) return html(404, 'Google sign-in is not set up yet.')
  const u = new URL(req.url)
  const box = u.searchParams.get('box') ?? ''
  const slug = boxHostOk(box)
  const token = slug ? await ctx.runQuery(internal.secrets.boxTokenBySlug, { slug }) : null
  if (!token) return html(400, 'Unknown Desk.')
  const n = crypto.getRandomValues(new Uint8Array(8)).reduce((a, b) => a + b.toString(16).padStart(2, '0'), '')
  const state = b64urlEncode(JSON.stringify({ box, next: u.searchParams.get('next') ?? '/', n }))
  const sig = await hmacHex(token, state)
  const q = new URLSearchParams({ client_id: process.env.DESK_SIGNIN_CLIENT_ID, redirect_uri: `${PUBLIC()}/auth/google/callback`, response_type: 'code', scope: 'openid email', prompt: 'select_account', state: `${state}.${sig}` })
  return new Response(null, { status: 302, headers: { location: `https://accounts.google.com/o/oauth2/v2/auth?${q}` } })
}) })

http.route({ path: '/auth/google/callback', method: 'GET', handler: httpAction(async (ctx, req) => {
  const u = new URL(req.url)
  const [state, sig] = (u.searchParams.get('state') ?? '').split('.')
  let st: { box?: string; next?: string; n?: string } | null = null
  try { st = JSON.parse(b64urlDecode(state ?? '')) } catch { st = null }
  const slug = st ? boxHostOk(String(st.box ?? '')) : null
  const token = slug ? await ctx.runQuery(internal.secrets.boxTokenBySlug, { slug }) : null
  if (!st || !token) return html(400, 'Unknown Desk.')
  if (!equalSecret(sig, await hmacHex(token, state!))) return html(400, 'Bad sign-in state.')
  const fail = (m: string) => new Response(null, { status: 302, headers: { location: `https://${st!.box}/login?gerr=${encodeURIComponent(m)}` } })
  const code = u.searchParams.get('code')
  if (!code) return fail('Google did not sign you in.')
  const tr = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: process.env.DESK_SIGNIN_CLIENT_ID ?? '', client_secret: process.env.DESK_SIGNIN_CLIENT_SECRET ?? '', redirect_uri: `${PUBLIC()}/auth/google/callback`, grant_type: 'authorization_code' }) })
  const tj: Record<string, any> = await tr.json().catch(() => ({}))
  if (!tj.id_token) return fail('Google did not sign you in.')
  const info: Record<string, any> = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tj.id_token)}`).then(r => r.json()).catch(() => ({}))
  if (info.aud !== process.env.DESK_SIGNIN_CLIENT_ID || info.email_verified !== 'true' || !info.email) return fail('Google did not sign you in.')
  const body = b64urlEncode(JSON.stringify({ email: info.email, exp: Date.now() + 120000, n: st.n }))
  return new Response(null, { status: 302, headers: { location: `https://${st.box}/auth/google/finish?ticket=${body}.${await hmacHex(token, body)}&next=${encodeURIComponent(String(st.next ?? '/'))}` } })
}) })

http.route({ path: '/api/health', method: 'GET', handler: httpAction(async (ctx) => {
  const { orders } = await ctx.runQuery(internal.ops.healthCounts, {})
  return json(200, {
    ok: true,
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    provisioning: Boolean(process.env.DIGITALOCEAN_TOKEN),
    dns: Boolean(process.env.CLOUDFLARE_API_TOKEN),
    orders,
  })
}) })

export default http
