// Crons live in code so a redeploy can never lose them. Registration is
// idempotent: `init` runs on every deploy (convex.json runs it) and only
// registers what is missing.
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import { crons } from './lib'

export const init = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!(await crons.get(ctx, { name: 'nightly' }))) {
      // 07:30 UTC — the quiet middle of the Toronto night, same hour deskapi used.
      await crons.register(ctx, { kind: 'cron', cronspec: '30 7 * * *' }, internal.ops.nightly, {}, 'nightly')
    }
    if (!(await crons.get(ctx, { name: 'demo-sweep' }))) {
      // Hourly: demo warnings and teardowns should land near their minute, not next morning.
      await crons.register(ctx, { kind: 'interval', ms: 3_600_000 }, internal.demos.sweepDemos, {}, 'demo-sweep')
    }
  },
})
