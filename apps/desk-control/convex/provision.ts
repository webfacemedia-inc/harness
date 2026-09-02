// Turning a paid order into a Desk computer, durably. Each step is journalled:
// a redeploy or crash resumes the run where it stopped instead of stranding the
// order in `creating` — and an interrupted run adopts the droplet it already
// made (by saved id, then by the `order:<id>` tag) rather than billing a second
// one. The semantics mirror apps/deskapi/src/provision.js, which carries the
// tests of record.
import { v } from 'convex/values'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { workflow, retrier, doApi, cfDnsUpsert, cfDnsDelete, brevoSend, env } from './lib'
import { buildUserData, nowIso, randomSecret } from './core'
import { renderEmail, esc, p, btn, link, panel, muted, restyleParagraphs } from './email'

const DOMAIN = () => process.env.DESK_DOMAIN ?? 'webfacedesk.app'

/** Begin (or resume): secrets minted once, status creating, attempt counted. */
export const begin = internalMutation({
  args: { orderId: v.string(), workflowId: v.string() },
  handler: async (ctx, { orderId, workflowId }) => {
    const order = await ctx.db.query('orders').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique()
    if (!order) throw new Error(`no order ${orderId}`)
    const secrets: { boxToken: string; password: string } = await ctx.runMutation(internal.secrets.mint, {
      orderId, boxToken: randomSecret(16), password: randomSecret(12),
    })
    await ctx.db.patch(order._id, {
      status: 'creating', detail: 'creating your Desk in Toronto', workflowId,
      attempts: (order.attempts ?? 0) + 1, updatedAt: nowIso(),
    })
    return {
      secrets,
      // The workflow handler runs deterministically, with no process.env of its
      // own — everything environmental is decided here and journalled.
      dnsAble: Boolean(process.env.CLOUDFLARE_API_TOKEN),
      domain: process.env.DESK_DOMAIN ?? 'webfacedesk.app',
      order: {
        slug: order.slug, business: order.business, plan: order.plan, size: order.size,
        sandbox: order.sandbox, dropletId: order.dropletId, kind: order.kind,
      },
    }
  },
})

export const bootstrapScript = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query('config').withIndex('by_key', q => q.eq('key', 'bootstrapScript')).unique()
    if (!row) throw new Error('bootstrapScript is not in config — run scripts/push-bootstrap.mjs after deploy')
    return row.value
  },
})

/** Create the droplet — or adopt the one an interrupted run already made. */
export const createDroplet = internalAction({
  args: {
    orderId: v.string(), slug: v.string(), business: v.string(), plan: v.string(),
    size: v.optional(v.string()), sandbox: v.optional(v.boolean()),
    dropletId: v.optional(v.number()), boxToken: v.string(), password: v.string(),
    dnsAble: v.boolean(),
  },
  handler: async (ctx, a) => {
    let droplet: Record<string, any> | null = null
    if (a.dropletId) droplet = await doApi('GET', `/droplets/${a.dropletId}`).then(r => r.droplet).catch(() => null)
    if (!droplet) droplet = await doApi('GET', `/droplets?tag_name=order:${a.orderId}`).then(r => r.droplets?.[0] ?? null).catch(() => null)
    if (!droplet) {
      const script: string = await ctx.runQuery(internal.provision.bootstrapScript, {})
      const boxEnv = {
        DESK_SLUG: a.slug, DESK_BUSINESS: a.business,
        DESK_HOST: a.dnsAble ? `${a.slug}.${DOMAIN()}` : '',
        OPENROUTER_API_KEY: env('OPENROUTER_API_KEY'),
        DESK_OWNER_USER: 'owner', DESK_OWNER_EMAIL: '', DESK_OWNER_PASSWORD: a.password,
        DESK_HARNESS_REF: process.env.DESK_HARNESS_REF ?? 'desk',
        // Bootstrap uses DESK_SANDBOX verbatim as the sandbox-policy mode, so it
        // must be a valid mode string, never a flag: a sandboxed box (demos) runs
        // workspace-write — it drafts and files, but nothing danger-full — and an
        // unsandboxed box falls through to bootstrap's read-only default.
        DESK_SANDBOX: a.sandbox ? 'workspace-write' : '',
        DESK_DEFAULT_PRESET: 'team',
        DESK_PLAN: a.plan,
        FAL_KEY: process.env.FAL_KEY ?? '',
        DESK_API_URL: process.env.DESK_PUBLIC_URL ? `${process.env.DESK_PUBLIC_URL}/api` : '',
        DESK_BOX_TOKEN: a.boxToken,
      }
      const keys = (await doApi('GET', '/account/keys?per_page=50')).ssh_keys.map((k: { id: number }) => k.id)
      droplet = (await doApi('POST', '/droplets', {
        name: `desk-${a.slug}`, region: 'tor1', size: a.size ?? 's-2vcpu-4gb', image: 'ubuntu-24-04-x64',
        ssh_keys: keys, tags: ['webface-desk', `plan:${a.plan}`, `order:${a.orderId}`],
        user_data: buildUserData(boxEnv, script), monitoring: true,
      })).droplet
    }
    return droplet!.id as number
  },
})

/** One look for the droplet's public address. The workflow supplies the patience. */
export const getIp = internalAction({
  args: { dropletId: v.number() },
  handler: async (_ctx, { dropletId }) => {
    const d = (await doApi('GET', `/droplets/${dropletId}`)).droplet
    return (d.networks?.v4?.find((n: { type: string }) => n.type === 'public')?.ip_address ?? null) as string | null
  },
})

export const dnsUpsert = internalAction({
  args: { slug: v.string(), ip: v.string() },
  handler: async (_ctx, { slug, ip }) => await cfDnsUpsert(slug, ip),
})

/** Is the box answering yet? Any failure means "not yet", never "give up". */
export const probeHealthz = internalAction({
  args: { host: v.string() },
  handler: async (_ctx, { host }) => {
    try { return (await fetch(`https://${host}/healthz`, { signal: AbortSignal.timeout(5000) })).ok } catch { return false }
  },
})

export const cleanupDroplet = internalAction({
  args: { dropletId: v.number() },
  handler: async (_ctx, { dropletId }) => { await doApi('DELETE', `/droplets/${dropletId}`) },
})

export const welcomeEmail = internalAction({
  args: { orderId: v.string() },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.runQuery(internal.orders.byOrderId, { orderId })
    if (!order) throw new Error(`no order ${orderId}`)
    const base = process.env.DESK_PUBLIC_URL ?? 'https://webfacedesk.app'
    const url = `${base}/welcome?order=${orderId}`
    await brevoSend({
      to: order.email,
      subject: `Your Desk is ready — ${order.host}`,
      html: renderEmail({
        title: 'Your Desk is ready',
        preheader: `${order.business} is set up at ${order.host}. Your sign-in details are one click away.`,
        body:
          p(`The Desk for <strong>${esc(order.business)}</strong> is set up and waiting.`) +
          btn(url, 'See your sign-in details') +
          p(`The welcome page shows your password <strong>once</strong>, so have a password manager handy. If your Google address is ${esc(order.email)}, <strong>Sign in with Google</strong> works too.`) +
          panel(p(`Your Desk lives at ${link(`https://${order.host}/`, esc(order.host))} — any time, from any device. On your computer you can also ${link(`${base}/download`, 'get the desktop app')}.`).replace(/margin:0 0 14px/, 'margin:0')) +
          p(`${link('https://book.webface.cloud/book/tommyadeniyi', 'Book your set-up call')} — 30 minutes, together on screen. Or just sign in: your Desk opens the Business page and asks about the business.`) +
          muted('Your subscription, invoices and card live under Billing in your Desk&rsquo;s sidebar — you can cancel there at any time.'),
      }),
    })
  },
})

export const opsAlert = internalAction({
  args: { subject: v.string(), html: v.string() },
  handler: async (_ctx, { subject, html }) => {
    await brevoSend({
      to: process.env.DESKAPI_ALERT_EMAIL ?? 'tommy@webfacemedia.com',
      subject,
      html: renderEmail({ title: subject, body: restyleParagraphs(html) }),
    })
  },
})

const RETRY = { maxAttempts: 3, initialBackoffMs: 2000, base: 2 }

export const provisionBox = workflow.define({
  args: { orderId: v.string() },
  handler: async (step, { orderId }): Promise<void> => {
    const { secrets, order, dnsAble, domain } = await step.runMutation(internal.provision.begin, { orderId, workflowId: step.workflowId })

    let dropletId: number | undefined
    try {
      dropletId = await step.runAction(internal.provision.createDroplet, {
        orderId, slug: order.slug, business: order.business, plan: order.plan,
        size: order.size, sandbox: order.sandbox, dropletId: order.dropletId,
        boxToken: secrets.boxToken, password: secrets.password, dnsAble,
      }, { retry: RETRY })
      await step.runMutation(internal.orders.patch, { orderId, dropletId })

      // The droplet takes a minute or two to get its address.
      let ip: string | null = null
      for (let i = 0; i < 60 && !ip; i++) {
        await step.sleep(5000)
        ip = await step.runAction(internal.provision.getIp, { dropletId }, { retry: RETRY })
      }
      if (!ip) throw new Error('droplet never got a public address')
      await step.runMutation(internal.orders.patch, { orderId, ip })

      // DNS is best-effort: a Cloudflare outage downgrades to sslip, never fails the run.
      let dns = false
      if (dnsAble) {
        try { dns = await step.runAction(internal.provision.dnsUpsert, { slug: order.slug, ip }, { retry: RETRY }) }
        catch (e) { await step.runMutation(internal.orders.noteError, { orderId, step: 'dns', message: e instanceof Error ? e.message : String(e) }) }
      }
      const host = dns ? `${order.slug}.${domain}` : `${ip}.sslip.io`
      await step.runMutation(internal.orders.patch, { orderId, host, dns, status: 'installing', detail: 'setting up your Desk' })

      // First boot installs everything; up to 30 minutes before we call it dead.
      let up = false
      for (let i = 0; i < 180 && !up; i++) {
        await step.sleep(10000)
        up = await step.runAction(internal.provision.probeHealthz, { host })
      }
      if (!up) throw new Error('box did not come up in 30 minutes')

      await step.runMutation(internal.orders.patch, { orderId, status: 'ready', detail: '', readyNow: true, clearLastError: true })
      await step.runMutation(internal.orders.log, { actor: 'system', action: 'box-ready', orderId, detail: host })

      // A demo box is born dressed: profile, brand and the rehearsed seed.
      if (order.kind === 'demo') {
        try { await step.runAction(internal.push.seedDemo, { orderId }, { retry: RETRY }) }
        catch (e) { await step.runMutation(internal.orders.noteError, { orderId, step: 'seed', message: e instanceof Error ? e.message : String(e) }) }
      }

      try {
        if (order.kind !== 'demo') await step.runAction(internal.provision.welcomeEmail, { orderId }, { retry: { maxAttempts: 5, initialBackoffMs: 5000, base: 2 } })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await step.runMutation(internal.orders.noteError, { orderId, step: 'welcome-email', message })
        await step.runAction(internal.provision.opsAlert, {
          subject: `Desk ${order.slug} is ready but the welcome email failed`,
          html: `<p>${order.slug} is ready at ${host}, but Brevo would not send the welcome: ${message}. Resend it from the console.</p>`,
        }, { retry: RETRY }).catch(() => {})
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await step.runMutation(internal.orders.noteError, { orderId, step: 'provision', message })
      if (dropletId !== undefined) {
        try { await step.runAction(internal.provision.cleanupDroplet, { dropletId }, { retry: RETRY }) }
        catch (e2) { await step.runMutation(internal.orders.noteError, { orderId, step: 'cleanup', message: e2 instanceof Error ? e2.message : String(e2) }) }
      }
      await step.runMutation(internal.orders.patch, { orderId, status: 'failed', detail: 'Setting up this Desk did not finish; we are on it.' })
      await step.runAction(internal.provision.opsAlert, {
        subject: `Desk provisioning failed: ${order.slug}`,
        html: `<p>${orderId} (${order.business}) failed: ${message}</p>`,
      }, { retry: RETRY }).catch(() => {})
    }
  },
})

/** Final snapshot, then the droplet and its DNS are gone. */
export const takeFinalSnapshot = internalAction({
  args: { dropletId: v.number(), slug: v.string() },
  handler: async (_ctx, { dropletId, slug }) => {
    const a = await doApi('POST', `/droplets/${dropletId}/actions`, { type: 'snapshot', name: `desk-${slug}-final-${nowIso().slice(0, 10)}` })
    return a.action?.id as number | undefined
  },
})

export const actionStatus = internalAction({
  args: { actionId: v.number() },
  handler: async (_ctx, { actionId }) => {
    const st = await doApi('GET', `/actions/${actionId}`)
    return { status: st.action?.status as string, resourceId: st.action?.resource_id as number | undefined }
  },
})

export const deleteDns = internalAction({
  args: { host: v.string() },
  handler: async (_ctx, { host }) => { await cfDnsDelete(host) },
})

export const destroyBox = workflow.define({
  args: { orderId: v.string() },
  handler: async (step, { orderId }): Promise<void> => {
    const order = await step.runQuery(internal.orders.byOrderId, { orderId })
    if (!order || order.status === 'destroyed') return
    // The console should say what is happening during the minutes the snapshot takes.
    await step.runMutation(internal.orders.patch, { orderId, detail: 'closing — final snapshot first' })

    if (order.dropletId) {
      // The final snapshot is the customer's 30-day safety net; a failure is
      // recorded, but a box we cannot snapshot is still a box we must stop billing.
      try {
        const actionId = await step.runAction(internal.provision.takeFinalSnapshot, {
          dropletId: order.dropletId, slug: order.slug,
        }, { retry: RETRY })
        if (actionId) {
          for (let i = 0; i < 120; i++) {
            await step.sleep(10000)
            const st = await step.runAction(internal.provision.actionStatus, { actionId }, { retry: RETRY })
            if (st.status === 'completed') {
              await step.runMutation(internal.orders.patch, { orderId, finalSnapshot: st.resourceId })
              break
            }
            if (st.status === 'errored') throw new Error('snapshot errored')
          }
        }
      } catch (e) {
        await step.runMutation(internal.orders.noteError, { orderId, step: 'final-snapshot', message: e instanceof Error ? e.message : String(e) })
      }
      try { await step.runAction(internal.provision.cleanupDroplet, { dropletId: order.dropletId }, { retry: RETRY }) }
      catch (e) { await step.runMutation(internal.orders.noteError, { orderId, step: 'droplet-delete', message: e instanceof Error ? e.message : String(e) }) }
    }
    if (order.host) {
      try { await step.runAction(internal.provision.deleteDns, { host: order.host }, { retry: RETRY }) }
      catch (e) { await step.runMutation(internal.orders.noteError, { orderId, step: 'dns-delete', message: e instanceof Error ? e.message : String(e) }) }
    }
    await step.runMutation(internal.orders.patch, { orderId, status: 'destroyed', destroyedNow: true })
    await step.runMutation(internal.secrets.clearPassword, { orderId })
    await step.runMutation(internal.orders.log, { actor: 'system', action: 'box-destroyed', orderId })
  },
})

export { retrier }
