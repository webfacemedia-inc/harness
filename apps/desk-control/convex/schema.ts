// Fleet metadata only. Nothing from inside a customer's Desk (mail, files,
// sessions) ever lands here — counters, states and audit, never content.
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

/** Where an order is in its life. `dns-failed` is detail, not a status. */
export const orderStatus = v.union(
  v.literal('created'), v.literal('paid'), v.literal('creating'),
  v.literal('installing'), v.literal('ready'), v.literal('failed'), v.literal('destroyed'),
)

export const billingState = v.union(v.literal('ok'), v.literal('past_due'), v.literal('cancelled'))

/** What a box is for: a paying customer, a timed prospect demo, or our own. */
export const orderKind = v.union(v.literal('paid'), v.literal('demo'), v.literal('internal'))

const brand = v.object({
  primary: v.optional(v.string()),
  accent: v.optional(v.string()),
  font: v.optional(v.union(v.literal('editorial'), v.literal('classic'), v.literal('plain'))),
  tagline: v.optional(v.string()),
})

/** A demo template's payload — the table adds updatedAt; the ops demo route reuses this as its inline-template validator. */
export const demoTemplateInput = {
  name: v.string(),
  profile: v.object({
    business: v.string(),
    does: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    hours: v.optional(v.string()),
    voice: v.optional(v.string()),
    rules: v.optional(v.string()),
  }),
  brand: v.optional(brand),
  priceListMd: v.optional(v.string()),
  seedFiles: v.optional(v.array(v.object({ path: v.string(), content: v.string() }))),
  memorySeeds: v.optional(v.array(v.object({
    kind: v.union(v.literal('fact'), v.literal('decision'), v.literal('commitment'), v.literal('preference')),
    about: v.optional(v.string()),
    text: v.string(),
    pinned: v.optional(v.boolean()),
  }))),
}

const usage = v.object({
  monthTokens: v.optional(v.number()),
  totalTokens: v.optional(v.number()),
  sessions: v.optional(v.number()),
  turns: v.optional(v.number()),
})

export default defineSchema({
  orders: defineTable({
    orderId: v.string(),                      // ord_<16hex> | static_<slug> — the id boxes and Stripe know
    kind: orderKind,
    plan: v.string(),                         // business | operators
    size: v.optional(v.string()),
    business: v.string(),
    email: v.string(),
    slug: v.string(),
    status: orderStatus,
    detail: v.optional(v.string()),
    stripeSession: v.optional(v.string()),
    stripeCustomer: v.optional(v.string()),
    stripeSubscription: v.optional(v.string()),
    createdAt: v.string(),
    paidAt: v.optional(v.string()),
    readyAt: v.optional(v.string()),
    updatedAt: v.string(),
    destroyedAt: v.optional(v.string()),
    source: v.optional(v.string()),           // 'operator' when an operator Desk created it
    webfaceClient: v.optional(v.string()),
    sandbox: v.optional(v.boolean()),
    ip: v.optional(v.string()),
    host: v.optional(v.string()),
    dropletId: v.optional(v.number()),
    dns: v.optional(v.boolean()),
    passwordShown: v.optional(v.boolean()),
    billing: v.optional(billingState),
    billingAt: v.optional(v.string()),
    pastDueSince: v.optional(v.string()),
    usageAlerted: v.optional(v.string()),     // YYYY-MM, set only after the alert actually sent
    lastSnapshot: v.optional(v.string()),
    finalSnapshot: v.optional(v.number()),
    workflowId: v.optional(v.string()),       // the run that owns this order right now
    lastError: v.optional(v.object({ step: v.string(), message: v.string(), at: v.string() })),
    attempts: v.optional(v.number()),
    // Timed demos (kind: 'demo')
    demo: v.optional(v.object({
      prospect: v.string(),
      contactEmail: v.optional(v.string()),
      templateId: v.optional(v.id('demoTemplates')),
      expiresAt: v.string(),
      warnedAt: v.optional(v.string()),
      extendedCount: v.number(),
      convertedAt: v.optional(v.string()),
    })),
  })
    .index('by_orderId', ['orderId'])
    .index('by_slug', ['slug'])
    .index('by_stripeSubscription', ['stripeSubscription'])
    .index('by_status', ['status'])
    .index('by_kind', ['kind']),

  // The one table that holds material a leak would hurt: each box's bearer
  // token and the owner's first password (readable once on /welcome, then
  // cleared). The token is stored raw — the control plane must present it to
  // the box for billing/config pushes, so a hash would only force a second
  // copy elsewhere. All access is through internal functions.
  boxSecrets: defineTable({
    orderId: v.string(),
    boxToken: v.string(),
    password: v.optional(v.string()),
    passwordShownAt: v.optional(v.string()),
    opsRevealedAt: v.optional(v.string()),
  }).index('by_orderId', ['orderId']),

  // Latest heartbeat per box — history is not kept for paid boxes (matches today).
  heartbeats: defineTable({
    orderId: v.string(),
    at: v.string(),
    ready: v.boolean(),
    harness: v.boolean(),
    google: v.number(),                       // connected accounts
    push: v.number(),                         // registered devices
    usage: v.optional(usage),
  }).index('by_orderId', ['orderId']),

  // Demo boxes keep a small daily activity trail — counters only, never content.
  usageDaily: defineTable({
    orderId: v.string(),
    day: v.string(),                          // YYYY-MM-DD UTC
    sessions: v.number(),
    turns: v.number(),
    tokens: v.number(),
  }).index('by_orderId_day', ['orderId', 'day']),

  // Stripe idempotency + the record of what billing did to whom.
  billingEvents: defineTable({
    stripeEventId: v.string(),
    type: v.string(),
    orderId: v.optional(v.string()),
    state: v.optional(billingState),
    matched: v.boolean(),
    at: v.string(),
  }).index('by_stripeEventId', ['stripeEventId']),

  snapshots: defineTable({
    orderId: v.string(),
    doSnapshotId: v.optional(v.number()),
    name: v.string(),
    kind: v.union(v.literal('nightly'), v.literal('final')),
    at: v.string(),
  }).index('by_orderId', ['orderId']),

  // Every consequential act, whoever performed it.
  opsAudit: defineTable({
    at: v.string(),
    actor: v.union(v.literal('stripe'), v.literal('ops'), v.literal('system'), v.literal('box')),
    action: v.string(),
    orderId: v.optional(v.string()),
    detail: v.optional(v.string()),
  }).index('by_at', ['at']),

  // Replaces the DESKAPI_STATIC_* env lists: boxes we run that no order created.
  staticBoxes: defineTable({
    slug: v.string(),
    dropletId: v.optional(v.number()),
    boxToken: v.string(),
    webfaceClient: v.optional(v.string()),
  }).index('by_slug', ['slug']),

  // The rehearsed starting state a demo Desk is born with.
  demoTemplates: defineTable({ ...demoTemplateInput, updatedAt: v.string() }),

  // Deploy-time payloads too big for env vars: the box bootstrap script
  // (pushed by scripts/push-bootstrap.mjs on every deploy) and similar.
  config: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.string(),
  }).index('by_key', ['key']),

  // Who may operate the console. Clerk authenticates; this authorises.
  operators: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    addedAt: v.string(),
  }).index('by_email', ['email']),
})
