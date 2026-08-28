// Usage: what this Desk has consumed, summed from the harness's own session
// projections (token counts per session). Reported on /deskd/status, in the
// heartbeat to webfacedesk.app, and on the owner's Business page.
import { readFileSync } from 'node:fs'
const FILE = process.env.DESK_PROJCACHE ?? `${process.env.DSH_HOME ?? '/srv/desk/home'}/storages/session_projcache.json`
const dayKey = (ms, tz) => new Date(ms).toLocaleDateString('en-CA', { timeZone: tz })
const monthKey = (ms, tz) => dayKey(ms, tz).slice(0, 7)
/** Sum every numeric *Tokens field found anywhere in a record. */
function sumTokens(node, acc) {
  if (node === null || typeof node !== 'object') return
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'number' && /tokens$/i.test(k)) acc[k] = (acc[k] ?? 0) + v
    else if (v && typeof v === 'object') sumTokens(v, acc)
  }
}
export function usage(tz = 'America/Toronto') {
  let table = {}
  try { table = JSON.parse(readFileSync(FILE, 'utf8')).tables?.sessions ?? {} } catch { return { sessions: 0, today: {}, month: {}, total: {} } }
  const now = Date.now(); const today = dayKey(now, tz), month = monthKey(now, tz)
  const out = { sessions: 0, today: {}, month: {}, total: {}, turns: 0 }
  for (const rec of Object.values(table)) {
    const created = Number(rec?.identity?.createdAt ?? 0); const rows = rec?.rows ?? {}
    const tu = rows.tokenUsage?.val; const st = rows.sessionStats?.val
    if (!tu) continue
    out.sessions++; out.turns += Number(st?.turns ?? 0)
    const acc = {}; sumTokens(tu.totals ?? tu, acc)
    for (const [k, v] of Object.entries(acc)) {
      out.total[k] = (out.total[k] ?? 0) + v
      if (created && dayKey(created, tz) === today) out.today[k] = (out.today[k] ?? 0) + v
      if (created && monthKey(created, tz) === month) out.month[k] = (out.month[k] ?? 0) + v
    }
  }
  // Billable = everything except cache reads (providers price those at a fraction); cache reads reported separately.
  const bill = o => Object.entries(o).filter(([k]) => k !== 'cacheReadTokens').reduce((a, [, v]) => a + v, 0)
  const cached = o => o.cacheReadTokens ?? 0
  return { ...out, todayTokens: bill(out.today), monthTokens: bill(out.month), totalTokens: bill(out.total), todayCached: cached(out.today), monthCached: cached(out.month) }
}
