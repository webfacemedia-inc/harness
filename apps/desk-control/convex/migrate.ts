// The one-time import of deskapi's orders.json, posted BY the apex box itself
// (curl --data-binary @/srv/deskapi/orders.json) so passwords and box tokens
// never leave it. Idempotent by orderId: a record that already exists is
// skipped, so a partial run can simply be repeated.
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { audit } from './lib'
import { nowIso } from './core'

const KNOWN_STATUS = ['created', 'paid', 'creating', 'installing', 'ready', 'failed', 'destroyed'] as const
type KnownStatus = (typeof KNOWN_STATUS)[number]
const KNOWN_BILLING = ['ok', 'past_due', 'cancelled'] as const
type KnownBilling = (typeof KNOWN_BILLING)[number]

const str = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' ? x : undefined)
const num = (x: unknown): number | undefined => (typeof x === 'number' && Number.isFinite(x) ? x : undefined)

export const importOrders = internalMutation({
  args: { records: v.any() },
  handler: async (ctx, { records }): Promise<{ imported: number; skipped: number }> => {
    let imported = 0, skipped = 0
    const map = records as Record<string, Record<string, unknown>>
    for (const [id, o] of Object.entries(map ?? {})) {
      if (!o || typeof o !== 'object') { skipped++; continue }
      const existing = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', id)).unique()
      if (existing) { skipped++; continue }
      const status = (KNOWN_STATUS as readonly string[]).includes(String(o.status)) ? String(o.status) as KnownStatus : 'failed'
      const billing = (KNOWN_BILLING as readonly string[]).includes(String(o.billing)) ? String(o.billing) as KnownBilling : undefined
      await ctx.db.insert('orders', {
        orderId: id,
        kind: o.static ? 'internal' : 'paid',
        plan: str(o.plan) ?? 'business',
        size: str(o.size),
        business: str(o.business) ?? str(o.slug) ?? id,
        email: str(o.email) ?? '',
        slug: str(o.slug) ?? id,
        status,
        detail: str(o.detail),
        stripeSession: str(o.stripeSession),
        stripeCustomer: str(o.stripeCustomer),
        stripeSubscription: str(o.stripeSubscription),
        createdAt: str(o.createdAt) ?? nowIso(),
        paidAt: str(o.paidAt),
        readyAt: str(o.readyAt),
        updatedAt: str(o.updatedAt) ?? nowIso(),
        destroyedAt: str(o.destroyedAt),
        source: str(o.source),
        webfaceClient: str(o.webfaceClient),
        sandbox: o.sandbox === true ? true : undefined,
        ip: str(o.ip),
        host: str(o.host),
        dropletId: num(o.dropletId),
        dns: typeof o.dns === 'boolean' ? o.dns : undefined,
        passwordShown: o.passwordShown ? true : undefined,
        billing,
        billingAt: str(o.billingAt),
        pastDueSince: str(o.pastDueSince),
        usageAlerted: str(o.usageAlerted),
        lastSnapshot: str(o.lastSnapshot),
        finalSnapshot: num(o.finalSnapshot),
      })
      const boxToken = str(o.boxToken)
      if (boxToken) {
        // The password persists only while the welcome page has never shown it.
        await ctx.db.insert('boxSecrets', {
          orderId: id, boxToken,
          ...(str(o.password) && !o.passwordShown ? { password: str(o.password)! } : {}),
          ...(o.passwordShown ? { passwordShownAt: str(o.passwordShown) ?? nowIso() } : {}),
        })
      }
      imported++
    }
    await audit(ctx, 'system', 'orders-imported', undefined, `${imported} imported, ${skipped} already present or unreadable`)
    return { imported, skipped }
  },
})
