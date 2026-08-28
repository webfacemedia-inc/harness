#!/usr/bin/env node
// One-shot Stripe setup for webfacedesk.app. Idempotent: finds products by
// metadata.desk_plan, prices by lookup_key, the webhook by URL.
//   STRIPE_SECRET_KEY=sk_... node src/setup.js [--public https://webfacedesk.app]
// Prints the env lines to paste into /srv/deskapi/deskapi.env.
const KEY = process.env.STRIPE_SECRET_KEY
if (!KEY) { console.error('STRIPE_SECRET_KEY is required'); process.exit(2) }
const PUBLIC = process.argv.includes('--public') ? process.argv[process.argv.indexOf('--public') + 1] : 'https://webfacedesk.app'
const api = async (method, path, params) => {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { authorization: `Bearer ${KEY}`, ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: params ? new URLSearchParams(params) : undefined })
  const j = await r.json(); if (!r.ok) throw new Error(`${method} ${path}: ${j.error?.message}`); return j
}
const PLANS = [
  { key: 'business', name: 'Desk for Business', desc: 'Your own always-on business assistant on a private computer in Toronto: every mode, all connections, desktop, phone and web, nightly backups.', setup: 150000, monthly: 24900 },
  { key: 'operators', name: 'Desk for Operators', desc: 'Everything in Business plus the studio playbook and a Desk for every client under your brand.', setup: 250000, monthly: 49900 },
]
const out = []
for (const p of PLANS) {
  const found = (await api('GET', `products/search?query=${encodeURIComponent(`metadata['desk_plan']:'${p.key}'`)}`)).data[0]
  const product = found ?? await api('POST', 'products', { name: p.name, description: p.desc, 'metadata[desk_plan]': p.key })
  const price = async (kind, amount, recurring) => {
    const lk = `desk_${p.key}_${kind}`
    const ex = (await api('GET', `prices?lookup_keys[]=${lk}&active=true`)).data[0]
    if (ex) return ex
    return api('POST', 'prices', { product: product.id, currency: 'cad', unit_amount: String(amount), lookup_key: lk, nickname: `${p.name} ${kind}`, ...(recurring ? { 'recurring[interval]': 'month' } : {}) })
  }
  const setup = await price('setup', p.setup, false), monthly = await price('monthly', p.monthly, true)
  out.push(`STRIPE_PRICE_${p.key.toUpperCase()}_SETUP=${setup.id}`, `STRIPE_PRICE_${p.key.toUpperCase()}_MONTHLY=${monthly.id}`)
  console.error(`${p.name}: product ${product.id}, setup ${setup.id} (C$${p.setup / 100}), monthly ${monthly.id} (C$${p.monthly / 100}/mo)`)
}
const url = `${PUBLIC}/api/stripe/webhook`
const hooks = (await api('GET', 'webhook_endpoints?limit=100')).data.filter(h => h.url === url)
let secretLine
if (hooks.length) { console.error(`webhook exists: ${hooks[0].id} (secret shown only at creation — reuse the one you saved, or delete it in the dashboard and re-run)`); secretLine = 'STRIPE_WEBHOOK_SECRET=<existing>' }
else { const h = await api('POST', 'webhook_endpoints', { url, 'enabled_events[0]': 'checkout.session.completed', 'enabled_events[1]': 'invoice.payment_failed', 'enabled_events[2]': 'customer.subscription.deleted', description: 'webfaCe Desk storefront' }); console.error(`webhook created: ${h.id}`); secretLine = `STRIPE_WEBHOOK_SECRET=${h.secret}` }
console.log([`STRIPE_SECRET_KEY=${KEY}`, secretLine, ...out].join('\n'))
