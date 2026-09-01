// The control plane's decision paths, run against a real (in-memory) Convex:
// webhook idempotency and matching, the one-time password, box authentication,
// heartbeats and the demo activity trail. Workflow/retrier component calls are
// exercised in the live E2E, not here.
import { describe, expect, it } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

/* oxlint-disable typescript/no-unsafe-assignment */
/* oxlint-disable typescript/no-unsafe-call */
// vite's import.meta.glob type resolves as `error` outside the repo TS programs; the assignment types it.
const modules: Record<string, () => Promise<unknown>> = import.meta.glob('../convex/**/*.ts')
const t = () => convexTest(schema, modules)

const makeOrder = async (tx: ReturnType<typeof t>, over: Record<string, unknown> = {}) => {
  await tx.mutation(internal.orders.create, {
    orderId: 'ord_test1', kind: 'paid', plan: 'business',
    business: 'Maple & Main', email: 'dana@example.com', slug: 'maple-main',
    ...over,
  } as never)
}

describe('the Stripe webhook is idempotent and honest', () => {
  it('a checkout completion pays the order once; a replay does nothing', async () => {
    const tx = t()
    await makeOrder(tx)
    const first = await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_1', type: 'checkout.session.completed',
      object: { client_reference_id: 'ord_test1', customer: 'cus_1', subscription: 'sub_1' },
    })
    expect(first.fulfil).toBe('ord_test1')
    const replay = await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_1', type: 'checkout.session.completed',
      object: { client_reference_id: 'ord_test1', customer: 'cus_1', subscription: 'sub_1' },
    })
    expect(replay.duplicate).toBe(true)
    const order = await tx.query(internal.orders.byOrderId, { orderId: 'ord_test1' })
    expect(order?.status).toBe('paid')
    expect(order?.stripeSubscription).toBe('sub_1')
  })

  it('an unmatched event is recorded, never silently dropped', async () => {
    const tx = t()
    const out = await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_x', type: 'invoice.payment_failed', object: { subscription: 'sub_nobody' },
    })
    expect(out).toEqual({})
    await tx.run(async (ctx) => {
      const events = await ctx.db.query('billingEvents').collect()
      expect(events).toHaveLength(1)
      expect(events[0].matched).toBe(false)
      const auditRows = await ctx.db.query('opsAudit').collect()
      expect(auditRows.some(a => a.action === 'billing-unmatched')).toBe(true)
    })
  })

  it('payment_failed marks past_due and asks for the box to be told; paid clears it', async () => {
    const tx = t()
    await makeOrder(tx)
    await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_1', type: 'checkout.session.completed',
      object: { client_reference_id: 'ord_test1', subscription: 'sub_1' },
    })
    const failed = await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_2', type: 'invoice.payment_failed', object: { subscription: 'sub_1' },
    })
    expect(failed.tellBox).toEqual({ orderId: 'ord_test1', state: 'past_due' })
    let order = await tx.query(internal.orders.byOrderId, { orderId: 'ord_test1' })
    expect(order?.billing).toBe('past_due')
    expect(order?.pastDueSince).toBeTruthy()

    const paid = await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_3', type: 'invoice.paid', object: { subscription: 'sub_1' },
    })
    expect(paid.tellBox).toEqual({ orderId: 'ord_test1', state: 'ok' })
    order = await tx.query(internal.orders.byOrderId, { orderId: 'ord_test1' })
    expect(order?.billing).toBe('ok')
    expect(order?.pastDueSince).toBeUndefined()
  })

  it('a demo paying through its convert link keeps its box and becomes paid in place', async () => {
    const tx = t()
    await makeOrder(tx, { kind: 'demo', demo: { prospect: 'Dana', expiresAt: '2026-09-09T00:00:00.000Z', extendedCount: 0 } })
    await tx.mutation(internal.orders.patch, { orderId: 'ord_test1', status: 'ready', host: 'maple-main.webfacedesk.app' })
    const out = await tx.mutation(internal.billing.applyEvent, {
      stripeEventId: 'evt_1', type: 'checkout.session.completed',
      object: { client_reference_id: 'ord_test1', customer: 'cus_1', subscription: 'sub_1' },
    })
    expect(out.fulfil).toBeUndefined() // no second provisioning
    const order = await tx.query(internal.orders.byOrderId, { orderId: 'ord_test1' })
    expect(order?.kind).toBe('paid')
    expect(order?.demo?.convertedAt).toBeTruthy()
    expect(order?.status).toBe('ready')
  })
})

describe('secrets', () => {
  it('minting is resume-safe: the second mint returns the first set', async () => {
    const tx = t()
    await makeOrder(tx)
    const a = await tx.mutation(internal.secrets.mint, { orderId: 'ord_test1', boxToken: 'tok_a', password: 'pw_a' })
    const b = await tx.mutation(internal.secrets.mint, { orderId: 'ord_test1', boxToken: 'tok_b', password: 'pw_b' })
    expect(a.boxToken).toBe('tok_a')
    expect(b.boxToken).toBe('tok_a')
  })

  it('the password shows exactly once', async () => {
    const tx = t()
    await makeOrder(tx)
    await tx.mutation(internal.secrets.mint, { orderId: 'ord_test1', boxToken: 'tok', password: 'pw_once' })
    expect(await tx.mutation(internal.secrets.revealPassword, { orderId: 'ord_test1' })).toBe('pw_once')
    expect(await tx.mutation(internal.secrets.revealPassword, { orderId: 'ord_test1' })).toBeNull()
    const order = await tx.query(internal.orders.byOrderId, { orderId: 'ord_test1' })
    expect(order?.passwordShown).toBe(true)
  })

  it('a box authenticates with its own token and nothing else', async () => {
    const tx = t()
    await makeOrder(tx)
    await tx.mutation(internal.secrets.mint, { orderId: 'ord_test1', boxToken: 'tok_real', password: 'pw' })
    expect(await tx.query(internal.secrets.authenticateBox, { slug: 'maple-main', token: 'tok_real' })).toBe('ord_test1')
    expect(await tx.query(internal.secrets.authenticateBox, { slug: 'maple-main', token: 'tok_fake' })).toBeNull()
    expect(await tx.query(internal.secrets.authenticateBox, { slug: 'other', token: 'tok_real' })).toBeNull()
  })

  it('a static box authenticates as static_<slug> and its order appears on first heartbeat', async () => {
    const tx = t()
    await tx.mutation(internal.secrets.upsertStaticBox, { slug: 'demo', token: 'tok_static', dropletId: 42 })
    expect(await tx.query(internal.secrets.authenticateBox, { slug: 'demo', token: 'tok_static' })).toBe('static_demo')
    await tx.mutation(internal.secrets.ensureStaticOrder, { slug: 'demo' })
    const order = await tx.query(internal.orders.byOrderId, { orderId: 'static_demo' })
    expect(order?.kind).toBe('internal')
    expect(order?.dropletId).toBe(42)
  })
})

describe('heartbeats', () => {
  it('keeps only the latest beat, and a demo box grows a daily activity trail', async () => {
    const tx = t()
    await makeOrder(tx, { kind: 'demo', demo: { prospect: 'Dana', expiresAt: '2026-09-09T00:00:00.000Z', extendedCount: 0 } })
    const beat = (sessions: number) => ({
      ready: true, harness: true, google: { accounts: ['a@b.c'] }, push: { devices: 2 },
      usage: { monthTokens: 1000, totalTokens: 5000, sessions, turns: sessions * 3 },
    })
    await tx.mutation(internal.boxes.heartbeat, { orderId: 'ord_test1', body: beat(1) })
    await tx.mutation(internal.boxes.heartbeat, { orderId: 'ord_test1', body: beat(2) })
    await tx.run(async (ctx) => {
      const beats = await ctx.db.query('heartbeats').collect()
      expect(beats).toHaveLength(1)
      expect(beats[0].usage?.sessions).toBe(2)
      const daily = await ctx.db.query('usageDaily').collect()
      expect(daily).toHaveLength(1)
      expect(daily[0].sessions).toBe(2)
    })
  })

  it('a garbage body becomes a false-y beat, not a crash', async () => {
    const tx = t()
    await makeOrder(tx)
    await tx.mutation(internal.boxes.heartbeat, { orderId: 'ord_test1', body: 'not an object' })
    await tx.run(async (ctx) => {
      const beats = await ctx.db.query('heartbeats').collect()
      expect(beats[0].ready).toBe(false)
    })
  })
})

describe('demo bookkeeping', () => {
  it('extending moves the clock forward and clears the warning', async () => {
    const tx = t()
    const past = new Date(Date.now() + 3_600_000).toISOString()
    await makeOrder(tx, { kind: 'demo', demo: { prospect: 'Dana', expiresAt: past, warnedAt: '2026-09-01T00:00:00.000Z', extendedCount: 0 } })
    await tx.run(async (ctx) => {
      const order = (await ctx.db.query('orders').collect())[0]
      await ctx.db.patch(order._id, { demo: { ...order.demo!, warnedAt: '2026-09-01T00:00:00.000Z' } })
    })
    await tx.mutation(internal.demos.markWarned, { orderId: 'ord_test1' })
    const order = await tx.query(internal.orders.byOrderId, { orderId: 'ord_test1' })
    expect(order?.demo?.warnedAt).toBeTruthy()
  })
})
