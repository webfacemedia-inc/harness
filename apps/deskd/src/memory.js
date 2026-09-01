// The Memory page: everything Desk has written down, and the owner's control of it.
//
// The ledger is the same append-only file the memory MCP server writes
// (apps/desk-memory), so this page shares that module rather than re-implementing
// the fold — one definition of what is remembered. Removing a note appends a
// tombstone and rewrites the block Desk reads at the start of each conversation,
// so a delete takes effect in the very next one.
import { layout, ICONS, esc } from './ui.js'
import { read, ranked, remove, setPinned, writeBlock, BUSINESS } from '../../desk-memory/src/ledger.js'
import { join } from 'node:path'

const LEDGER = process.env.DESK_MEMORY_FILE ?? '/srv/desk/memory.jsonl'
const BLOCK = process.env.DESK_MEMORY_BLOCK ?? join(process.env.DSH_HOME ?? '/srv/desk/home', 'AGENTS.md')
const BUDGET = Number(process.env.DESK_MEMORY_BUDGET ?? 4000)

const when = (iso, tz) => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }) } catch { return String(iso ?? '').slice(0, 10) } }
const refresh = () => { try { writeBlock(BLOCK, read(LEDGER), BUDGET) } catch { /* the page still worked; the next note rewrites it */ } }

export function page({ business, tz = 'America/Toronto', msg }) {
  const notes = ranked(read(LEDGER))
  const groups = new Map()
  for (const n of notes) {
    const key = n.about ?? BUSINESS
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(n)
  }
  const button = (id, op, label, cls) => `<form method="post" action="/memory/${op}" style="display:inline;margin:0"><input type="hidden" name="id" value="${esc(id)}"><button class="${cls}" type="submit">${label}</button></form>`
  const section = (about, list) => `<section><h2>${about === BUSINESS ? ICONS.business : ICONS.person}${esc(about === BUSINESS ? 'The business' : about)}</h2>${list.map(n => `<div class="row"><span><strong>${esc(n.text)}</strong><small>${esc(when(n.at, tz))} · ${esc(n.kind ?? 'fact')}${n.pinned ? ' · always kept' : ''}</small></span><span class="acts">${button(n.id, n.pinned ? 'unpin' : 'pin', n.pinned ? 'Unpin' : 'Keep', 'ghost')}${button(n.id, 'delete', 'Forget', 'quiet')}</span></div>`).join('')}</section>`

  const body = `<h1>${ICONS.rules} Memory</h1><p class="sub">What Desk has written down from your conversations — decisions, promises, prices quoted, how people like to be dealt with. Desk reads this at the start of every new conversation, so it doesn't ask you the same thing twice.</p>${msg ? `<div class="msg ok">${esc(msg)}</div>` : ''}
${notes.length === 0 ? '<section><div class="empty">Nothing yet. As you work with Desk it notes what was decided and promised, and tells you when it does.</div></section>' : [...groups.entries()].map(([about, list]) => section(about, list)).join('')}
<p class="h">Anything you forget here is gone from the next conversation. Desk never writes down card numbers or passwords.</p>`
  return layout({ title: 'Memory', business, body, head: '<style>.acts{display:flex;gap:6px;flex:none;align-items:center}.acts button{white-space:nowrap;margin:0}</style>' })
}

export async function handle(req, res, u, { business, readBody, tz }) {
  if (u.pathname === '/memory' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(page({ business, tz, msg: u.searchParams.get('msg') ?? '' }))
  }
  const op = ['delete', 'pin', 'unpin'].find(o => u.pathname === `/memory/${o}`)
  if (op && req.method === 'POST') {
    const id = new URLSearchParams(await readBody(req)).get('id') ?? ''
    if (!id) { res.writeHead(400); return res.end('which note?') }
    const note = read(LEDGER).find(n => n.id === id)
    if (!note) { res.writeHead(303, { location: '/memory?msg=' + encodeURIComponent('That note is already gone.') }); return res.end() }
    if (op === 'delete') remove(LEDGER, id); else setPinned(LEDGER, id, op === 'pin')
    refresh()
    const msg = op === 'delete' ? 'Forgotten — Desk will not bring that up again.' : op === 'pin' ? 'Desk will always keep that one in mind.' : 'No longer pinned.'
    res.writeHead(303, { location: '/memory?msg=' + encodeURIComponent(msg) })
    return res.end()
  }
  return false
}
