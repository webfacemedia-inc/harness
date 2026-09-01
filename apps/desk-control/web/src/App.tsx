// The console: fleet, one box, demos, templates, audit — all on live queries.
// Every action is a Convex mutation that starts a workflow or a retried push.
import { useEffect, useState } from 'react'
import { SignInButton, UserButton, useUser } from '@clerk/clerk-react'
import { Authenticated, Unauthenticated, useAction, useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'

type View = { page: 'fleet' } | { page: 'box'; orderId: string } | { page: 'demos' } | { page: 'templates' } | { page: 'audit' }

const ago = (iso?: string | null) => {
  if (!iso) return '—'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 90) return `${s}s ago`
  if (s < 5400) return `${Math.round(s / 60)}m ago`
  if (s < 129600) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
const untilDays = (iso: string) => Math.max(0, (Date.parse(iso) - Date.now()) / 86400000)
const k = (n?: number) => `${Math.round((n ?? 0) / 1000)}k`

function StatusPill({ status, billing }: { status: string; billing?: string }) {
  const cls = status === 'ready' ? '' : status === 'failed' ? 'no' : status === 'destroyed' ? 'off' : 'warn'
  return <>
    <span className={`pill ${cls}`}>{status}</span>
    {billing && billing !== 'ok' ? <> <span className="pill no">{billing}</span></> : null}
  </>
}

export function App() {
  const [view, setView] = useState<View>({ page: 'fleet' })
  const { user } = useUser()
  return <>
    <Unauthenticated>
      <div className="gate"><div className="card">
        <h1 style={{ fontSize: 24 }}>webfaCe <em style={{ fontFamily: 'Fraunces,Georgia,serif', fontStyle: 'normal', color: 'var(--deep)' }}>Desk Control</em></h1>
        <p className="sub">The fleet, its demos and its history — sign in to operate.</p>
        <SignInButton mode="modal"><button className="btn">Sign in</button></SignInButton>
      </div></div>
    </Unauthenticated>
    <Authenticated>
      <div className="top">
        <span className="wm"><span className="wf">webfaCe</span><em>Desk Control</em></span>
        <nav>
          {(['fleet', 'demos', 'templates', 'audit'] as const).map(p =>
            <button key={p} className={view.page === p || (p === 'fleet' && view.page === 'box') ? 'on' : ''} onClick={() => setView({ page: p })}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>)}
        </nav>
        <span className="who">{user?.primaryEmailAddress?.emailAddress}</span>
        <UserButton />
      </div>
      <main>
        {view.page === 'fleet' && <Fleet open={orderId => setView({ page: 'box', orderId })} />}
        {view.page === 'box' && <BoxDetail orderId={view.orderId} back={() => setView({ page: 'fleet' })} />}
        {view.page === 'demos' && <Demos open={orderId => setView({ page: 'box', orderId })} />}
        {view.page === 'templates' && <Templates />}
        {view.page === 'audit' && <Audit />}
      </main>
    </Authenticated>
  </>
}

function Fleet({ open }: { open: (orderId: string) => void }) {
  const orders = useQuery(api.orders.list)
  const [creating, setCreating] = useState(false)
  if (orders === undefined) return <p className="sub">Loading the fleet…</p>
  const live = orders.filter(o => o.status !== 'destroyed')
  const gone = orders.filter(o => o.status === 'destroyed')
  return <>
    <h1>Fleet</h1>
    <p className="sub">{live.length} Desk{live.length === 1 ? '' : 's'} running. Everything updates live.</p>
    <section>
      <h2>Boxes <span style={{ marginLeft: 'auto' }}><button className="btn" onClick={() => setCreating(true)}>New Desk</button></span></h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="stack">
          <thead><tr><th>Business</th><th>Address</th><th>Status</th><th>Heartbeat</th><th>This month</th></tr></thead>
          <tbody>
            {live.map(o => <tr key={o.orderId} className="click" onClick={() => open(o.orderId)}>
              <td data-label="Business"><strong>{o.business}</strong><br /><small style={{ color: 'var(--mute)' }}>{o.demo ? `${o.plan} · demo, ${untilDays(o.demo.expiresAt).toFixed(1)}d left` : o.plan === o.kind ? o.plan : `${o.plan} · ${o.kind}`}</small></td>
              <td data-label="Address">{o.host ?? o.slug}</td>
              <td data-label="Status"><StatusPill status={o.status} billing={o.billing} />{o.lastError ? <><br /><small style={{ color: 'var(--err)' }}>{o.lastError.step}: {o.lastError.message.slice(0, 60)}</small></> : null}</td>
              <td data-label="Heartbeat">{ago(o.heartbeat?.at)}{o.heartbeat && !o.heartbeat.harness ? <><br /><small style={{ color: 'var(--err)' }}>harness down</small></> : null}</td>
              <td data-label="This month">{k(o.heartbeat?.usage?.monthTokens)} tokens<br /><small style={{ color: 'var(--mute)' }}>{o.heartbeat?.usage?.sessions ?? 0} conversations</small></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {gone.length > 0 && <p className="sub" style={{ marginTop: 10 }}>{gone.length} closed Desk{gone.length === 1 ? '' : 's'} in the audit history.</p>}
    </section>
    {creating && <CreateBox done={() => setCreating(false)} />}
  </>
}

function CreateBox({ done }: { done: () => void }) {
  const createBox = useMutation(api.ops.createBox)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  return <section>
    <h2>New Desk</h2>
    <form onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg('')
      const f = new FormData(e.currentTarget)
      try {
        const out = await createBox({
          business: String(f.get('business')), email: String(f.get('email')),
          plan: f.get('plan') === 'operators' ? 'operators' : 'business',
          kind: f.get('kind') === 'internal' ? 'internal' : 'paid',
          slug: String(f.get('slug') || '') || undefined,
        })
        setMsg(`Building ${out.slug} — welcome page: ${out.welcome}`)
      } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
      setBusy(false)
    }}>
      <div className="grid2">
        <div><label>Business</label><input name="business" required maxLength={80} /></div>
        <div><label>Owner email</label><input name="email" type="email" required /></div>
        <div><label>Plan</label><select name="plan"><option value="business">Business</option><option value="operators">Operators</option></select></div>
        <div><label>Kind</label><select name="kind"><option value="paid">Paid (set up by hand)</option><option value="internal">Internal</option></select></div>
        <div><label>Address (optional)</label><input name="slug" pattern="[a-z0-9-]{2,24}" placeholder="maple-main" /></div>
      </div>
      {msg && <div className={`msg ${msg.startsWith('Building') ? 'ok' : 'err'}`}>{msg}</div>}
      <div className="acts">
        <button className="btn" disabled={busy} type="submit">Create — a real box starts building</button>
        <button className="ghost" type="button" onClick={done}>Close</button>
      </div>
    </form>
  </section>
}

function BoxDetail({ orderId, back }: { orderId: string; back: () => void }) {
  const box = useQuery(api.orders.get, { orderId })
  const boxAction = useMutation(api.ops.boxAction)
  const restartBox = useMutation(api.ops.restartBox)
  const [msg, setMsg] = useState('')
  const act = async (fn: () => Promise<unknown>, okMsg: string) => {
    setMsg('')
    try { await fn(); setMsg(okMsg) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  if (box === undefined) return <p className="sub">Loading…</p>
  if (box === null) return <p className="sub">No such order. <button className="ghost" onClick={back}>Back</button></p>
  return <>
    <h1>{box.business}</h1>
    <p className="sub"><button className="ghost" onClick={back}>← Fleet</button>  {box.host ? <a href={`https://${box.host}/`} target="_blank" rel="noreferrer">{box.host}</a> : box.slug} · {box.plan} · {box.kind}</p>
    {msg && <div className={`msg ${/failed|not|error/i.test(msg) ? 'err' : 'ok'}`}>{msg}</div>}

    <section>
      <h2>State</h2>
      <div className="row"><span>Status</span><span><StatusPill status={box.status} billing={box.billing} /></span></div>
      <div className="row"><span>Heartbeat</span><span>{ago(box.heartbeat?.at)}{box.heartbeat ? ` · harness ${box.heartbeat.harness ? 'up' : 'DOWN'} · ${box.heartbeat.google} Google account${box.heartbeat.google === 1 ? '' : 's'}` : ''}</span></div>
      <div className="row"><span>Usage this month</span><span>{k(box.heartbeat?.usage?.monthTokens)} tokens · {box.heartbeat?.usage?.sessions ?? 0} conversations</span></div>
      <div className="row"><span>Droplet</span><span className="mono">{box.dropletId ?? '—'} {box.ip ? `· ${box.ip}` : ''}</span></div>
      <div className="row"><span>Last snapshot</span><span>{ago(box.lastSnapshot)}</span></div>
      {box.lastError && <div className="row"><span>Last error</span><span style={{ color: 'var(--err)' }}>{box.lastError.step}: {box.lastError.message}<br /><small>{ago(box.lastError.at)}</small></span></div>}
      <div className="acts">
        {box.status === 'ready' && (box.billing === 'past_due' || box.billing === 'cancelled'
          ? <button className="ghost" onClick={() => act(() => boxAction({ orderId, op: 'resume' }), 'Resumed — the box is being told.')}>Resume</button>
          : <button className="ghost" onClick={() => act(() => boxAction({ orderId, op: 'pause' }), 'Paused — the box is being told.')}>Pause</button>)}
        <button className="ghost" onClick={() => act(() => boxAction({ orderId, op: 'snapshot' }), 'Snapshot started.')}>Snapshot now</button>
        <button className="ghost" onClick={() => act(() => boxAction({ orderId, op: 'resend' }), 'Welcome email resent.')}>Resend welcome</button>
        <button className="ghost" onClick={() => act(() => restartBox({ orderId }), 'Restarting the Desk services on the box.')}>Restart Desk services</button>
        {(box.status === 'failed') && <button className="ghost" onClick={() => act(() => boxAction({ orderId, op: 'retry-provision' }), 'Provisioning restarted — watch the status.')}>Retry provisioning</button>}
        {box.status !== 'destroyed' && <button className="quiet" onClick={() => { if (confirm(`Destroy ${box.slug}? A final snapshot is kept 30 days; the box and its address are gone.`)) void act(() => boxAction({ orderId, op: 'destroy' }), 'Destroying — final snapshot first.') }}>Destroy</button>}
      </div>
    </section>

    {box.demo && <DemoCard orderId={orderId} demo={box.demo} usageDaily={box.usageDaily} />}
    {box.status === 'ready' && <TemplateTools orderId={orderId} business={box.business} />}
    <ConfigEditor orderId={orderId} />
    {box.status === 'ready' && <Recorder orderId={orderId} />}
  </>
}

type DemoInfo = { prospect: string; expiresAt: string; extendedCount: number; convertedAt?: string }
type DailyUse = Array<{ day: string; sessions: number; turns: number }>
function DemoCard({ orderId, demo, usageDaily }: { orderId: string; demo: DemoInfo & { templateId?: string }; usageDaily: DailyUse }) {
  const extend = useMutation(api.demos.extendDemo)
  const convert = useAction(api.demos.convertLink)
  const templates = useQuery(api.demos.listTemplates)
  const seededFrom = demo.templateId ? templates?.find(t => t._id === demo.templateId)?.name : undefined
  const [msg, setMsg] = useState('')
  const max = Math.max(...usageDaily.map(d => d.turns), 1)
  return <section>
    <h2>Demo for {demo.prospect}</h2>
    {seededFrom && <div className="row"><span>Seeded from</span><span>{seededFrom} — shown under "On this Desk" below</span></div>}
    <div className="row"><span>Expires</span><span>{demo.convertedAt ? 'converted to paid' : `${untilDays(demo.expiresAt).toFixed(1)} days (${new Date(demo.expiresAt).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`}{demo.extendedCount > 0 ? ` · extended ×${demo.extendedCount}` : ''}</span></div>
    <div className="row"><span>Activity<br /><small>turns per day — counters only, never content</small></span>
      <span className="spark">{usageDaily.slice(-14).map(d => <i key={d.day} title={`${d.day}: ${d.sessions} conversations, ${d.turns} turns`} style={{ height: `${Math.max(6, (d.turns / max) * 36)}px` }} />)}</span></div>
    {msg && <div className={`msg ${msg.startsWith('http') ? 'ok' : 'err'}`}>{msg.startsWith('http') ? <>Checkout link (send it to {demo.prospect}): <a href={msg} target="_blank" rel="noreferrer">{msg.slice(0, 60)}…</a></> : msg}</div>}
    {!demo.convertedAt && <div className="acts">
      <button className="ghost" onClick={() => { void extend({ orderId, days: 7 }).then(() => setMsg('')).catch(e => setMsg(String(e))) }}>Extend 7 days</button>
      <button className="btn" onClick={() => { void convert({ orderId }).then(url => setMsg(url)).catch(e => setMsg(String(e))) }}>Convert to paid — get the checkout link</button>
    </div>}
  </section>
}

function TemplateTools({ orderId, business }: { orderId: string; business: string }) {
  const templates = useQuery(api.demos.listTemplates)
  const capture = useAction(api.push.captureTemplate)
  const reset = useAction(api.push.resetBox)
  const [msg, setMsg] = useState('')
  const [resetId, setResetId] = useState('')
  return <section>
    <h2>Templates</h2>
    <p className="sub" style={{ marginBottom: 6 }}>Capture this Desk's setup as the rehearsed default, or put the Desk back to one.</p>
    {msg && <div className={`msg ${/saved|reset/i.test(msg) ? 'ok' : 'err'}`}>{msg}</div>}
    <div className="acts">
      <button className="ghost" onClick={() => {
        const name = prompt('Template name', `${business} default`)
        if (!name) return
        setMsg('')
        void capture({ orderId, name }).then(() => setMsg(`Saved "${name}" — profile, brand, price list and memory captured from this Desk.`))
          .catch(e => setMsg(e instanceof Error ? e.message : String(e)))
      }}>Save as template…</button>
      <select style={{ width: 'auto', minWidth: 160 }} value={resetId} onChange={e => setResetId(e.target.value)}>
        <option value="">Reset to…</option>
        {templates?.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
      </select>
      <button className="quiet" disabled={!resetId} onClick={() => {
        const t = templates?.find(x => x._id === resetId)
        if (!t) return
        if (!confirm(`Reset this Desk to "${t.name}"? Its profile, brand and price list are overwritten, and everything Desk has remembered since is REPLACED by the template's seeds.`)) return
        setMsg('')
        void reset({ orderId, templateId: resetId as Id<'demoTemplates'> }).then(() => setMsg(`Reset to "${t.name}".`))
          .catch(e => setMsg(e instanceof Error ? e.message : String(e)))
      }}>Reset</button>
    </div>
  </section>
}

type BoxConfig = {
  profile?: Record<string, string>
  brand?: { primary?: string; accent?: string; font?: string; tagline?: string }
  priceListMd?: string
  memory?: Array<{ kind: string; about?: string; text: string; pinned?: boolean }>
}

function ConfigEditor({ orderId }: { orderId: string }) {
  const pushConfig = useMutation(api.push.pushConfig)
  const logoUploadUrl = useMutation(api.push.logoUploadUrl)
  const pushLogo = useAction(api.push.pushLogo)
  const readBoxConfig = useAction(api.push.readBoxConfig)
  const [msg, setMsg] = useState('')
  const [tagline, setTagline] = useState('')
  const [current, setCurrent] = useState<BoxConfig | null | 'unreachable'>(null)
  useEffect(() => {
    let live = true
    readBoxConfig({ orderId })
      .then((c) => { if (!live) return; setCurrent(c as BoxConfig); setTagline((c as BoxConfig).brand?.tagline ?? '') })
      .catch(() => { if (live) setCurrent('unreachable') })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per box; the action ref is not stable in tests
  }, [orderId])
  const cur = current !== null && current !== 'unreachable' ? current : undefined
  return <>
    {cur && ((cur.memory?.length ?? 0) > 0 || cur.priceListMd) && <section>
      <h2>On this Desk</h2>
      <p className="sub" style={{ marginBottom: 6 }}>What it holds right now — the seed it was born with plus everything since.</p>
      {(cur.memory?.length ?? 0) > 0 && <>
        <label style={{ margin: '4px 0 6px' }}>Memory ({cur.memory!.length} note{cur.memory!.length === 1 ? '' : 's'})</label>
        {cur.memory!.map((m, i) => <div className="row" key={i}>
          <span><strong>{m.text}</strong><small>{m.about && m.about !== 'business' ? `${m.about} · ` : ''}{m.kind}{m.pinned ? ' · always kept' : ''}</small></span>
        </div>)}
      </>}
      {cur.priceListMd && <>
        <label style={{ margin: '10px 0 6px' }}>Price list ({cur.priceListMd.length} chars)</label>
        <pre style={{ maxHeight: 180, overflow: 'auto', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap' }}>{cur.priceListMd.slice(0, 2000)}</pre>
      </>}
    </section>}
    <section>
      <h2>Configure &amp; brand</h2>
      <p className="sub" style={{ marginBottom: 6 }}>
        {current === null ? 'Reading what the box holds…' : current === 'unreachable' ? 'The box did not answer — fields start blank; a push still lands when it wakes.' : 'Loaded from the box. Change what you like and push.'}
      </p>
      <form onSubmit={async (e) => {
        e.preventDefault(); setMsg('')
        const f = new FormData(e.currentTarget)
        const val = (n: string) => { const s = String(f.get(n) ?? '').trim(); return s || undefined }
        try {
          await pushConfig({
            orderId,
            profile: { business: val('business'), does: val('does'), phone: val('phone'), email: val('email'), website: val('website'), hours: val('hours') },
            brand: { primary: val('primary'), accent: val('accent'), font: val('font') as 'editorial' | 'classic' | 'plain' | undefined, tagline: val('tagline') },
          })
          setMsg('Pushed — the box applies it within seconds (retried if it is asleep).')
        } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
      }}>
        <div className="grid2">
          <div><label>Business name</label><input name="business" key={`b${cur?.profile?.business ?? ''}`} defaultValue={cur?.profile?.business ?? ''} /></div>
          <div><label>What they do</label><input name="does" key={`d${cur?.profile?.does ?? ''}`} defaultValue={cur?.profile?.does ?? ''} /></div>
          <div><label>Phone</label><input name="phone" key={`p${cur?.profile?.phone ?? ''}`} defaultValue={cur?.profile?.phone ?? ''} /></div>
          <div><label>Email</label><input name="email" key={`e${cur?.profile?.email ?? ''}`} defaultValue={cur?.profile?.email ?? ''} /></div>
          <div><label>Website</label><input name="website" key={`w${cur?.profile?.website ?? ''}`} defaultValue={cur?.profile?.website ?? ''} /></div>
          <div><label>Hours</label><input name="hours" key={`h${cur?.profile?.hours ?? ''}`} defaultValue={cur?.profile?.hours ?? ''} /></div>
          <div><label>Primary colour</label><input type="color" className="colour" name="primary" key={`p${cur?.brand?.primary ?? ''}`} defaultValue={cur?.brand?.primary ?? '#3499cc'} /></div>
          <div><label>Accent colour</label><input type="color" className="colour" name="accent" key={`a${cur?.brand?.accent ?? ''}`} defaultValue={cur?.brand?.accent ?? '#1f6f99'} /></div>
          <div><label>Font</label><select name="font" key={`f${cur?.brand?.font ?? ''}`} defaultValue={cur?.brand?.font ?? ''}><option value="">(keep)</option><option value="editorial">Editorial</option><option value="classic">Classic</option><option value="plain">Plain</option></select></div>
          <div><label>Tagline</label><input name="tagline" value={tagline} onChange={e => setTagline(e.target.value)} placeholder="Fast, tidy, guaranteed." /></div>
        </div>
        {msg && <div className={`msg ${/Pushed|Logo/.test(msg) ? 'ok' : 'err'}`}>{msg}</div>}
        <div className="acts">
          <button className="btn" type="submit">Push to the box</button>
          <label className="ghost" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          Upload logo…
            <input type="file" accept=".png,.jpg,.jpeg,.svg,.webp" style={{ display: 'none' }} onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setMsg('')
              try {
                const url = await logoUploadUrl()
                const up = await fetch(url, { method: 'POST', headers: { 'content-type': file.type || 'application/octet-stream' }, body: file })
                const { storageId } = await up.json() as { storageId: Id<'_storage'> }
                await pushLogo({ orderId, storageId, filename: file.name })
                setMsg('Logo pushed — every new document wears it.')
              } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
            }} />
          </label>
        </div>
      </form>
    </section>
  </>
}

function Recorder({ orderId }: { orderId: string }) {
  const record = useAction(api.push.record)
  const recordingUrl = useAction(api.push.recordingUrl)
  const [state, setState] = useState<{ recording: boolean; recordings: Array<{ file: string; bytes: number; at: string }> } | null>(null)
  const [msg, setMsg] = useState('')
  const refresh = async () => {
    try { setState(await record({ orderId, op: 'list' }) as never) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { void refresh() }, [orderId])  // eslint-disable-line react-hooks/exhaustive-deps -- one load per box
  return <section>
    <h2>Screen recording</h2>
    <p className="sub" style={{ marginBottom: 6 }}>Records the Desk's own screen (its browser) — for a chat walkthrough, open the Desk in it first. Files stay on the box 30 days; Download fetches the mp4 here.</p>
    {msg && <div className="msg err">{msg}</div>}
    <div className="acts">
      <button className="ghost" onClick={() => { void record({ orderId, op: 'open-desk' }).then(refresh).catch(e => setMsg(String(e))) }}>Open the Desk on its screen</button>
      {state?.recording
        ? <button className="quiet" onClick={() => { void record({ orderId, op: 'stop' }).then(refresh).catch(e => setMsg(String(e))) }}>■ Stop recording</button>
        : <button className="btn" onClick={() => { void record({ orderId, op: 'start' }).then(refresh).catch(e => setMsg(String(e))) }}>● Record</button>}
      <button className="ghost" onClick={() => void refresh()}>Refresh list</button>
    </div>
    {state && state.recordings.length === 0 && <p className="sub" style={{ margin: '10px 0 0' }}>No recordings on this box yet.</p>}
    {state && state.recordings.length > 0 && <div style={{ marginTop: 10 }}>
      {state.recordings.map(r => <div className="row" key={r.file}>
        <span className="mono">{r.file}<small>{r.bytes >= 1048576 ? `${(r.bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(r.bytes / 1024))} KB`} · {ago(r.at)}</small></span>
        <button className="ghost" onClick={() => {
          void recordingUrl({ orderId, file: r.file }).then((url) => { if (url) window.open(url, '_blank'); else setMsg('The link could not be made — is the box up?') }).catch(e => setMsg(String(e)))
        }}>Download</button>
      </div>)}
    </div>}
  </section>
}

function Demos({ open }: { open: (orderId: string) => void }) {
  const orders = useQuery(api.orders.list)
  const templates = useQuery(api.demos.listTemplates)
  const createDemo = useMutation(api.demos.createDemo)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  if (orders === undefined) return <p className="sub">Loading…</p>
  const demos = orders.filter(o => o.kind === 'demo' || o.demo)
  return <>
    <h1>Demos</h1>
    <p className="sub">A real Desk per prospect, on a clock: it warns a day before the end and tears itself down (snapshot kept).</p>
    <section>
      <h2>New demo</h2>
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setMsg('')
        const f = new FormData(e.currentTarget)
        try {
          const out = await createDemo({
            prospect: String(f.get('prospect')), business: String(f.get('business')),
            contactEmail: String(f.get('contactEmail') || '') || undefined,
            templateId: (String(f.get('templateId') || '') || undefined) as Id<'demoTemplates'> | undefined,
            days: Number(f.get('days') || 7),
          })
          setMsg(`Building demo Desk ${out.slug} — it appears in the fleet as it provisions.`)
        } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
        setBusy(false)
      }}>
        <div className="grid2">
          <div><label>Prospect</label><input name="prospect" required placeholder="Dana Okafor" /></div>
          <div><label>Business</label><input name="business" required placeholder="Maple & Main Plumbing" /></div>
          <div><label>Prospect email (optional)</label><input name="contactEmail" type="email" /></div>
          <div><label>Template</label><select name="templateId"><option value="">(blank Desk)</option>{templates?.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}</select></div>
          <div><label>Days</label><input name="days" type="number" min={1} max={60} defaultValue={7} /></div>
        </div>
        {msg && <div className={`msg ${msg.startsWith('Building') ? 'ok' : 'err'}`}>{msg}</div>}
        <div className="acts"><button className="btn" disabled={busy} type="submit">Create demo Desk</button></div>
      </form>
    </section>
    <div className="cards">
      {demos.map(o => <div className="card click" key={o.orderId} onClick={() => open(o.orderId)} style={{ cursor: 'pointer' }}>
        <h3>{o.demo?.prospect ?? o.business}</h3>
        <div className="small">{o.business} · {o.host ?? o.slug}</div>
        <div style={{ margin: '8px 0' }}><StatusPill status={o.status} billing={o.billing} /></div>
        <div className="small">
          {o.demo?.convertedAt ? <span className="pill">converted to paid</span>
            : o.status === 'destroyed' ? 'ended'
              : o.demo ? <>ends in <span className="count">{untilDays(o.demo.expiresAt).toFixed(1)}</span> days</> : null}
        </div>
        <div className="small" style={{ marginTop: 6 }}>last active {ago(o.heartbeat?.at)} · {o.heartbeat?.usage?.sessions ?? 0} conversations</div>
      </div>)}
      {demos.length === 0 && <p className="sub">No demos yet.</p>}
    </div>
  </>
}

function Templates() {
  const templates = useQuery(api.demos.listTemplates)
  const save = useMutation(api.demos.saveTemplate)
  const [msg, setMsg] = useState('')
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  return <>
    <h1>Demo templates</h1>
    <p className="sub">The rehearsed starting state a demo Desk is born with: who the business is, its brand, its price list, and what Desk already remembers.</p>
    {templates?.map(t => <section key={t._id}>
      <h2>{t.name} <span style={{ marginLeft: 'auto' }}><button className="ghost" onClick={() => setEditing(t as never)}>Edit</button></span></h2>
      <p className="sub" style={{ margin: 0 }}>{t.profile.business} · {(t.memorySeeds ?? []).length} memory seeds · {(t.seedFiles ?? []).length + (t.priceListMd ? 1 : 0)} files</p>
    </section>)}
    <section>
      <h2>{editing ? `Edit: ${String(editing.name)}` : 'New template'}</h2>
      <form key={String(editing?._id ?? 'new')} onSubmit={async (e) => {
        e.preventDefault(); setMsg('')
        const f = new FormData(e.currentTarget)
        try {
          const memorySeeds = JSON.parse(String(f.get('memorySeeds') || '[]'))
          await save({
            id: (editing?._id ?? undefined) as Id<'demoTemplates'> | undefined,
            name: String(f.get('name')),
            profile: { business: String(f.get('business')), does: String(f.get('does') || '') || undefined, phone: String(f.get('phone') || '') || undefined },
            brand: { primary: String(f.get('primary') || '') || undefined, tagline: String(f.get('tagline') || '') || undefined },
            priceListMd: String(f.get('priceListMd') || '') || undefined,
            memorySeeds,
          })
          setMsg('Saved.'); setEditing(null)
        } catch (err) { setMsg(err instanceof Error ? err.message : String(err)) }
      }}>
        <div className="grid2">
          <div><label>Template name</label><input name="name" required defaultValue={String(editing?.name ?? '')} /></div>
          <div><label>Business</label><input name="business" required defaultValue={String((editing?.profile as Record<string, unknown>)?.business ?? '')} /></div>
          <div><label>What they do</label><input name="does" defaultValue={String((editing?.profile as Record<string, unknown>)?.does ?? '')} /></div>
          <div><label>Phone</label><input name="phone" defaultValue={String((editing?.profile as Record<string, unknown>)?.phone ?? '')} /></div>
          <div><label>Brand primary</label><input name="primary" placeholder="3499cc" defaultValue={String((editing?.brand as Record<string, unknown>)?.primary ?? '')} /></div>
          <div><label>Tagline</label><input name="tagline" defaultValue={String((editing?.brand as Record<string, unknown>)?.tagline ?? '')} /></div>
        </div>
        <label>Price list (markdown — lands as price-list.md)</label>
        <textarea name="priceListMd" defaultValue={String(editing?.priceListMd ?? '')} />
        <label>Memory seeds (JSON: {'[{"kind","about","text","pinned"}]'})</label>
        <textarea name="memorySeeds" defaultValue={JSON.stringify(editing?.memorySeeds ?? [], null, 1)} />
        {msg && <div className={`msg ${msg === 'Saved.' ? 'ok' : 'err'}`}>{msg}</div>}
        <div className="acts">
          <button className="btn" type="submit">{editing ? 'Save changes' : 'Create template'}</button>
          {editing && <button className="ghost" type="button" onClick={() => setEditing(null)}>New instead</button>}
        </div>
      </form>
    </section>
  </>
}

function Audit() {
  const feed = useQuery(api.orders.auditFeed, { limit: 200 })
  return <>
    <h1>Audit</h1>
    <p className="sub">Every consequential act — yours, Stripe's, the system's, a box's.</p>
    <section>
      <div style={{ overflowX: 'auto' }}>
        <table className="audit">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>Order</th><th>Detail</th></tr></thead>
          <tbody>
            {feed?.map(a => <tr key={a._id}>
              <td>{ago(a.at)}</td>
              <td><span className={`pill ${a.actor === 'ops' ? '' : 'off'}`}>{a.actor}</span></td>
              <td>{a.action}</td>
              <td className="mono">{a.orderId ?? ''}</td>
              <td>{a.detail ?? ''}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </>
}
