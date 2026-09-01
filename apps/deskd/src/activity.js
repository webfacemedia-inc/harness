// The Activity page: what Desk asked to do, and what you said.
//
// The record comes from @webface/dsh-desk-activity, which follows the approval
// audit pair the harness already writes. This page only reads it — nothing here
// can change a decision after the fact.
import { readFileSync } from 'node:fs'
import { layout, ICONS, esc } from './ui.js'

const FILE = process.env.DESK_ACTIVITY_FILE ?? '/srv/desk/activity.json'
const read = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return { entries: [] } } }

const when = (iso, tz) => { try { return new Date(iso).toLocaleString('en-CA', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return String(iso ?? '') } }

// Tool names are for us, not the owner: say what was being asked for.
const ACTIONS = [
  [/mail|gmail|send_message|reply/i, 'send an email'],
  [/calendar|event|book/i, 'change your calendar'],
  [/drive|upload/i, 'put a file in Drive'],
  [/wordpress|publish|deploy/i, 'publish to your website'],
  [/delete|remove|trash/i, 'delete something'],
  [/bash|shell|terminal|command/i, 'run a command on this Desk'],
  [/write|edit|file/i, 'change a file'],
  [/browser|playwright|navigate|click/i, 'use the browser'],
  [/contact|crm/i, 'change your contacts'],
]
export const describe = tool => {
  const hit = ACTIONS.find(([re]) => re.test(String(tool ?? '')))
  return hit ? hit[1] : `use ${String(tool ?? 'a tool').replace(/[_-]+/g, ' ')}`
}

/**
 * How the owner reads an outcome. Kept to a few words on purpose: the pill sits
 * beside the action and does not wrap, so a sentence here squeezes the line it
 * belongs to into one word per line on a phone.
 */
export const outcomeOf = e => {
  if (e.outcome === 'allowed-once') return ['you allowed it', 'pill']
  if (e.outcome === 'rejected') return ['you said no', 'pill no']
  if (e.outcome === 'cancelled') return ['withdrawn', 'pill off']
  if (e.outcome === 'unavailable') return ['no one answered', 'pill off']   // nobody was there, so Desk stopped
  return ['waiting for you', 'pill off']
}

export function page({ business, tz = 'America/Toronto' }) {
  const { entries = [], updatedAt } = read()
  const rows = [...entries].reverse().map(e => {
    const [label, cls] = outcomeOf(e)
    return `<div class="row"><span><strong>Asked to ${esc(describe(e.tool))}</strong><small>${esc(when(e.askedAt, tz))}${e.reason ? ' · ' + esc(e.reason) : ''}</small></span><span class="${cls}">${esc(label)}</span></div>`
  }).join('')

  const body = `<h1>${ICONS.shield} Activity</h1><p class="sub">Every time Desk needed your say-so — what it wanted to do, and what you answered. Anything that leaves the business stops here first — and if no one answers, Desk stops rather than going ahead.</p>
<section>${rows || '<div class="empty">Nothing yet. Desk only asks when something leaves the business — sending, booking, paying, publishing, deleting.</div>'}</section>
${updatedAt ? `<p class="h">Updated ${esc(when(updatedAt, tz))} · the last 500 are kept.</p>` : ''}`
  return layout({ title: 'Activity', business, body })
}

export async function handle(req, res, u, { business, tz }) {
  if (u.pathname === '/activity' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(page({ business, tz }))
  }
  return false
}
