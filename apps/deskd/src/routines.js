// Routines: what Desk runs on a schedule, from the mirror the harness keeps.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { layout, ICONS, esc } from './ui.js'
const FILE = process.env.DESK_ROUTINES_FILE ?? '/srv/desk/routines.json'
const ACTIONS = process.env.DESK_ROUTINES_ACTIONS ?? '/srv/desk/routines-actions.json'
const read = () => { try { return JSON.parse(readFileSync(FILE, 'utf8')) } catch { return { routines: [] } } }
const every = s => s % 86400 === 0 ? `every ${s / 86400 === 1 ? 'day' : s / 86400 + ' days'}` : s % 3600 === 0 ? `every ${s / 3600 === 1 ? 'hour' : s / 3600 + ' hours'}` : `every ${Math.round(s / 60)} min`
const when = (iso, tz) => { try { return new Date(iso).toLocaleString('en-CA', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return iso } }
export function page({ business, tz = 'America/Toronto', msg }) {
  const { routines = [], updatedAt } = read()
  const rows = routines.map(r => `<div class="row"><span><strong>${esc(r.prompt.slice(0, 120))}${r.prompt.length > 120 ? '…' : ''}</strong><small>${r.kind === 'every' ? every(r.everySeconds) + ', next around ' + esc(when(r.scheduledAt, tz)) : 'once, ' + esc(when(r.scheduledAt, tz))}${r.lastRunAt ? ' · last ran ' + esc(when(r.lastRunAt, tz)) : ''}</small></span><form method="post" action="/routines/delete" style="margin:0"><input type="hidden" name="sessionId" value="${esc(r.sessionId)}"><input type="hidden" name="id" value="${esc(r.id)}"><button class="quiet" type="submit">Delete</button></form></div>`).join('')
  const body = `<h1>${ICONS.clock} Routines</h1><p class="sub">What Desk does on a schedule. To add one, tell Desk in chat — for example "every weekday at 8am, summarise new enquiries".</p>${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}<section>${rows || '<div class="empty">No routines yet.</div>'}</section>${updatedAt ? `<p class="h">Updated ${esc(when(updatedAt, tz))}</p>` : ''}`
  return layout({ title: 'Routines', business, body })
}
export async function handle(req, res, u, { business, readBody, tz }) {
  if (u.pathname === '/routines' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(page({ business, tz, msg: u.searchParams.get('msg') ?? '' })) }
  if (u.pathname === '/routines/delete' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req)); const sessionId = f.get('sessionId') ?? '', id = f.get('id') ?? ''
    if (!sessionId || !id) { res.writeHead(400); return res.end('which routine?') }
    let pending = []; try { pending = JSON.parse(readFileSync(ACTIONS, 'utf8')) } catch {}
    pending.push({ sessionId, id }); writeFileSync(ACTIONS, JSON.stringify(pending), { mode: 0o600 })
    res.writeHead(303, { location: '/routines?msg=' + encodeURIComponent('Deleting — it disappears from this list within a few seconds.') }); return res.end()
  }
  return false
}
