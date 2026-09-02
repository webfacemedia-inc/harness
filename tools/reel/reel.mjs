#!/usr/bin/env node
// The reel rig's director. One prospect at a time, five commands:
//   create  --brief brief.json --email x@y [--days 7] [--preview URL] [--slug s]
//   scenes  --slug <slug> [--skip-agent]
//   render  --slug <slug> [--music track.mp3]
//   publish --slug <slug>
//   status  --slug <slug> | destroy --slug <slug>
// State lives in work/<slug>/ (gitignored): state.json, scenes, stills,
// reel.json, the rendered mp4 + poster. Secrets stay in state.json on this
// Mac and on the page (unguessable path) — never in the repo or transcripts.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { basename } from 'node:path'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createDemo, demoStatus, credentials, boxAction, waitReady } from './lib/api.mjs'
import { templateFromBrief, enquiryFor, browserTaskFor } from './lib/template.mjs'
import { captureStills, siteScene, deskScene, agentScene, prepareAuth } from './lib/scenes.mjs'
import { renderPage } from './lib/page.mjs'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WORK = join(ROOT, 'work')
const APEX = process.env.REEL_APEX ?? 'root@143.198.42.231'

const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const has = (name) => args.includes(`--${name}`)

const statePath = (slug) => join(WORK, slug, 'state.json')
const loadState = (slug) => {
  const p = statePath(slug)
  if (!existsSync(p)) throw new Error(`no state for ${slug} — run create first`)
  return JSON.parse(readFileSync(p, 'utf8'))
}
const saveState = (state) => {
  mkdirSync(join(WORK, state.slug), { recursive: true })
  writeFileSync(statePath(state.slug), JSON.stringify(state, null, 2), { mode: 0o600 })
}

async function cmdCreate() {
  const briefPath = flag('brief')
  const email = flag('email')
  if (!briefPath || !email) throw new Error('create needs --brief brief.json and --email')
  const brief = JSON.parse(readFileSync(resolve(briefPath), 'utf8'))
  const days = Number(flag('days') ?? 7)
  const business = brief.business?.name ?? brief.name
  const prospect = flag('prospect') ?? brief.prospect ?? business
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()
  const template = templateFromBrief(brief, { contactEmail: email, expiresAt })
  const created = await createDemo({
    prospect, business, contactEmail: email, days,
    ...(flag('slug') ? { slug: flag('slug') } : {}),
    template,
  })
  console.log(`demo ${created.id} (${created.slug}) provisioning — this takes ~25 minutes`)
  await finishCreate(created.id, created.slug, brief, email)
}

// The tail of create, callable on its own: if create's poll was interrupted,
// `adopt --order <id> --brief ... --email ...` picks the same demo back up.
async function cmdAdopt() {
  const briefPath = flag('brief')
  const email = flag('email')
  const orderId = flag('order')
  if (!briefPath || !email || !orderId) throw new Error('adopt needs --order, --brief and --email')
  const brief = JSON.parse(readFileSync(resolve(briefPath), 'utf8'))
  const s = await demoStatus(orderId)
  await finishCreate(orderId, s.id && s.host ? s.host.split('.')[0] : (flag('slug') ?? ''), brief, email)
}

async function finishCreate(orderId, slug, brief, email) {
  const business = brief.business?.name ?? brief.name
  const prospect = flag('prospect') ?? brief.prospect ?? business
  const ready = await waitReady(orderId, { onTick: s => console.log(`  ${new Date().toISOString().slice(11, 19)} ${s.status}${s.detail ? ` — ${s.detail}` : ''}`) })
  const creds = await credentials(orderId)
  const state = {
    orderId, slug: slug || ready.host.split('.')[0], business, prospect, email,
    host: ready.host, expiresAt: ready.expiresAt,
    username: creds.username, password: creds.password, boxToken: creds.boxToken,
    siteUrl: brief.business?.website ?? undefined,
    previewUrl: flag('preview') ?? undefined,
    category: brief.business?.category ?? undefined,
    pageName: `${slug || ready.host.split('.')[0]}-${randomBytes(4).toString('hex')}`,
    hook: (brief.topGaps?.[0]?.talkingPoint ?? brief.topGaps?.[0]?.title) || undefined,
  }
  saveState(state)
  console.log(`ready: https://${state.host} — state in work/${state.slug}/state.json`)
  if (!state.password) console.log('NOTE: no password came back (already revealed?) — the desk scene and page need one')
}

async function cmdScenes() {
  const state = loadState(flag('slug') ?? '')
  const dir = join(WORK, state.slug)
  const enquiry = enquiryFor(state.category, state.business)
  const browserTask = state.siteUrl ? browserTaskFor(state.siteUrl) : undefined

  console.log('stills (before/after)…')
  const stills = await captureStills(state, join(dir, 'stills'))
  console.log('scene: site preview…')
  const site = await siteScene(state, dir)
  console.log('warming a chat session (once)…')
  const auth = await prepareAuth(state)
  console.log('scene: desk answers the enquiry…')
  const desk = await deskScene(state, dir, { enquiry, auth })
  let agent = null
  if (browserTask && !has('skip-agent')) {
    console.log('scene: the assistant works their site (box recorder)…')
    agent = await agentScene(state, dir, { browserTask, auth })
  }
  Object.assign(state, { scenes: { site, desk, agent, ...stills }, enquiry })
  saveState(state)
  console.log('scenes done:', JSON.stringify(state.scenes, null, 2))
}

async function cmdRender() {
  const state = loadState(flag('slug') ?? '')
  const dir = join(WORK, state.slug)
  const reelJson = join(dir, 'reel.json')
  if (!existsSync(reelJson)) {
    // A starting reel.json the session then tunes (beat copy per prospect).
    writeFileSync(reelJson, JSON.stringify(defaultReel(state), null, 2))
    console.log(`wrote ${reelJson} — tune the beat copy, then run render again`)
    return
  }
  const props = JSON.parse(readFileSync(reelJson, 'utf8'))
  // Remotion reads assets through video/public/ (staticFile) — stage this
  // prospect's scenes and stills there under their slug.
  const pub = join(ROOT, 'video', 'public', state.slug)
  mkdirSync(pub, { recursive: true })
  for (const f of Object.values(state.scenes ?? {})) {
    if (f && existsSync(f)) copyFileSync(f, join(pub, basename(f)))
  }
  const staged = { ...props, assetBase: state.slug }
  const stagedJson = join(dir, 'reel.staged.json')
  writeFileSync(stagedJson, JSON.stringify(staged))
  const out = join(dir, `${state.pageName}.mp4`)
  const entry = join(ROOT, 'video', 'src', 'index.ts')
  run('npx', ['remotion', 'render', entry, 'Reel', out, `--props=${stagedJson}`, '--codec=h264'], join(ROOT, 'video'))
  const poster = join(dir, `${state.pageName}-poster.jpg`)
  run('npx', ['remotion', 'still', entry, 'Reel', poster, `--props=${stagedJson}`, `--frame=${props.posterFrame ?? 30}`], join(ROOT, 'video'))
  const music = flag('music')
  if (music) {
    const mixed = join(dir, `${state.pageName}-music.mp4`)
    run('ffmpeg', ['-y', '-i', out, '-i', resolve(music), '-c:v', 'copy', '-map', '0:v', '-map', '1:a', '-shortest', mixed])
    copyFileSync(mixed, out)
  }
  console.log(`rendered ${out}`)
}

async function cmdPublish() {
  const state = loadState(flag('slug') ?? '')
  const dir = join(WORK, state.slug)
  const html = renderPage(state)
  const pageFile = join(dir, `${state.pageName}.html`)
  writeFileSync(pageFile, html)
  const mp4 = join(dir, `${state.pageName}.mp4`)
  const poster = join(dir, `${state.pageName}-poster.jpg`)
  for (const f of [mp4, poster]) if (!existsSync(f)) throw new Error(`${f} missing — run render first`)
  run('ssh', [APEX, 'mkdir -p /srv/desk/site/for'])
  run('scp', ['-q', pageFile, mp4, poster, `${APEX}:/srv/desk/site/for/`])
  run('ssh', [APEX, `chown caddy:caddy '/srv/desk/site/for/${state.pageName}.html' '/srv/desk/site/for/${state.pageName}.mp4' '/srv/desk/site/for/${state.pageName}-poster.jpg' && chmod 644 '/srv/desk/site/for/${state.pageName}'*`])
  state.pageUrl = `https://webfacedesk.app/for/${state.pageName}`
  saveState(state)
  console.log(`live: ${state.pageUrl}`)
}

async function cmdStatus() {
  const state = loadState(flag('slug') ?? '')
  const s = await demoStatus(state.orderId)
  console.log(JSON.stringify({ ...s, pageUrl: state.pageUrl ?? null }, null, 2))
}

async function cmdDestroy() {
  const state = loadState(flag('slug') ?? '')
  await boxAction(state.orderId, 'destroy')
  console.log(`destroy started for ${state.orderId} (${state.slug}) — final snapshot kept`)
}

/** The starting beat sheet; the session rewrites copy per prospect before render. */
function defaultReel(state) {
  const until = new Date(state.expiresAt).toLocaleDateString('en-CA', { month: 'long', day: 'numeric' })
  return {
    business: state.business,
    accent: '#3499cc',
    posterFrame: 30,
    beats: [
      { kind: 'hook', seconds: 4, title: state.business, line: state.hook ?? 'Your next customer just emailed. Who answers?' },
      ...(state.scenes?.before && state.scenes?.after
        ? [{ kind: 'beforeAfter', seconds: 8, before: basename(state.scenes.before), after: basename(state.scenes.after), line: 'We redesigned your site. Three directions, ready to look at.' }]
        : []),
      ...(state.scenes?.site ? [{ kind: 'clip', seconds: 8, src: basename(state.scenes.site), rate: 1.6, line: 'This is your new site — not a template, yours.' }] : []),
      ...(state.scenes?.desk ? [{ kind: 'clip', seconds: 18, src: basename(state.scenes.desk), rate: 2.2, line: `A customer writes in. Your Desk answers — as ${state.business}.` }] : []),
      ...(state.scenes?.agent ? [{ kind: 'clip', seconds: 10, src: basename(state.scenes.agent), rate: 2.0, line: 'And it works your website like an employee would.' }] : []),
      { kind: 'cta', seconds: 5, title: `Live until ${until}`, line: 'Your Desk is already running. Open the page below to meet it.' },
    ],
  }
}

function run(bin, a, cwd) {
  execFileSync(bin, a, { stdio: 'inherit', ...(cwd ? { cwd } : {}) })
}

const commands = { create: cmdCreate, adopt: cmdAdopt, scenes: cmdScenes, render: cmdRender, publish: cmdPublish, status: cmdStatus, destroy: cmdDestroy }
const fn = commands[cmd]
if (!fn) { console.error(`usage: reel <${Object.keys(commands).join('|')}> [flags]`); process.exit(2) }
fn().catch(e => { console.error(String(e.message ?? e)); process.exit(1) })
