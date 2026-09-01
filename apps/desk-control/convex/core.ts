// The control plane's decision logic, ported from apps/deskapi/src/core.js with
// its semantics intact — that file's tests are the spec of record here. The one
// change is mechanical: the Convex runtime has Web Crypto, not node:crypto, so
// hashing and HMAC go through crypto.subtle and are async.

/** Statuses a provisioning run passes through; an order sitting in one was interrupted. */
export const IN_FLIGHT = ['paid', 'creating', 'installing'] as const

/** Strip anything that would break a shell line or a heredoc out of an owner-supplied name. */
export const cleanName = (v: unknown): string =>
  String(v ?? '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 80)

/** A url-safe slug for hostnames. */
export const slugify = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/**
 * The billing state a Stripe event puts a Desk into.
 * @returns 'ok' | 'past_due' | 'cancelled', or null when the event does not change state.
 */
export function billingStateFor(type: string): 'ok' | 'past_due' | 'cancelled' | null {
  if (type === 'invoice.paid') return 'ok'
  if (type === 'invoice.payment_failed') return 'past_due'
  if (type === 'customer.subscription.deleted') return 'cancelled'
  return null
}

const encoder = new TextEncoder()

/** Hex of a byte buffer. */
const hex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')

/** sha256 hex — how box tokens are stored (`boxSecrets.boxTokenHash`). */
export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(s)))
}

/** hmac-sha256 hex. */
export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

/**
 * Constant-time secret comparison that does not leak length through a throw.
 * @returns true when both are non-empty and identical.
 */
export function equalSecret(a: unknown, b: unknown): boolean {
  const x = String(a ?? ''), y = String(b ?? '')
  if (!x || !y || x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i)
  return diff === 0
}

/** A presented bearer token against a stored sha256 hash. */
export async function tokenMatchesHash(presented: string, storedHash: string): Promise<boolean> {
  if (!presented || !storedHash) return false
  return equalSecret(await sha256Hex(presented), storedHash)
}

/**
 * Verify a Stripe webhook signature header.
 * @param payload - the raw request body.
 * @param header - the `stripe-signature` header.
 * @param secret - the endpoint's signing secret.
 * @param options - `nowMs` for the clock and `toleranceSec` for the replay window.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  { nowMs = Date.now(), toleranceSec = 300 }: { nowMs?: number; toleranceSec?: number } = {},
): Promise<boolean> {
  const parts = Object.fromEntries(String(header ?? '').split(',').map(p => p.split('=') as [string, string]))
  if (!parts.t || !parts.v1 || !secret) return false
  if (!Number.isFinite(Number(parts.t))) return false
  if (Math.abs(nowMs / 1000 - Number(parts.t)) > toleranceSec) return false
  return equalSecret(await hmacHex(secret, `${parts.t}.${payload}`), parts.v1)
}

/**
 * The cloud-init script a new box boots with: the environment as exports, then
 * the bootstrap script written to disk and run. `script` is the contents of
 * infra/desk-box/bootstrap.sh, stored in the deployment's env at deploy time.
 */
export function buildUserData(env: Record<string, unknown>, script: string): string {
  const exports = Object.entries(env).map(([k, v]) => `export ${k}=${JSON.stringify(String(v ?? ''))}`).join('\n')
  return `#!/usr/bin/env bash\n${exports}\nmkdir -p /srv/desk\ncat > /srv/desk/bootstrap.sh <<"BOOTSTRAP_EOF"\n${script}\nBOOTSTRAP_EOF\nbash /srv/desk/bootstrap.sh\n`
}

/** A fresh random id: `prefix_<2n hex>`. */
export function randomId(prefix: string, bytes = 8): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return `${prefix}_${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`
}

/** A url-safe random secret of ~4/3·bytes characters. */
export function randomSecret(bytes = 16): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const nowIso = (): string => new Date().toISOString()
