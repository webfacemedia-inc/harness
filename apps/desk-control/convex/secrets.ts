// The material a leak would hurt: box tokens and the owner's first password.
// Everything here is internal. The token is raw on purpose: the control plane
// presents it to the box (billing, config, seeding, recording), so it must be
// recoverable — but it never appears in an order row or a public query.
import { v } from 'convex/values'
import { internalMutation, internalQuery } from './_generated/server'
import { equalSecret, nowIso } from './core'

/**
 * Create (or on resume, return) the box's secrets. A resumed provisioning run
 * must reuse what the box already booted with, never mint a second set.
 */
export const mint = internalMutation({
  args: { orderId: v.string(), boxToken: v.string(), password: v.string() },
  handler: async (ctx, { orderId, boxToken, password }) => {
    const existing = await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (existing) return { boxToken: existing.boxToken, password: existing.password ?? password }
    await ctx.db.insert('boxSecrets', { orderId, boxToken, password })
    return { boxToken, password }
  },
})

export const forOrder = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) =>
    await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique(),
})

/**
 * The welcome page's one look at the password. Marks it shown; a second call
 * returns null. The caller clears it entirely after a grace period.
 */
export const revealPassword = internalMutation({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const row = await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!row || !row.password || row.passwordShownAt) return null
    await ctx.db.patch(row._id, { passwordShownAt: nowIso() })
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (order) await ctx.db.patch(order._id, { passwordShown: true, updatedAt: nowIso() })
    return row.password
  },
})

/** Once shown (or on destroy), the password has no business persisting. */
export const clearPassword = internalMutation({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const row = await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (row) await ctx.db.patch(row._id, { password: undefined })
  },
})

/**
 * Authenticate a box's bearer token for a slug: order boxes first, then the
 * static boxes we run ourselves. Returns the orderId it authenticates as
 * (static boxes authenticate as `static_<slug>`), or null.
 */
export const authenticateBox = internalQuery({
  args: { slug: v.string(), token: v.string() },
  handler: async (ctx, { slug, token }) => {
    const order = await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    if (order) {
      const secret = await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', order.orderId)).unique()
      if (secret && equalSecret(token, secret.boxToken)) return order.orderId
    }
    const fixed = await ctx.db.query('staticBoxes').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    if (fixed && equalSecret(token, fixed.boxToken)) return `static_${slug}`
    return null
  },
})

/** A static box's first heartbeat creates its order row (deskapi's lazy static_<slug>). */
export const ensureStaticOrder = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const orderId = `static_${slug}`
    const existing = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (existing) return
    const fixed = await ctx.db.query('staticBoxes').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    const at = nowIso()
    await ctx.db.insert('orders', {
      orderId, kind: 'internal', plan: 'internal', business: slug, email: '', slug,
      status: 'ready', createdAt: at, updatedAt: at,
      host: `${slug}.${process.env.DESK_DOMAIN ?? 'webfacedesk.app'}`,
      ...(fixed?.dropletId ? { dropletId: fixed.dropletId } : {}),
      ...(fixed?.webfaceClient ? { webfaceClient: fixed.webfaceClient } : {}),
    })
  },
})

export const upsertStaticBox = internalMutation({
  args: { slug: v.string(), token: v.string(), dropletId: v.optional(v.number()), webfaceClient: v.optional(v.string()) },
  handler: async (ctx, { slug, token, dropletId, webfaceClient }) => {
    const existing = await ctx.db.query('staticBoxes').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    if (existing) await ctx.db.patch(existing._id, { boxToken: token, dropletId, webfaceClient })
    else await ctx.db.insert('staticBoxes', { slug, boxToken: token, dropletId, webfaceClient })
  },
})

/** The raw token for calling a box — order boxes and static boxes alike. */
export const boxTokenFor = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const secret = await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (secret) return secret.boxToken
    if (orderId.startsWith('static_')) {
      const fixed = await ctx.db.query('staticBoxes').withIndex('by_slug', q => q.eq('slug', orderId.slice(7))).unique()
      return fixed?.boxToken ?? null
    }
    return null
  },
})

/** The raw token for a slug — the Google relay signs its state with it. */
export const boxTokenBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const order = await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    if (order) {
      const secret = await ctx.db.query('boxSecrets').withIndex('by_orderId', q => q.eq('orderId', order.orderId)).unique()
      if (secret) return secret.boxToken
    }
    const fixed = await ctx.db.query('staticBoxes').withIndex('by_slug', q => q.eq('slug', slug)).unique()
    return fixed?.boxToken ?? null
  },
})
