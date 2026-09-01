// deskapi and desk-memory are plain-JS Node apps: they ship as source to the box with no build step, sit
// outside both TypeScript programs, and their sources are unlinted like every other **/*.js here. These
// tests are .ts only because the vitest include glob is *.spec.ts, which leaves every value crossing the
// import boundary untyped — the rules disabled below report that boundary, never a defect.
/* oxlint-disable typescript/no-unsafe-assignment */
/* oxlint-disable typescript/no-unsafe-call */
/* oxlint-disable typescript/no-unsafe-member-access */
/* oxlint-disable typescript/no-unsafe-return */
/* oxlint-disable typescript/no-unsafe-argument */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_BUDGET, append, clean, compact, newId, read, ranked,
  refuse, remove, renderBlock, search, setPinned, writeBlock,
} from '../src/ledger.js'

const dirs: string[] = []
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'desk-memory-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const note = (over: Record<string, unknown> = {}) => ({
  id: newId(), at: '2026-08-12T10:00:00.000Z', kind: 'commitment', about: 'Dana Reeves',
  text: 'Quoted $2,400 for the website rebuild', pinned: false, ...over,
})

describe('the ledger keeps what still stands', () => {
  it('folds a tombstone: a forgotten note is gone', () => {
    const file = join(scratch(), 'memory.jsonl')
    const kept = append(file, note()), dropped = append(file, note({ text: 'wrong number' }))
    remove(file, dropped.id)
    expect(read(file).map(n => n.text)).toEqual([kept.text])
  })

  it('a pin changes the pin and nothing else — not the date, not the words', () => {
    const file = join(scratch(), 'memory.jsonl')
    const n = append(file, note())
    setPinned(file, n.id, true)
    const [after] = read(file)
    expect(after.pinned).toBe(true)
    expect(after.at).toBe('2026-08-12T10:00:00.000Z')
    expect(after.text).toBe(n.text)
  })

  it('survives a torn line: one bad note never costs the file', () => {
    const notes = compact(`${JSON.stringify(note({ text: 'first' }))}\n{"id":"m_x","text":\n${JSON.stringify(note({ text: 'third' }))}\n`)
    expect(notes.map(n => n.text)).toEqual(['first', 'third'])
  })

  it('keeps both notes when two conversations record at the same moment', () => {
    // Each session spawns its own copy of the server; O_APPEND is what makes that safe.
    const file = join(scratch(), 'memory.jsonl')
    const a = append(file, note({ text: 'from the front desk' }))
    const b = append(file, note({ text: 'from quotes' }))
    expect(read(file).map(n => n.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('a patch for a note that no longer exists changes nothing', () => {
    const file = join(scratch(), 'memory.jsonl')
    append(file, note())
    setPinned(file, 'm_never', true)
    expect(read(file)).toHaveLength(1)
  })
})

describe('the block is a budgeted view, not the whole ledger', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) =>
    note({ at: `2026-08-${String((i % 27) + 1).padStart(2, '0')}T10:00:00.000Z`, text: `note number ${i} about a job that was discussed at some length` }))

  it('stays inside its budget however much is remembered', () => {
    const block = renderBlock(many(500))
    expect(block.length).toBeLessThanOrEqual(DEFAULT_BUDGET + 400) // + the group headings and the tail line
    expect(block).toMatch(/older notes are on file/)
  })

  it('keeps every pinned note even when newer ones would crowd it out', () => {
    const standing = note({ at: '2020-01-01T00:00:00.000Z', about: 'business', text: 'Never work Sundays', pinned: true })
    const block = renderBlock([standing, ...many(400)])
    expect(block).toContain('Never work Sundays')
  })

  it('groups a customer’s history together', () => {
    const block = renderBlock([
      note({ about: 'Dana Reeves', text: 'Quoted $2,400' }),
      note({ about: 'business', text: 'No jobs outside the GTA' }),
      note({ about: 'Dana Reeves', text: 'Call Thursday at 2' }),
    ])
    expect(block.indexOf('Quoted $2,400')).toBeLessThan(block.indexOf('Call Thursday at 2'))
    expect(block).toContain('## Dana Reeves')
    expect(block).toContain('## The business')
  })

  it('says so plainly when nothing has been recorded', () => {
    expect(renderBlock([])).toContain('Nothing recorded yet.')
  })

  it('is written where the instruction loader already looks', () => {
    const home = scratch(), file = join(home, 'AGENTS.md')
    writeBlock(file, [note({ text: 'Quoted $2,400 for the rebuild' })])
    expect(readFileSync(file, 'utf8')).toContain('Quoted $2,400 for the rebuild')
  })
})

describe('what Desk refuses to write down', () => {
  it.each([
    ['his card is 4111 1111 1111 1111', /card number/],
    ['card 4111-1111-1111-1111 on file', /card number/],
    ['cvv is 123', /security code/],
    ['the wifi password is hunter2', /password or key/],
    ['api_key: sk-live-abc123', /password or key/],
    ['SIN 123-45-6789', /social security/],
  ])('refuses %s', (text, why) => {
    expect(refuse(text)).toMatch(why)
  })

  it('keeps an ordinary business note', () => {
    expect(refuse('Quoted $2,400 for the rebuild, deposit 50% on the 12th')).toBeNull()
  })

  it('keeps a phone number, which a business assistant plainly needs', () => {
    expect(refuse('Dana is on 416-555-0199')).toBeNull()
  })
})

describe('reading it back', () => {
  it('finds a note by any of its words', () => {
    const notes = [note({ text: 'Quoted $2,400 for the website rebuild' }), note({ about: 'The Okafors', text: 'Text only, never call' })]
    expect(search(notes, 'quoted rebuild').map(n => n.about)).toEqual(['Dana Reeves'])
    expect(search(notes, 'text only').map(n => n.about)).toEqual(['The Okafors'])
  })

  it('can be held to one customer', () => {
    const notes = [note({ about: 'Dana Reeves', text: 'deposit paid' }), note({ about: 'Sam Ellis', text: 'deposit paid' })]
    expect(search(notes, 'deposit', 'Sam Ellis').map(n => n.about)).toEqual(['Sam Ellis'])
  })

  it('puts pinned notes first, then the most recent', () => {
    const order = ranked([
      note({ at: '2026-08-01T00:00:00.000Z', text: 'older' }),
      note({ at: '2026-08-31T00:00:00.000Z', text: 'newer' }),
      note({ at: '2020-01-01T00:00:00.000Z', text: 'standing', pinned: true }),
    ])
    expect(order.map(n => n.text)).toEqual(['standing', 'newer', 'older'])
  })

  it('cleans a note without mangling ordinary punctuation', () => {
    expect(clean('  Mrs. Smith-Jones  wants\na call  ')).toBe('Mrs. Smith-Jones wants a call')
    expect(clean('a'.repeat(500))).toHaveLength(400)
  })
})
