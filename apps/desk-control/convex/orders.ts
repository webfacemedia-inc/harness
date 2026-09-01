// Orders: the fleet's source of truth. Public queries are operator-gated;
// everything that changes state is internal, reached through workflows,
// webhook handlers, or the ops mutations that start them.
import { v } from 'convex/values'
import { internalMutation, internalQuery, query } from './_generated/server'
import { billingState, orderKind, orderStatus } from './schema'
import { audit, requireOperator } from './lib'
import { nowIso } from './core'

/** The console's fleet view: orders joined with their latest heartbeat. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx)
    const orders = await ctx.db.query('orders').collect()
    return await Promise.all(orders.map(async o => ({
      ...o,
      heartbeat: await ctx.db.query('heartbeats').withIndex('by_orderId', q => q.eq('orderId', o.orderId)).unique(),
    })))
  },
})

export const get = query({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    await requireOperator(ctx)
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order) return null
    return {
      ...order,
      heartbeat: await ctx.db.query('heartbeats').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique(),
      snapshots: await ctx.db.query('snapshots').withIndex('by_orderId', q => q.eq('orderId', orderId)).collect(),
      usageDaily: await ctx.db.query('usageDaily').withIndex('by_orderId_day', q => q.eq('orderId', orderId)).collect(),
    }
  },
})

export const auditFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireOperator(ctx)
    return await ctx.db.query('opsAudit').withIndex('by_at').order('desc').take(Math.min(limit ?? 100, 500))
  },
})

export const isOperator = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const allowed = (process.env.OPERATOR_EMAILS ?? '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.includes(email)) return true
    return Boolean(await ctx.db.query('operators').withIndex('by_email', q => q.eq('email', email)).unique())
  },
})

/** The ops-key API's list: what an operator Desk needs, nothing secret. */
export const opsList = internalQuery({
  args: {},
  handler: async (ctx) => {
    const orders = await ctx.db.query('orders').collect()
    return orders.map(o => ({
      id: o.orderId, slug: o.slug, business: o.business, plan: o.plan, kind: o.kind,
      status: o.status, host: o.host ?? null, billing: o.billing ?? 'ok',
      webfaceClient: o.webfaceClient ?? null, createdAt: o.createdAt,
    }))
  },
})

export const byOrderId = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) =>
    await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique(),
})

export const bySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) =>
    await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique(),
})

export const bySubscription = internalQuery({
  args: { subscription: v.string() },
  handler: async (ctx, { subscription }) =>
    await ctx.db.query('orders').withIndex('by_stripeSubscription', q => q.eq('stripeSubscription', subscription)).unique(),
})

export const create = internalMutation({
  args: {
    orderId: v.string(),
    kind: orderKind,
    plan: v.string(),
    business: v.string(),
    email: v.string(),
    slug: v.string(),
    size: v.optional(v.string()),
    source: v.optional(v.string()),
    webfaceClient: v.optional(v.string()),
    sandbox: v.optional(v.boolean()),
    stripeSession: v.optional(v.string()),
    demo: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const at = nowIso()
    await ctx.db.insert('orders', { ...args, status: 'created', createdAt: at, updatedAt: at })
    await audit(ctx, 'system', 'order-created', args.orderId, `${args.kind} · ${args.business}`)
  },
})

/**
 * The one write path for order state. Patches by public orderId so workflows
 * and webhook handlers never hold document ids across steps.
 */
export const patch = internalMutation({
  args: {
    orderId: v.string(),
    status: v.optional(orderStatus),
    detail: v.optional(v.string()),
    ip: v.optional(v.string()),
    host: v.optional(v.string()),
    dropletId: v.optional(v.number()),
    dns: v.optional(v.boolean()),
    stripeSession: v.optional(v.string()),
    stripeCustomer: v.optional(v.string()),
    stripeSubscription: v.optional(v.string()),
    paidAt: v.optional(v.string()),
    readyAt: v.optional(v.string()),
    destroyedAt: v.optional(v.string()),
    // Workflow handlers are deterministic and must not read the clock; these
    // stamp inside the transaction instead.
    readyNow: v.optional(v.boolean()),
    destroyedNow: v.optional(v.boolean()),
    billing: v.optional(billingState),
    billingAt: v.optional(v.string()),
    pastDueSince: v.optional(v.string()),
    clearPastDueSince: v.optional(v.boolean()),
    usageAlerted: v.optional(v.string()),
    lastSnapshot: v.optional(v.string()),
    finalSnapshot: v.optional(v.number()),
    workflowId: v.optional(v.string()),
    lastError: v.optional(v.object({ step: v.string(), message: v.string(), at: v.string() })),
    clearLastError: v.optional(v.boolean()),
    attempts: v.optional(v.number()),
    passwordShown: v.optional(v.boolean()),
    kind: v.optional(orderKind),
    demo: v.optional(v.any()),
  },
  handler: async (ctx, { orderId, clearLastError, clearPastDueSince, readyNow, destroyedNow, ...patch }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order) throw new Error(`no order ${orderId}`)
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined))
    await ctx.db.patch(order._id, {
      ...clean,
      ...(readyNow ? { readyAt: nowIso() } : {}),
      ...(destroyedNow ? { destroyedAt: nowIso() } : {}),
      ...(clearLastError ? { lastError: undefined } : {}),
      ...(clearPastDueSince ? { pastDueSince: undefined } : {}),
      updatedAt: nowIso(),
    })
  },
})

/** Record a failure on the order instead of dropping it — the deskapi `note()` lesson. */
export const noteError = internalMutation({
  args: { orderId: v.string(), step: v.string(), message: v.string() },
  handler: async (ctx, { orderId, step, message }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (order) await ctx.db.patch(order._id, { lastError: { step, message, at: nowIso() }, updatedAt: nowIso() })
    await audit(ctx, 'system', `error:${step}`, orderId, message.slice(0, 500))
  },
})

export const log = internalMutation({
  args: {
    actor: v.union(v.literal('stripe'), v.literal('ops'), v.literal('system'), v.literal('box')),
    action: v.string(),
    orderId: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { actor, action, orderId, detail }) => {
    await audit(ctx, actor, action, orderId, detail)
  },
})
