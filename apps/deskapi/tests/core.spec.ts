// deskapi is a plain-JS Node service: it ships as source to the storefront box with no build step, so it sits
// outside both TypeScript programs and its sources are unlinted like every other **/*.js here. These tests are
// .ts only because the vitest include glob is *.spec.ts, which leaves every value crossing the import boundary
// untyped — the rules disabled below report that boundary, never a defect. Every other rule still applies.
/* oxlint-disable typescript/no-unsafe-call */
/* oxlint-disable typescript/no-unsafe-member-access */
/* oxlint-disable typescript/no-unsafe-return */
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { billingStateFor, buildUserData, cleanName, equalSecret, resumableOrders, verifyStripeSignature } from '../src/core.js'

describe('billingStateFor', () => {
  it('maps the three events the store acts on', () => {
    expect(billingStateFor('invoice.paid')).toBe('ok')
    expect(billingStateFor('invoice.payment_failed')).toBe('past_due')
    expect(billingStateFor('customer.subscription.deleted')).toBe('cancelled')
  })
  it('leaves every other event alone rather than guessing a state', () => {
    for (const t of ['checkout.session.completed', 'invoice.created', '']) expect(billingStateFor(t)).toBeNull()
  })
})

describe('resumableOrders', () => {
  const order = (over: Record<string, unknown>) => ({ id: 'ord_1', slug: 's', status: 'paid', createdAt: '2026-08-01', ...over })
  it('picks up every order a restart left mid-provision, oldest first', () => {
    const orders = {
      a: order({ id: 'a', status: 'installing', createdAt: '2026-08-03' }),
      b: order({ id: 'b', status: 'paid', createdAt: '2026-08-01' }),
      c: order({ id: 'c', status: 'creating', createdAt: '2026-08-02' }),
    }
    expect(resumableOrders(orders).map(o => o.id)).toEqual(['b', 'c', 'a'])
  })
  it('leaves finished, failed and static boxes alone', () => {
    const orders = {
      ready: order({ id: 'ready', status: 'ready' }),
      failed: order({ id: 'failed', status: 'failed' }),
      gone: order({ id: 'gone', status: 'destroyed' }),
      demo: order({ id: 'demo', status: 'creating', static: true }),
    }
    expect(resumableOrders(orders)).toEqual([])
  })
  it('stops retrying a box that has already been attempted too often', () => {
    expect(resumableOrders({ a: order({ attempts: 2 }) }, 3).length).toBe(1)
    expect(resumableOrders({ a: order({ attempts: 3 }) }, 3).length).toBe(0)
  })
  it('survives an empty or missing order map', () => {
    expect(resumableOrders(undefined)).toEqual([])
    expect(resumableOrders({})).toEqual([])
  })
})

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test'
  const payload = '{"id":"evt_1"}'
  const sign = (t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`
  const now = 1_800_000_000_000
  it('accepts a signature made with the endpoint secret', () => {
    expect(verifyStripeSignature(payload, sign(now / 1000), secret, { nowMs: now })).toBe(true)
  })
  it('rejects another secret, a replay outside the window, and a malformed header', () => {
    expect(verifyStripeSignature(payload, sign(now / 1000), 'whsec_other', { nowMs: now })).toBe(false)
    expect(verifyStripeSignature(payload, sign(now / 1000 - 400), secret, { nowMs: now })).toBe(false)
    for (const h of ['', 'nonsense', 't=abc,v1=def']) expect(verifyStripeSignature(payload, h, secret, { nowMs: now })).toBe(false)
  })
  it('rejects a body that was altered after signing', () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(now / 1000), secret, { nowMs: now })).toBe(false)
  })
})

describe('equalSecret', () => {
  it('is true only for identical non-empty secrets', () => {
    expect(equalSecret('abc', 'abc')).toBe(true)
    expect(equalSecret('abc', 'abd')).toBe(false)
    expect(equalSecret('abc', 'abcd')).toBe(false)
    expect(equalSecret('', '')).toBe(false)
    expect(equalSecret(undefined, 'abc')).toBe(false)
  })
})

describe('cleanName', () => {
  it('keeps a name a shell line can carry', () => {
    expect(cleanName('  Maple & Main Home Services  ')).toBe('Maple & Main Home Services')
    expect(cleanName('x'.repeat(200)).length).toBe(80)
    expect(cleanName(undefined)).toBe('')
  })
})

describe('buildUserData', () => {
  const script = '#!/usr/bin/env bash\necho hello\n'
  const out = buildUserData({ DESK_SLUG: 'maple', DESK_BUSINESS: 'Maple & Main', EMPTY: undefined }, script)
  it('quotes every value, so a business name with spaces cannot split the line', () => {
    expect(out).toContain('export DESK_BUSINESS="Maple & Main"')
    expect(out).toContain('export DESK_SLUG="maple"')
    expect(out).toContain('export EMPTY=""')
  })
  it('writes the bootstrap script through a quoted heredoc and runs it', () => {
    expect(out).toContain('cat > /srv/desk/bootstrap.sh <<"BOOTSTRAP_EOF"')
    expect(out).toContain(script)
    expect(out.trimEnd().endsWith('bash /srv/desk/bootstrap.sh')).toBe(true)
  })
})
