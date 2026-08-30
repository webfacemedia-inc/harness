// The store's decision logic, kept free of network, disk and process state so it
// can be tested. Everything here is a pure function of its arguments.
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Statuses a provisioning run passes through; an order sitting in one of these was interrupted. */
export const IN_FLIGHT = ['paid', 'creating', 'installing']

/** How many times a box may be re-attempted after an interrupted run before it is called failed. */
export const MAX_ATTEMPTS = 3

/**
 * Strip anything that would break a shell line or a heredoc out of an owner-supplied name.
 * @param v - the raw value.
 * @returns a single-line printable name, at most 80 characters.
 */
export const cleanName = v => String(v ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80)

/**
 * The billing state a Stripe event puts a Desk into.
 * @param type - the Stripe event type.
 * @returns 'ok' | 'past_due' | 'cancelled', or null when the event does not change state.
 */
export function billingStateFor(type) {
  if (type === 'invoice.paid') return 'ok'
  if (type === 'invoice.payment_failed') return 'past_due'
  if (type === 'customer.subscription.deleted') return 'cancelled'
  return null
}

/**
 * Orders whose provisioning run was cut short — the store died mid-flight, so nothing
 * is driving them any more. Static boxes are never provisioned, so they never qualify.
 * @param orders - every order record, by id.
 * @param maxAttempts - give up after this many resumes.
 * @returns the orders to pick back up, oldest first.
 */
export function resumableOrders(orders, maxAttempts = MAX_ATTEMPTS) {
  return Object.values(orders ?? {})
    .filter(o => o && !o.static && IN_FLIGHT.includes(o.status) && (o.attempts ?? 0) < maxAttempts)
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
}

/**
 * Constant-time secret comparison that does not leak length through a throw.
 * @param a - the presented value.
 * @param b - the expected value.
 * @returns true when both are non-empty and identical.
 */
export function equalSecret(a, b) {
  const x = String(a ?? ''), y = String(b ?? '')
  if (!x || !y || x.length !== y.length) return false
  return timingSafeEqual(Buffer.from(x), Buffer.from(y))
}

/**
 * Verify a Stripe webhook signature header.
 * @param payload - the raw request body.
 * @param header - the `stripe-signature` header.
 * @param secret - the endpoint's signing secret.
 * @param options - `nowMs` for the clock and `toleranceSec` for the replay window.
 * @returns true when the signature matches and is inside the tolerance.
 */
export function verifyStripeSignature(payload, header, secret, { nowMs = Date.now(), toleranceSec = 300 } = {}) {
  const parts = Object.fromEntries(String(header ?? '').split(',').map(p => p.split('=')))
  if (!parts.t || !parts.v1 || !secret) return false
  if (!Number.isFinite(Number(parts.t))) return false
  if (Math.abs(nowMs / 1000 - Number(parts.t)) > toleranceSec) return false
  return equalSecret(createHmac('sha256', secret).update(`${parts.t}.${payload}`).digest('hex'), parts.v1)
}

/**
 * The cloud-init script a new box boots with: the environment as exports, then the
 * bootstrap script written to disk and run.
 * @param env - environment for the box.
 * @param script - the contents of infra/desk-box/bootstrap.sh.
 * @returns the user-data script.
 */
export function buildUserData(env, script) {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(String(v ?? ''))}`).join('\n')
  return `#!/usr/bin/env bash\n${exports}\nmkdir -p /srv/desk\ncat > /srv/desk/bootstrap.sh <<"BOOTSTRAP_EOF"\n${script}\nBOOTSTRAP_EOF\nbash /srv/desk/bootstrap.sh\n`
}
