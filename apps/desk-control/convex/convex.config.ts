// The control plane's durable machinery: workflows own provisioning and
// teardown (a redeploy resumes them), the retrier owns every outbound call
// that may flake (boxes, Cloudflare, DigitalOcean, Brevo), crons are defined
// in code so they survive redeploys, and the rate limiter guards checkout.
import { defineApp } from 'convex/server'
import workflow from '@convex-dev/workflow/convex.config'
import actionRetrier from '@convex-dev/action-retrier/convex.config'
import crons from '@convex-dev/crons/convex.config'
import rateLimiter from '@convex-dev/rate-limiter/convex.config'

const app = defineApp()
app.use(workflow)
app.use(actionRetrier)
app.use(crons)
app.use(rateLimiter)
export default app
