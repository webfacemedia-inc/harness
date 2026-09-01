// What boxes tell us: the 60-second heartbeat, and what we make of it —
// fleet liveness, usage alerting (marked sent only after Brevo accepts, the
// deskapi lesson), and the small daily activity trail demo boxes keep.
import { v } from 'convex/values'
import { internalAction, internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { retrier, brevoSend } from './lib'
import { nowIso } from './core'

export const heartbeat = internalMutation({
  args: { orderId: v.string(), body: v.any() },
  handler: async (ctx, { orderId, body }) => {
    const at = nowIso()
    const usage = body?.usage && typeof body.usage === 'object' ? {
      monthTokens: Number(body.usage.monthTokens ?? 0),
      totalTokens: Number(body.usage.totalTokens ?? 0),
      sessions: Number(body.usage.sessions ?? 0),
      turns: Number(body.usage.turns ?? 0),
    } : undefined
    const row = {
      orderId, at,
      ready: Boolean(body?.ready),
      harness: Boolean(body?.harness),
      google: Array.isArray(body?.google?.accounts) ? body.google.accounts.length : 0,
      push: Number(body?.push?.devices ?? 0),
      ...(usage ? { usage } : {}),
    }
    const existing = await ctx.db.query('heartbeats').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (existing) await ctx.db.replace(existing._id, row)
    else await ctx.db.insert('heartbeats', row)

    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order || !usage) return

    // Demo boxes keep a per-day trail — counters only, never content.
    if (order.kind === 'demo') {
      const day = at.slice(0, 10)
      const daily = await ctx.db.query('usageDaily')
        .withIndex('by_orderId_day', q => q.eq('orderId', orderId).eq('day', day)).unique()
      const snap = { sessions: usage.sessions, turns: usage.turns, tokens: usage.totalTokens }
      if (daily) await ctx.db.patch(daily._id, snap)
      else await ctx.db.insert('usageDaily', { orderId, day, ...snap })
    }

    // One usage alert per month, and only once the send has actually happened.
    const cap = Number(process.env.DESKAPI_MONTHLY_TOKEN_CAP ?? 20_000_000)
    const month = at.slice(0, 7)
    if (cap && usage.monthTokens >= cap && order.usageAlerted !== month) {
      await retrier.run(ctx, internal.boxes.usageAlertAction, { orderId, month, monthTokens: usage.monthTokens })
    }
  },
})

export const usageAlertAction = internalAction({
  args: { orderId: v.string(), month: v.string(), monthTokens: v.number() },
  handler: async (ctx, { orderId, month, monthTokens }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    if (!order || order.usageAlerted === month) return
    const cap = Number(process.env.DESKAPI_MONTHLY_TOKEN_CAP ?? 20_000_000)
    await brevoSend({
      to: process.env.DESKAPI_ALERT_EMAIL ?? 'tommy@webfacemedia.com',
      subject: `Desk ${order.slug} passed ${Math.round(cap / 1e6)}M tokens this month`,
      html: `<p>${order.business} (${order.slug}) has used ${Math.round(monthTokens / 1e6)}M tokens in ${month}. Plan: ${order.plan}.</p>`,
    })
    // Only a send Brevo accepted silences the month — a throw above retries instead.
    await ctx.runMutation(internal.boxes.markUsageAlerted, { orderId, month })
  },
})

export const markUsageAlerted = internalMutation({
  args: { orderId: v.string(), month: v.string() },
  handler: async (ctx, { orderId, month }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (order) await ctx.db.patch(order._id, { usageAlerted: month, updatedAt: nowIso() })
  },
})
