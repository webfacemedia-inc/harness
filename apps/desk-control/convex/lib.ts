// Shared plumbing: component handles, the operator gate, env access, audit,
// and the plain fetch helpers every action uses to talk to the outside world.
import { WorkflowManager } from '@convex-dev/workflow'
import { ActionRetrier } from '@convex-dev/action-retrier'
import { Crons } from '@convex-dev/crons'
import { RateLimiter, MINUTE } from '@convex-dev/rate-limiter'
import { components, internal } from './_generated/api'
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server'
import { nowIso } from './core'

export const workflow = new WorkflowManager(components.workflow)
export const retrier = new ActionRetrier(components.actionRetrier)
export const crons = new Crons(components.crons)
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  checkout: { kind: 'token bucket', rate: 5, period: MINUTE, capacity: 5 },
})

/** A required env var; a missing one fails loudly at use, never silently no-ops. */
export function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set on this deployment (npx convex env set ${name} …)`)
  return v
}

/**
 * The console gate: Clerk authenticates, this authorises. An identity whose
 * email is in OPERATOR_EMAILS (comma-separated) or the operators table may act.
 */
export async function requireOperator(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  const email = identity?.email?.toLowerCase()
  if (!email) throw new Error('Sign in to use the console.')
  const allowed = (process.env.OPERATOR_EMAILS ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
  if (allowed.includes(email)) return email
  const row = await ctx.db.query('operators').withIndex('by_email', q => q.eq('email', email)).unique()
  if (row) return email
  throw new Error(`${email} is not an operator of this control plane.`)
}

/** The same gate for actions, which have no db of their own. */
export async function requireOperatorAction(ctx: ActionCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity()
  const email = identity?.email?.toLowerCase()
  if (!email) throw new Error('Sign in to use the console.')
  const ok: boolean = await ctx.runQuery(internal.orders.isOperator, { email })
  if (!ok) throw new Error(`${email} is not an operator of this control plane.`)
  return email
}

/** One audit row. Every consequential act goes through here. */
export async function audit(
  ctx: MutationCtx,
  actor: 'stripe' | 'ops' | 'system' | 'box',
  action: string,
  orderId?: string,
  detail?: string,
): Promise<void> {
  await ctx.db.insert('opsAudit', { at: nowIso(), actor, action, ...(orderId ? { orderId } : {}), ...(detail ? { detail } : {}) })
}

/** DigitalOcean API call; throws with the API's message on any non-2xx. */
export async function doApi(method: string, path: string, body?: unknown): Promise<Record<string, any>> {
  const r = await fetch(`https://api.digitalocean.com/v2${path}`, {
    method,
    headers: { authorization: `Bearer ${env('DIGITALOCEAN_TOKEN')}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (r.status === 204) return {}
  const j: Record<string, any> = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`DigitalOcean ${method} ${path}: ${r.status} ${j.message ?? ''}`)
  return j
}

/** Stripe REST (form-encoded); throws with Stripe's message on any non-2xx. */
export async function stripeApi(path: string, params: Record<string, string>): Promise<Record<string, any>> {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env('STRIPE_SECRET_KEY')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const j: Record<string, any> = await r.json()
  if (!r.ok) throw new Error(`stripe ${path}: ${j.error?.message ?? r.status}`)
  return j
}

/** Brevo transactional send; throws on any non-2xx so the retrier can retry it. */
export async function brevoSend(args: { to: string; subject: string; html: string }): Promise<void> {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'webfaCe Desk', email: process.env.DESK_FROM_EMAIL ?? 'desk@webfacedesk.app' },
      to: [{ email: args.to }],
      subject: args.subject,
      htmlContent: args.html,
    }),
  })
  if (!r.ok) throw new Error(`brevo ${r.status}: ${(await r.text()).slice(0, 200)}`)
}

/** Cloudflare DNS upsert for <slug>.webfacedesk.app → ip. Returns false when no token is set. */
export async function cfDnsUpsert(slug: string, ip: string): Promise<boolean> {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token) return false
  const zone = process.env.CLOUDFLARE_ZONE_ID ?? 'd3fc4cb5dfad60b2064472906607a170'
  const name = `${slug}.${process.env.DESK_DOMAIN ?? 'webfacedesk.app'}`
  const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const q: Record<string, any> = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?type=A&name=${name}`, { headers: h })).json()
  const payload = { type: 'A', name, content: ip, ttl: 60, proxied: false }
  const existing = q.result?.[0]
  const r = existing
    ? await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${existing.id}`, { method: 'PUT', headers: h, body: JSON.stringify(payload) })
    : await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records`, { method: 'POST', headers: h, body: JSON.stringify(payload) })
  const j: Record<string, any> = await r.json().catch(() => ({}))
  if (!j.success) throw new Error(`cloudflare dns ${name}: ${JSON.stringify(j.errors ?? r.status).slice(0, 200)}`)
  return true
}

/** Delete every DNS record for a host. Missing token = nothing to do. */
export async function cfDnsDelete(host: string): Promise<void> {
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!token || !host.endsWith(process.env.DESK_DOMAIN ?? 'webfacedesk.app')) return
  const zone = process.env.CLOUDFLARE_ZONE_ID ?? 'd3fc4cb5dfad60b2064472906607a170'
  const h = { authorization: `Bearer ${token}` }
  const q: Record<string, any> = await (await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records?name=${host}`, { headers: h })).json()
  for (const rec of q.result ?? []) {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/dns_records/${rec.id}`, { method: 'DELETE', headers: h })
  }
}

/** POST to a box's deskd with its bearer token. Throws on non-2xx for the retrier. */
export async function boxCall(host: string, path: string, token: string, body: unknown): Promise<Record<string, any>> {
  const r = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  })
  if (!r.ok) throw new Error(`box ${host}${path} said ${r.status}`)
  return await r.json().catch(() => ({}))
}
