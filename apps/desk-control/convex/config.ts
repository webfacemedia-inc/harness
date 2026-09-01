// Deploy-time payloads too big for env vars. `set` is invoked by
// scripts/push-bootstrap.mjs as part of the deploy recipe.
import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { nowIso } from './core'

export const set = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, { key, value }) => {
    const existing = await ctx.db.query('config').withIndex('by_key', q => q.eq('key', key)).unique()
    if (existing) await ctx.db.patch(existing._id, { value, updatedAt: nowIso() })
    else await ctx.db.insert('config', { key, value, updatedAt: nowIso() })
  },
})
