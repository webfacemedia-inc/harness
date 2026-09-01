// What the console can do to the fleet. Every action starts a workflow or a
// retried push — nothing here is fire-and-forget, and everything is audited.
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation } from './_generated/server'
import { internal } from './_generated/api'
import { workflow, retrier, requireOperator, audit, stripeApi, doApi, env } from './lib'
import { cleanName, nowIso, randomId, slugify } from './core'

/** Create a Desk from the console — a paying customer set up by hand, or an internal box. */
export const createBox = mutation({
  args: {
    business: v.string(),
    email: v.string(),
    plan: v.union(v.literal('business'), v.literal('operators')),
    kind: v.union(v.literal('paid'), v.literal('internal')),
    slug: v.optional(v.string()),
    webfaceClient: v.optional(v.string()),
    sandbox: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await requireOperator(ctx)
    const business = cleanName(args.business)
    const slug = slugify(args.slug ?? business)
    if (!slug) throw new Error('the business name makes an empty slug — give one explicitly')
    const existing = await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    if (existing && existing.status !== 'destroyed') throw new Error(`${slug} is already in use by ${existing.orderId}`)
    const orderId = randomId('ord')
    await ctx.runMutation(internal.orders.create, {
      orderId, kind: args.kind, plan: args.plan, business, email: args.email, slug,
      source: 'console', webfaceClient: args.webfaceClient, sandbox: args.sandbox,
    })
    await ctx.runMutation(internal.orders.patch, { orderId, status: 'paid' })
    await audit(ctx, 'ops', 'box-created', orderId, `${email}: ${business} (${args.kind})`)
    await workflow.start(ctx, internal.provision.provisionBox, { orderId })
    return { orderId, slug, welcome: `${process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'}/welcome?order=${orderId}` }
  },
})

export const boxAction = mutation({
  args: {
    orderId: v.string(),
    op: v.union(v.literal('pause'), v.literal('resume'), v.literal('destroy'), v.literal('resend'), v.literal('snapshot'), v.literal('retry-provision')),
  },
  handler: async (ctx, { orderId, op }) => {
    const email = await requireOperator(ctx)
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order) throw new Error(`no order ${orderId}`)
    await audit(ctx, 'ops', `box-${op}`, orderId, email)
    switch (op) {
      case 'pause':
        await ctx.db.patch(order._id, { billing: 'past_due', billingAt: nowIso(), updatedAt: nowIso() })
        await ctx.runMutation(internal.billing.scheduleTellBox, { orderId, state: 'past_due' })
        break
      case 'resume':
        await ctx.db.patch(order._id, { billing: 'ok', billingAt: nowIso(), pastDueSince: undefined, updatedAt: nowIso() })
        await ctx.runMutation(internal.billing.scheduleTellBox, { orderId, state: 'ok' })
        break
      case 'destroy':
        await workflow.start(ctx, internal.provision.destroyBox, { orderId })
        break
      case 'resend':
        await retrier.run(ctx, internal.provision.welcomeEmail, { orderId })
        break
      case 'snapshot':
        await retrier.run(ctx, internal.ops.snapshotOne, { orderId })
        break
      case 'retry-provision':
        if (!['failed', 'paid', 'creating', 'installing'].includes(order.status)) throw new Error(`${orderId} is ${order.status}; nothing to retry`)
        await workflow.start(ctx, internal.provision.provisionBox, { orderId })
        break
    }
  },
})

/** Restart a box's Desk services from the console — the no-SSH lever. */
export const restartBox = mutation({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const email = await requireOperator(ctx)
    await audit(ctx, 'ops', 'box-restart', orderId, email)
    await retrier.run(ctx, internal.push.pushConfigAction, { orderId, restart: true }, { initialBackoffMs: 5000, base: 3, maxFailures: 3 })
  },
})

/** One nightly-style snapshot, on demand. */
export const snapshotOne = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    if (!order?.dropletId) throw new Error(`${orderId} has no droplet`)
    const name = `desk-${order.slug}-${nowIso().slice(0, 10)}`
    await doApi('POST', `/droplets/${order.dropletId}/actions`, { type: 'snapshot', name })
    await ctx.runMutation(internal.ops.recordSnapshot, { orderId, name, kind: 'nightly' })
  },
})

export const recordSnapshot = internalMutation({
  args: { orderId: v.string(), name: v.string(), kind: v.union(v.literal('nightly'), v.literal('final')), doSnapshotId: v.optional(v.number()) },
  handler: async (ctx, { orderId, name, kind, doSnapshotId }) => {
    await ctx.db.insert('snapshots', { orderId, name, kind, doSnapshotId, at: nowIso() })
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (order) await ctx.db.patch(order._id, { lastSnapshot: nowIso(), updatedAt: nowIso() })
  },
})

/**
 * A Stripe Checkout for an existing order — the storefront path and the
 * demo-conversion path both land here; the webhook matches on orderId.
 */
export const checkoutForOrder = internalAction({
  args: { orderId: v.string(), plan: v.string() },
  handler: async (ctx, { orderId, plan }): Promise<string> => {
    const setup = env(plan === 'operators' ? 'STRIPE_PRICE_OPERATORS_SETUP' : 'STRIPE_PRICE_BUSINESS_SETUP')
    const monthly = env(plan === 'operators' ? 'STRIPE_PRICE_OPERATORS_MONTHLY' : 'STRIPE_PRICE_BUSINESS_MONTHLY')
    const base = process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'
    const session = await stripeApi('checkout/sessions', {
      mode: 'subscription',
      client_reference_id: orderId,
      'line_items[0][price]': setup, 'line_items[0][quantity]': '1',
      'line_items[1][price]': monthly, 'line_items[1][quantity]': '1',
      success_url: `${base}/welcome?order=${orderId}`,
      cancel_url: `${base}/checkout`,
      'metadata[order]': orderId,
    })
    await ctx.runMutation(internal.orders.patch, { orderId, stripeSession: String(session.id) })
    await ctx.runMutation(internal.orders.log, { actor: 'system', action: 'checkout-session', orderId })
    return session.url as string
  },
})

/** The nightly pass: billing sweep, then snapshots for every live box. */
export const nightly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const orders = await ctx.db.query('orders').collect()
    for (const order of orders) {
      // 14 days past due → the Desk stops; the box is told.
      if (order.billing === 'past_due' && order.pastDueSince && now - Date.parse(order.pastDueSince) > 14 * 86_400_000 && order.status === 'ready') {
        await ctx.db.patch(order._id, { billing: 'cancelled', billingAt: nowIso(), updatedAt: nowIso() })
        await audit(ctx, 'system', 'stopped-after-14d', order.orderId)
        await ctx.runMutation(internal.billing.scheduleTellBox, { orderId: order.orderId, state: 'cancelled' })
      }
      // Destroyed 90 days → the final snapshot goes too.
      if (order.status === 'destroyed' && order.finalSnapshot && order.destroyedAt && now - Date.parse(order.destroyedAt) > 90 * 86_400_000) {
        await retrier.run(ctx, internal.ops.deleteSnapshot, { snapshotId: order.finalSnapshot, orderId: order.orderId })
        await ctx.db.patch(order._id, { finalSnapshot: undefined, updatedAt: nowIso() })
      }
      // Nightly snapshot for every running box that is still paying.
      if (order.status === 'ready' && order.billing !== 'cancelled' && order.dropletId) {
        await retrier.run(ctx, internal.ops.snapshotOne, { orderId: order.orderId })
      }
    }
    await ctx.runMutation(internal.demos.sweepDemos, {})
  },
})

export const deleteSnapshot = internalAction({
  args: { snapshotId: v.number(), orderId: v.string() },
  handler: async (ctx, { snapshotId, orderId }) => {
    await doApi('DELETE', `/snapshots/${snapshotId}`)
    await ctx.runMutation(internal.orders.log, { actor: 'system', action: 'final-snapshot-pruned', orderId })
  },
})

/** Fulfilment entry for the webhook: start the provisioning workflow. */
export const fulfil = internalMutation({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    await workflow.start(ctx, internal.provision.provisionBox, { orderId })
  },
})

/** The ops-key API's create — the HTTP action has already authenticated the key. */
export const opsCreateBox = internalMutation({
  args: {
    business: v.string(), email: v.string(), plan: v.string(),
    slug: v.optional(v.string()), webfaceClient: v.optional(v.string()), sandbox: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const business = cleanName(args.business)
    let slug = slugify(args.slug ?? business)
    if (!slug) throw new Error('empty slug')
    const existing = await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    if (existing && existing.status !== 'destroyed') slug = `${slug}-${randomId('x', 2).slice(2)}`
    const orderId = randomId('ord')
    await ctx.runMutation(internal.orders.create, {
      orderId, kind: 'paid', plan: args.plan === 'operators' ? 'operators' : 'business',
      business, email: args.email, slug, source: 'operator',
      webfaceClient: args.webfaceClient, sandbox: args.sandbox,
    })
    await ctx.runMutation(internal.orders.patch, { orderId, status: 'paid' })
    await audit(ctx, 'ops', 'box-created', orderId, `ops-key: ${business}`)
    await workflow.start(ctx, internal.provision.provisionBox, { orderId })
    return { id: orderId, slug, welcome: `${process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'}/welcome?order=${orderId}` }
  },
})

export const opsBoxAction = internalMutation({
  args: { orderId: v.string(), op: v.string() },
  handler: async (ctx, { orderId, op }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order) throw new Error(`no order ${orderId}`)
    await audit(ctx, 'ops', `box-${op}`, orderId, 'ops-key')
    if (op === 'pause') {
      await ctx.db.patch(order._id, { billing: 'past_due', billingAt: nowIso(), updatedAt: nowIso() })
      await ctx.runMutation(internal.billing.scheduleTellBox, { orderId, state: 'past_due' })
    } else if (op === 'resume') {
      await ctx.db.patch(order._id, { billing: 'ok', billingAt: nowIso(), pastDueSince: undefined, updatedAt: nowIso() })
      await ctx.runMutation(internal.billing.scheduleTellBox, { orderId, state: 'ok' })
    } else if (op === 'destroy') {
      await workflow.start(ctx, internal.provision.destroyBox, { orderId })
    } else if (op === 'resend') {
      await retrier.run(ctx, internal.provision.welcomeEmail, { orderId })
    } else throw new Error(`op? ${op}`)
  },
})

/** The storefront's own order creation, from /api/checkout. */
export const storefrontOrder = internalMutation({
  args: { plan: v.string(), business: v.string(), email: v.string(), slug: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const business = cleanName(args.business)
    let slug = slugify(args.slug || business)
    const existing = slug ? await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique() : null
    if (!slug || (existing && existing.status !== 'failed' && existing.status !== 'destroyed')) slug = `${slug || 'desk'}-${randomId('x', 2).slice(2)}`
    const orderId = randomId('ord')
    await ctx.runMutation(internal.orders.create, { orderId, kind: 'paid', plan: args.plan, business, email: args.email, slug })
    return { orderId, slug }
  },
})

export const healthCounts = internalQuery({
  args: {},
  handler: async ctx => ({ orders: (await ctx.db.query('orders').collect()).length }),
})
