// Ported from apps/deskapi/tests/core.spec.ts — the same cases must hold for the
// Convex implementations, or the migration changed behaviour it promised to keep.
import { describe, expect, it } from 'vitest'
import {
  billingStateFor, buildUserData, cleanName, equalSecret, hmacHex,
  randomId, randomSecret, sha256Hex, slugify, tokenMatchesHash, verifyStripeSignature,
} from '../convex/core'

describe('billingStateFor', () => {
  it('maps the three Stripe events and nothing else', () => {
    expect(billingStateFor('invoice.paid')).toBe('ok')
    expect(billingStateFor('invoice.payment_failed')).toBe('past_due')
    expect(billingStateFor('customer.subscription.deleted')).toBe('cancelled')
    expect(billingStateFor('checkout.session.completed')).toBeNull()
    expect(billingStateFor('')).toBeNull()
  })
})

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret'
  const payload = '{"id":"evt_1","type":"invoice.paid"}'
  const sign = async (body: string, at: number) => `t=${at},v1=${await hmacHex(secret, `${at}.${body}`)}`

  it('accepts a fresh, correctly signed payload', async () => {
    const t = Math.floor(Date.now() / 1000)
    expect(await verifyStripeSignature(payload, await sign(payload, t), secret)).toBe(true)
  })
  it('rejects the wrong secret', async () => {
    const t = Math.floor(Date.now() / 1000)
    const header = `t=${t},v1=${await hmacHex('whsec_other', `${t}.${payload}`)}`
    expect(await verifyStripeSignature(payload, header, secret)).toBe(false)
  })
  it('rejects a stale timestamp — the replay window is 300s', async () => {
    const t = Math.floor(Date.now() / 1000) - 301
    expect(await verifyStripeSignature(payload, await sign(payload, t), secret)).toBe(false)
  })
  it('rejects an altered body', async () => {
    const t = Math.floor(Date.now() / 1000)
    expect(await verifyStripeSignature(payload.replace('paid', 'void'), await sign(payload, t), secret)).toBe(false)
  })
  it('rejects malformed headers without throwing', async () => {
    for (const h of [null, undefined, '', 't=,v1=', 'v1=abc', 't=abc,v1=def', 't=999']) {
      expect(await verifyStripeSignature(payload, h, secret)).toBe(false)
    }
  })
  it('rejects when the secret is missing', async () => {
    const t = Math.floor(Date.now() / 1000)
    expect(await verifyStripeSignature(payload, await sign(payload, t), '')).toBe(false)
  })
})

describe('secrets', () => {
  it('equalSecret is exact and never throws on odd input', () => {
    expect(equalSecret('abc', 'abc')).toBe(true)
    expect(equalSecret('abc', 'abd')).toBe(false)
    expect(equalSecret('abc', 'abcd')).toBe(false)
    expect(equalSecret('', '')).toBe(false)
    expect(equalSecret(null, null)).toBe(false)
  })
  it('a token matches only its own hash', async () => {
    const token = randomSecret()
    const hash = await sha256Hex(token)
    expect(await tokenMatchesHash(token, hash)).toBe(true)
    expect(await tokenMatchesHash(token + 'x', hash)).toBe(false)
    expect(await tokenMatchesHash('', hash)).toBe(false)
    expect(await tokenMatchesHash(token, '')).toBe(false)
  })
  it('random ids and secrets have the promised shape', () => {
    expect(randomId('ord')).toMatch(/^ord_[0-9a-f]{16}$/)
    expect(randomSecret().length).toBeGreaterThanOrEqual(20)
    expect(randomSecret()).not.toBe(randomSecret())
  })
})

describe('names', () => {
  it('cleanName strips control characters and bounds length', () => {
    expect(cleanName(' Maple & Main\n Plumbing ')).toBe('Maple & Main Plumbing')
    expect(cleanName('a'.repeat(100))).toHaveLength(80)
    expect(cleanName(undefined)).toBe('')
  })
  it('slugify makes a hostname label', () => {
    expect(slugify('Maple & Main Plumbing!')).toBe('maple-main-plumbing')
    expect(slugify('--x--')).toBe('x')
  })
})

describe('buildUserData', () => {
  it('quotes every value so a business name cannot break the script', () => {
    const out = buildUserData({ DESK_BUSINESS: 'O\'Brien & Sons "Ltd" $HOME', DESK_SLUG: 'obrien' }, 'echo hi')
    expect(out).toContain('export DESK_BUSINESS="O\'Brien & Sons \\"Ltd\\" $HOME"')
    expect(out).toContain('export DESK_SLUG="obrien"')
  })
  it('carries the bootstrap script in a heredoc and runs it', () => {
    const out = buildUserData({}, '#!/bin/bash\necho boot')
    expect(out).toContain('<<"BOOTSTRAP_EOF"')
    expect(out).toContain('echo boot')
    expect(out.trimEnd().endsWith('bash /srv/desk/bootstrap.sh')).toBe(true)
  })
  it('stringifies null and undefined to empty exports', () => {
    expect(buildUserData({ A: null, B: undefined }, 'x')).toContain('export A=""')
  })
})
