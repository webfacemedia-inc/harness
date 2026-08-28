// Business profile: the one place the owner sets who Desk works for and how
// it behaves. Saved as profile.json, rendered into the workspace AGENTS.md
// (read by the model every turn) — nothing else writes that file.
import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { layout, ICONS } from './ui.js'

export const WORK = process.env.DESK_WORK_DIR ?? '/srv/desk/work'
export const PROFILE = process.env.DESK_PROFILE_FILE ?? join(dirname(WORK), 'profile.json')
const AGENTS = join(WORK, 'AGENTS.md')
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export const TONES = {
  friendly: 'Warm and friendly — first names, short sentences, no jargon.',
  professional: 'Professional and precise — courteous, complete, formal where it matters.',
  plain: 'Plain and direct — short, factual, no filler.',
}
export const APPROVALS = [
  ['send', 'Sending any email or message to a customer'],
  ['book', 'Booking, moving or cancelling appointments'],
  ['quote', 'Sending a quote or price'],
  ['pay', 'Paying, refunding or charging anything'],
  ['publish', 'Publishing to the website or social media'],
  ['delete', 'Deleting files or records'],
]

export function readProfile() {
  try { return JSON.parse(readFileSync(PROFILE, 'utf8')) } catch { return null }
}
export function isComplete(p) { return Boolean(p && p.business && p.does) }

/** Render the profile into the instructions the model reads every turn. */
export function renderAgents(p) {
  const approvals = APPROVALS.filter(([k]) => (p.approvals ?? []).includes(k)).map(([, label]) => `- ${label}`).join('\n')
  const rules = String(p.rules ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(l => `- ${l.replace(/^[-•*]\s*/, '')}`).join('\n')
  return `# ${p.business} — how this Desk works

## Who you are
You are Desk, the business assistant for ${p.business}${p.owner ? `, working for ${p.owner}` : ''}. Speak as the business, in the first person plural ("we"), never as a third party.

## The business
${p.does}
${p.address ? `\nAddress: ${p.address}` : ''}${p.area ? `\nArea served: ${p.area}` : ''}${p.hours ? `\nHours: ${p.hours}` : ''}${p.payment ? `\nPayment: ${p.payment}` : ''}${p.services ? `\n\nServices:\n${p.services}` : ''}${p.website ? `\nWebsite: ${p.website}` : ''}${p.phone ? `\nPhone: ${p.phone}` : ''}${p.email ? `\nEmail: ${p.email}` : ''}

## Tone
${TONES[p.tone] ?? TONES.friendly}${p.toneNotes ? `\n${p.toneNotes}` : ''}

## Always ask the owner first before
${approvals || '- Anything that leaves the business (sending, booking, paying, publishing, deleting)'}

## House rules
- Never invent prices, availability or policies. Prices come from \`price-list.md\` in this folder; if it is missing or silent, say so and ask.
- Nothing goes to a customer without the owner's approval: draft, show, wait.
- Customer-facing text never mentions "AI" or "generated".
- Connections (Gmail, Calendar) are set up by the owner from the Connections page — never tell them to run commands.
${rules ? rules + '\n' : ''}${p.notes ? `\n## Notes from the owner\n${p.notes}\n` : ''}
_Edit this from Desk → Business (never by hand; it is regenerated)._
`
}

export function saveProfile(p) {
  mkdirSync(dirname(PROFILE), { recursive: true }); mkdirSync(WORK, { recursive: true })
  writeFileSync(PROFILE, JSON.stringify({ ...p, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
  if (existsSync(AGENTS)) copyFileSync(AGENTS, AGENTS + '.bak')
  writeFileSync(AGENTS, renderAgents(p))
}

const field = (id, label, value, { type = 'text', ph = '', rows = 0, hint = '' } = {}) => `<label for="${id}">${label}${hint ? ` <small>${hint}</small>` : ''}</label>${rows ? `<textarea id="${id}" name="${id}" rows="${rows}" placeholder="${esc(ph)}">${esc(value)}</textarea>` : `<input id="${id}" name="${id}" type="${type}" value="${esc(value)}" placeholder="${esc(ph)}">`}`

export function page({ business, p, first = false, msg = '' }) {
  p = p ?? {}
  const body = `<h1>${first ? 'Tell Desk about your business' : 'Business'}</h1>
<p class="sub">${first ? 'Five minutes, once. Everything Desk says and does starts from this page — you can change it any time.' : 'What Desk knows about you and how it behaves. Saved instantly; every conversation uses the latest version.'}</p>
${msg ? `<div class="msg">${esc(msg)}</div>` : ''}
<form method="post" action="/profile">
<section><h2>${ICONS.business}The business</h2>
${field('business', 'Business name', p.business, { ph: 'Maple & Main Home Services' })}
${field('owner', 'Your name', p.owner, { ph: 'Dana Okafor', hint: '(who Desk works for)' })}
${field('does', 'What you do', p.does, { rows: 3, ph: 'Family-run plumbing and HVAC company: emergency plumbing, drain cleaning, water heaters, furnace and A/C service, maintenance plans for homes and small commercial buildings.' })}
${field('services', 'Services and typical prices', p.services, { rows: 4, ph: 'One per line. Leave prices out if you will upload a price list instead.', hint: '(optional)' })}
${field('address', 'Business address', p.address, { ph: '57 Finch Ave West, Toronto, ON M2N 0K9', hint: '(as it should appear on the website, Google and quotes)' })}
${field('area', 'Area served', p.area, { ph: 'Toronto and the west GTA — Etobicoke, Mississauga, Oakville, Brampton' })}
${field('hours', 'Hours', p.hours, { ph: 'Mon–Sat 7am–7pm; emergencies 24/7 by phone' })}
${field('payment', 'How you take payment', p.payment, { ph: 'Credit, debit, e-transfer; financing on installs over $2,500' })}
${field('website', 'Website', p.website, { type: 'url', ph: 'https://' })}
${field('phone', 'Business phone', p.phone, { type: 'tel' })}
${field('email', 'Business email', p.email, { type: 'email' })}
</section>
<section><h2>${ICONS.voice}How Desk speaks</h2><p class="h">Every reply, quote and confirmation uses this voice.</p>
<div class="tones">${Object.entries(TONES).map(([k, d]) => `<label><input type="radio" name="tone" value="${k}" ${(p.tone ?? 'friendly') === k ? 'checked' : ''}><span>${k[0].toUpperCase() + k.slice(1)}<small>${d}</small></span></label>`).join('')}</div>
${field('toneNotes', 'Anything else about the voice', p.toneNotes, { rows: 2, ph: 'e.g. Always sign off as "The Maple & Main team". Never use exclamation marks.', hint: '(optional)' })}
</section>
<section><h2>${ICONS.shield}Always ask you first before</h2><p class="h">Desk stops and waits for your approval on these. Untick only what you are happy for it to do on its own.</p>
<div class="checks">${APPROVALS.map(([k, label]) => `<label><input type="checkbox" name="approvals" value="${k}" ${(p.approvals ?? APPROVALS.map(a => a[0])).includes(k) ? 'checked' : ''}>${label}</label>`).join('')}</div>
</section>
<section><h2>${ICONS.rules}House rules</h2><p class="h">Things Desk must never say or promise, and anything it should always do. One per line.</p>
${field('rules', 'Rules', p.rules, { rows: 5, ph: 'Never promise same-day service.\nAlways offer the maintenance plan after a repair.\nQuotes are valid for 30 days.' })}
${field('notes', 'Anything else Desk should know', p.notes, { rows: 3, hint: '(optional)' })}
</section>
<button type="submit">${first ? 'Save and start' : 'Save'}</button>
</form>
${!first && isComplete(p) ? `<div class="next"><a class="btn ghost" href="/connections">${ICONS.plug} Connections</a><a class="btn ghost" href="/files">${ICONS.files} Files (price list)</a></div>` : ''}
`
  return layout({ title: 'Business', business, body })
}

export async function handle(req, res, u, { business, readBody }) {
  if (u.pathname === '/profile' && req.method === 'GET') {
    const p = readProfile()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(page({ business: p?.business ?? business, p, first: !isComplete(p), msg: u.searchParams.get('msg') ?? '' }))
  }
  if (u.pathname === '/profile' && req.method === 'POST') {
    const f = new URLSearchParams(await readBody(req))
    const get = k => (f.get(k) ?? '').trim().slice(0, 4000)
    const p = { business: get('business'), owner: get('owner'), does: get('does'), services: get('services'), address: get('address'), area: get('area'), hours: get('hours'), payment: get('payment'), website: get('website'), phone: get('phone'), email: get('email'), tone: TONES[get('tone')] ? get('tone') : 'friendly', toneNotes: get('toneNotes'), approvals: f.getAll('approvals').filter(k => APPROVALS.some(a => a[0] === k)), rules: get('rules'), notes: get('notes') }
    if (!p.business || !p.does) { res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page({ business, p, first: true, msg: 'Business name and what you do are needed.' })) }
    const wasComplete = isComplete(readProfile())
    saveProfile(p)
    res.writeHead(303, { location: wasComplete ? '/profile?msg=Saved.+Desk+uses+this+from+its+next+reply.' : '/connections?msg=' + encodeURIComponent('Saved. Desk now knows the business. Connect Google when you are ready, or go back to Desk and say hello.') }); return res.end()
  }
  return false
}
