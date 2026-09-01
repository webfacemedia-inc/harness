// Stripe's word becomes fleet state here, idempotently, and boxes are told.
// The event handling mirrors deskapi (billingStateFor is the ported, tested
// mapping); the new parts are the billingEvents idempotency table and that an
// unmatched subscription is recorded, never silently dropped.
import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { retrier, boxCall, stripeApi } from './lib'
import { billingStateFor, nowIso } from './core'

/**
 * One verified Stripe event. Returns what to do next so the HTTP action can
 * schedule box notifications outside the transaction.
 */
export const applyEvent = internalMutation({
  args: { stripeEventId: v.string(), type: v.string(), object: v.any() },
  handler: async (ctx, { stripeEventId, type, object }): Promise<{ duplicate?: boolean; fulfil?: string; tellBox?: { orderId: string; state: 'ok' | 'past_due' | 'cancelled' } }> => {
    const seen = await ctx.db.query('billingEvents').withIndex('by_stripeEventId', q => q.eq('stripeEventId', stripeEventId)).unique()
    if (seen) return { duplicate: true }
    const at = nowIso()

    if (type === 'checkout.session.completed') {
      const orderId = String(object.client_reference_id ?? object.metadata?.order ?? '')
      const order = orderId ? await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique() : null
      if (!order) {
        await ctx.db.insert('billingEvents', { stripeEventId, type, matched: false, at })
        await ctx.runMutation(internal.orders.log, { actor: 'stripe', action: 'webhook-unmatched', detail: `${type} for ${object.id}` })
        return {}
      }
      await ctx.db.insert('billingEvents', { stripeEventId, type, orderId, matched: true, at })
      // A demo converting to paid keeps its box: only billing identity changes hands.
      if (order.kind === 'demo' && order.status === 'ready') {
        await ctx.db.patch(order._id, {
          kind: 'paid', stripeCustomer: object.customer, stripeSubscription: object.subscription,
          paidAt: at, billing: 'ok', demo: order.demo ? { ...order.demo, convertedAt: at } : undefined, updatedAt: at,
        })
        await ctx.runMutation(internal.orders.log, { actor: 'stripe', action: 'demo-converted', orderId, detail: order.business })
        return {}
      }
      if (order.status === 'created') {
        await ctx.db.patch(order._id, { status: 'paid', stripeCustomer: object.customer, stripeSubscription: object.subscription, paidAt: at, updatedAt: at })
        return { fulfil: orderId }
      }
      return {}
    }

    const state = billingStateFor(type)
    if (state) {
      const subscription = String(object.subscription ?? object.id ?? '')
      const order = await ctx.db.query('orders').withIndex('by_stripeSubscription', q => q.eq('stripeSubscription', subscription)).unique()
      if (!order) {
        await ctx.db.insert('billingEvents', { stripeEventId, type, state, matched: false, at })
        await ctx.runMutation(internal.orders.log, { actor: 'stripe', action: 'billing-unmatched', detail: `${type} for subscription ${subscription}` })
        return {}
      }
      await ctx.db.insert('billingEvents', { stripeEventId, type, state, orderId: order.orderId, matched: true, at })
      const unchanged = state === 'ok' && (order.billing ?? 'ok') === 'ok'
      if (unchanged) return {}
      await ctx.db.patch(order._id, {
        billing: state, billingAt: at, updatedAt: at,
        ...(state === 'past_due' && order.billing !== 'past_due' ? { pastDueSince: at } : {}),
        ...(state !== 'past_due' ? { pastDueSince: undefined } : {}),
      })
      await ctx.runMutation(internal.orders.log, { actor: 'stripe', action: `billing:${state}`, orderId: order.orderId })
      return { tellBox: { orderId: order.orderId, state } }
    }

    await ctx.db.insert('billingEvents', { stripeEventId, type, matched: false, at })
    return {}
  },
})

/** Tell a box its billing state; past_due carries a portal link for the card fix. */
export const tellBox = internalAction({
  args: { orderId: v.string(), state: v.union(v.literal('ok'), v.literal('past_due'), v.literal('cancelled')) },
  handler: async (ctx, { orderId, state }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) return
    let portalUrl = ''
    if (state === 'past_due' && order.stripeCustomer) {
      try {
        portalUrl = (await stripeApi('billing_portal/sessions', { customer: order.stripeCustomer, return_url: `https://${order.host}/` })).url
      } catch (e) {
        await ctx.runMutation(internal.orders.noteError, { orderId, step: 'billing-portal', message: e instanceof Error ? e.message : String(e) })
      }
    }
    await boxCall(order.host, '/deskd/billing', token, { state, portalUrl })
  },
})

/** Schedule a billing push through the retrier so a sleepy box gets more than one chance. */
export const scheduleTellBox = internalMutation({
  args: { orderId: v.string(), state: v.union(v.literal('ok'), v.literal('past_due'), v.literal('cancelled')) },
  handler: async (ctx, args) => {
    await retrier.run(ctx, internal.billing.tellBox, args, { initialBackoffMs: 5000, base: 3, maxFailures: 4 })
  },
})

/** The Stripe billing-portal URL for a box's /billing page. */
export const portalUrl = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }): Promise<string | null> => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    if (!order?.stripeCustomer) return null
    const session = await stripeApi('billing_portal/sessions', {
      customer: order.stripeCustomer,
      return_url: `https://${order.host ?? (process.env.DESK_DOMAIN ?? 'webfacedesk.app')}/`,
    })
    return session.url as string
  },
})
