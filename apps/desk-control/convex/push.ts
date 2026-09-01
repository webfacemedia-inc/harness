// The control plane's hands on a box: profile and brand pushed over the
// box-token channel, demo seeding, and screen recording control. Every push
// is audited; every one throws on failure so the retrier gets its chance.
import { v } from 'convex/values'
import { internalAction, internalMutation, mutation, action } from './_generated/server'
import { internal } from './_generated/api'
import { retrier, boxCall, requireOperator, requireOperatorAction } from './lib'

const profileFields = {
  business: v.optional(v.string()),
  does: v.optional(v.string()),
  address: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  website: v.optional(v.string()),
  hours: v.optional(v.string()),
  voice: v.optional(v.string()),
  rules: v.optional(v.string()),
}

const brandFields = {
  primary: v.optional(v.string()),
  accent: v.optional(v.string()),
  font: v.optional(v.union(v.literal('editorial'), v.literal('classic'), v.literal('plain'))),
  tagline: v.optional(v.string()),
}

/** Console entry: push profile/brand to a box, retried, audited. */
export const pushConfig = mutation({
  args: {
    orderId: v.string(),
    profile: v.optional(v.object(profileFields)),
    brand: v.optional(v.object(brandFields)),
    restart: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = await requireOperator(ctx)
    await ctx.runMutation(internal.orders.log, { actor: 'ops', action: 'config-push', orderId: args.orderId, detail: `${email}: ${Object.keys(args).filter(k => k !== 'orderId').join(', ')}` })
    await retrier.run(ctx, internal.push.pushConfigAction, args, { initialBackoffMs: 5000, base: 3, maxFailures: 4 })
  },
})

export const pushConfigAction = internalAction({
  args: {
    orderId: v.string(),
    profile: v.optional(v.object(profileFields)),
    brand: v.optional(v.object(brandFields)),
    restart: v.optional(v.boolean()),
  },
  handler: async (ctx, { orderId, profile, brand, restart }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) throw new Error(`box for ${orderId} is not reachable (no host or token)`)
    await boxCall(order.host, '/deskd/config', token, { profile, brand, restart })
  },
})

/** A logo for a box, fetched from a URL the console uploaded it to (Convex storage). */
export const pushLogo = action({
  args: { orderId: v.string(), storageId: v.id('_storage'), filename: v.string() },
  handler: async (ctx, { orderId, storageId, filename }) => {
    await requireOperatorAction(ctx)
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) throw new Error(`box for ${orderId} is not reachable`)
    const blob = await ctx.storage.get(storageId)
    if (!blob) throw new Error('the uploaded logo is gone from storage')
    const r = await fetch(`https://${order.host}/deskd/config/logo`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'x-filename': filename, 'content-type': 'application/octet-stream' },
      body: blob,
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) throw new Error(`box logo push said ${r.status}`)
    await ctx.runMutation(internal.orders.log, { actor: 'ops', action: 'logo-push', orderId, detail: filename })
    await ctx.storage.delete(storageId)
  },
})

/** The console asks for an upload slot for a logo file. */
export const logoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireOperator(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

/** Seed a demo box with its template: profile, brand, files, memory. */
export const seedDemo = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) throw new Error(`box for ${orderId} is not reachable`)
    if (!order.demo?.templateId) return
    const template = await ctx.runQuery(internal.demos.template, { id: order.demo.templateId })
    if (!template) return
    await boxCall(order.host, '/deskd/config', token, { profile: template.profile, brand: template.brand ?? {} })
    await boxCall(order.host, '/deskd/seed', token, {
      files: [
        ...(template.priceListMd ? [{ path: 'price-list.md', content: template.priceListMd }] : []),
        ...(template.seedFiles ?? []),
      ],
      memory: template.memorySeeds ?? [],
    })
    await ctx.runMutation(internal.orders.log, { actor: 'system', action: 'demo-seeded', orderId, detail: template.name })
  },
})

/** Screen recording on a box: start, stop, list — the mp4s come back through the console. */
export const record = action({
  args: { orderId: v.string(), op: v.union(v.literal('start'), v.literal('stop'), v.literal('list'), v.literal('open-desk')) },
  handler: async (ctx, { orderId, op }): Promise<Record<string, unknown>> => {
    await requireOperatorAction(ctx)
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) throw new Error(`box for ${orderId} is not reachable`)
    const out = await boxCall(order.host, '/deskd/record', token, { op })
    await ctx.runMutation(internal.orders.log, { actor: 'ops', action: `record:${op}`, orderId })
    return out
  },
})

/**
 * A short-lived download link for a recording. The box signs it with its own
 * token (HMAC over file+expiry), so the browser gets a URL, never a credential.
 */
export const recordingUrl = action({
  args: { orderId: v.string(), file: v.string() },
  handler: async (ctx, { orderId, file }): Promise<string | null> => {
    await requireOperatorAction(ctx)
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) return null
    const out = await boxCall(order.host, '/deskd/record', token, { op: 'link', file })
    return typeof out.url === 'string' ? out.url : null
  },
})

/**
 * "Save as template": read a box's live setup — profile, brand, price list,
 * memory — into a demo template, so the rehearsed default is captured from a
 * real, tuned Desk instead of typed into a form.
 */
export const captureTemplate = action({
  args: { orderId: v.string(), name: v.string(), templateId: v.optional(v.id('demoTemplates')) },
  handler: async (ctx, { orderId, name, templateId }): Promise<string> => {
    const email = await requireOperatorAction(ctx)
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) throw new Error(`box for ${orderId} is not reachable`)
    const current = await boxCall(order.host, '/deskd/config', token, { read: true })
    const profile = (current.profile ?? {}) as Record<string, string>
    const id: string = await ctx.runMutation(internal.push.saveCapturedTemplate, {
      templateId,
      name,
      profile: { ...profile, business: profile.business ?? order.business },
      brand: current.brand ?? {},
      priceListMd: typeof current.priceListMd === 'string' ? current.priceListMd : undefined,
      memorySeeds: Array.isArray(current.memory) ? current.memory : [],
    })
    await ctx.runMutation(internal.orders.log, { actor: 'ops', action: 'template-captured', orderId, detail: `${email}: ${name}` })
    return id
  },
})

export const saveCapturedTemplate = internalMutation({
  args: {
    templateId: v.optional(v.id('demoTemplates')),
    name: v.string(),
    profile: v.any(),
    brand: v.any(),
    priceListMd: v.optional(v.string()),
    memorySeeds: v.any(),
  },
  handler: async (ctx, { templateId, ...fields }): Promise<string> => {
    const at = new Date().toISOString()
    if (templateId) { await ctx.db.patch(templateId, { ...fields, updatedAt: at }); return templateId }
    return await ctx.db.insert('demoTemplates', { ...fields, updatedAt: at })
  },
})

/**
 * "Reset to template": put a box back to its rehearsed default — profile and
 * brand pushed, seed files rewritten, and the memory ledger REPLACED by the
 * template's seeds (what a prospect typed into the demo is gone).
 */
export const resetBox = action({
  args: { orderId: v.string(), templateId: v.id('demoTemplates') },
  handler: async (ctx, { orderId, templateId }) => {
    const email = await requireOperatorAction(ctx)
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    const token = await ctx.runQuery(internal.secrets.boxTokenFor, { orderId })
    if (!order?.host || !token) throw new Error(`box for ${orderId} is not reachable`)
    const template = await ctx.runQuery(internal.demos.template, { id: templateId })
    if (!template) throw new Error('that template is gone')
    await boxCall(order.host, '/deskd/config', token, { profile: template.profile, brand: template.brand ?? {} })
    await boxCall(order.host, '/deskd/seed', token, {
      resetMemory: true,
      files: [
        ...(template.priceListMd ? [{ path: 'price-list.md', content: template.priceListMd }] : []),
        ...(template.seedFiles ?? []),
      ],
      memory: template.memorySeeds ?? [],
    })
    await ctx.runMutation(internal.orders.log, { actor: 'ops', action: 'box-reset', orderId, detail: `${email}: ${template.name}` })
  },
})
