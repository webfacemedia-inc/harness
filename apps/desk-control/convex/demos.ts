// Timed demo Desks: a real seeded box per prospect, with a clock. The cron
// warns 24 h before expiry, then tears down (final snapshot kept); Extend
// moves the clock; Convert keeps the very same box and only changes billing.
import { v } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { workflow, retrier, requireOperator, requireOperatorAction, audit, brevoSend } from './lib'
import { cleanName, nowIso, randomId, slugify } from './core'
import { demoTemplateInput } from './schema'
import { renderEmail, esc, p, btn } from './email'

const DAY = 86_400_000

export const template = internalQuery({
  args: { id: v.id('demoTemplates') },
  handler: async (ctx, { id }) => await ctx.db.get(id),
})

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx)
    return await ctx.db.query('demoTemplates').collect()
  },
})

export const saveTemplate = mutation({
  args: {
    id: v.optional(v.id('demoTemplates')),
    name: v.string(),
    profile: v.any(),
    brand: v.optional(v.any()),
    priceListMd: v.optional(v.string()),
    seedFiles: v.optional(v.array(v.object({ path: v.string(), content: v.string() }))),
    memorySeeds: v.optional(v.array(v.any())),
  },
  handler: async (ctx, { id, ...fields }) => {
    await requireOperator(ctx)
    if (id) { await ctx.db.patch(id, { ...fields, updatedAt: nowIso() }); return id }
    return await ctx.db.insert('demoTemplates', { ...fields, updatedAt: nowIso() })
  },
})

/** The one demo-creation path — the console (Clerk) and the ops key both land here. */
async function createDemoCore(
  ctx: MutationCtx,
  args: { prospect: string; business: string; contactEmail?: string; templateId?: Id<'demoTemplates'>; days?: number; slug?: string },
  actor: string,
): Promise<{ orderId: string; slug: string }> {
  const business = cleanName(args.business)
  const slug = slugify(args.slug ?? `demo-${business}`)
  if (!slug) throw new Error('the business name makes an empty slug — give one explicitly')
  const existing = await ctx.db.query('orders').withIndex('by_slug', q => q.eq('slug', slug)).unique()
  if (existing && existing.status !== 'destroyed') throw new Error(`${slug} is already in use by ${existing.orderId}`)
  const days = Math.min(Math.max(args.days ?? 7, 1), 60)
  const orderId = randomId('ord')
  const at = nowIso()
  await ctx.runMutation(internal.orders.create, {
    orderId, kind: 'demo', plan: 'business', business, email: args.contactEmail ?? '', slug,
    sandbox: true, source: 'console',
    demo: {
      prospect: cleanName(args.prospect),
      contactEmail: args.contactEmail,
      templateId: args.templateId,
      expiresAt: new Date(Date.parse(at) + days * DAY).toISOString(),
      extendedCount: 0,
    },
  })
  await ctx.runMutation(internal.orders.patch, { orderId, status: 'paid' })  // no money changes hands for a demo
  await audit(ctx, 'ops', 'demo-created', orderId, `${actor}: ${business}, ${days}d`)
  await workflow.start(ctx, internal.provision.provisionBox, { orderId })
  return { orderId, slug }
}

/** "New demo": a real Desk for a prospect, on a clock. */
export const createDemo = mutation({
  args: {
    prospect: v.string(),
    business: v.string(),
    contactEmail: v.optional(v.string()),
    templateId: v.optional(v.id('demoTemplates')),
    days: v.optional(v.number()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = await requireOperator(ctx)
    return await createDemoCore(ctx, args, email)
  },
})

/** The ops-key path (the reel rig): create a demo headlessly, template inline. */
export const opsCreateDemo = internalMutation({
  args: {
    prospect: v.string(),
    business: v.string(),
    contactEmail: v.optional(v.string()),
    days: v.optional(v.number()),
    slug: v.optional(v.string()),
    template: v.optional(v.object(demoTemplateInput)),
  },
  handler: async (ctx, { template, ...args }) => {
    const templateId = template ? await ctx.db.insert('demoTemplates', { ...template, updatedAt: nowIso() }) : undefined
    return await createDemoCore(ctx, { ...args, templateId }, 'ops-key')
  },
})

/** What the ops key may know about a demo: state, clock, activity — never secrets. */
export const opsStatus = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order?.demo) return null
    const beat = await ctx.db.query('heartbeats').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    const daily = await ctx.db.query('usageDaily').withIndex('by_orderId_day', q => q.eq('orderId', orderId)).collect()
    return {
      id: order.orderId, status: order.status, detail: order.detail ?? '', host: order.host ?? null,
      prospect: order.demo.prospect, expiresAt: order.demo.expiresAt,
      warnedAt: order.demo.warnedAt ?? null, extendedCount: order.demo.extendedCount,
      lastSeen: beat?.at ?? null, usage: beat?.usage ?? null,
      activity: daily.map(d => ({ day: d.day, sessions: d.sessions, turns: d.turns, tokens: d.tokens })),
    }
  },
})

export const extendDemo = mutation({
  args: { orderId: v.string(), days: v.optional(v.number()) },
  handler: async (ctx, { orderId, days }) => {
    const email = await requireOperator(ctx)
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order?.demo) throw new Error(`${orderId} is not a demo`)
    const add = Math.min(Math.max(days ?? 7, 1), 60)
    const base = Math.max(Date.parse(order.demo.expiresAt), Date.now())
    await ctx.db.patch(order._id, {
      demo: {
        ...order.demo, expiresAt: new Date(base + add * DAY).toISOString(),
        warnedAt: undefined, extendedCount: order.demo.extendedCount + 1,
      },
      updatedAt: nowIso(),
    })
    await audit(ctx, 'ops', 'demo-extended', orderId, `${email}: +${add}d`)
  },
})

/** A Stripe Checkout link that converts this demo in place when paid. */
export const convertLink = action({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }): Promise<string> => {
    const email = await requireOperatorAction(ctx)
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    if (!order?.demo) throw new Error(`${orderId} is not a demo`)
    await ctx.runMutation(internal.orders.log, { actor: 'ops', action: 'demo-convert-link', orderId, detail: email })
    return await ctx.runAction(internal.ops.checkoutForOrder, { orderId, plan: order.plan })
  },
})

/** The cron's demo pass: warn at T-24h, tear down at expiry. */
export const sweepDemos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const demos = await ctx.db.query('orders').withIndex('by_kind', q => q.eq('kind', 'demo')).collect()
    for (const order of demos) {
      if (!order.demo || order.status === 'destroyed' || order.status === 'failed') continue
      const expires = Date.parse(order.demo.expiresAt)
      if (now >= expires) {
        await audit(ctx, 'system', 'demo-expired', order.orderId, order.business)
        await workflow.start(ctx, internal.provision.destroyBox, { orderId: order.orderId })
      } else if (now >= expires - DAY && !order.demo.warnedAt) {
        await retrier.run(ctx, internal.demos.warnExpirySend, { orderId: order.orderId })
      }
    }
  },
})

/** The warning email; only a send Brevo accepted marks warnedAt, so a failure retries. */
export const warnExpirySend = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    if (!order?.demo || order.demo.warnedAt) return
    const when = new Date(order.demo.expiresAt).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    await brevoSend({
      to: process.env.DESKAPI_ALERT_EMAIL ?? 'tommy@webfacemedia.com',
      subject: `Demo Desk for ${order.demo.prospect} expires ${when}`,
      html: renderEmail({
        title: 'A demo Desk is winding down',
        preheader: `${order.demo.prospect} — tears down ${when} Toronto time.`,
        body:
          p(`The demo Desk for <strong>${esc(order.demo.prospect)}</strong> (${esc(order.business)}, ${esc(order.slug)}) tears itself down at <strong>${esc(when)}</strong> Toronto time.`) +
          btn('https://desk.webfacemedia.com', 'Open the console') +
          p('Extend it from the console if the conversation is still warm — a final snapshot is kept either way.'),
      }),
    })
    await ctx.runMutation(internal.demos.markWarned, { orderId })
  },
})

export const markWarned = internalMutation({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (order?.demo) await ctx.db.patch(order._id, { demo: { ...order.demo, warnedAt: nowIso() }, updatedAt: nowIso() })
  },
})
