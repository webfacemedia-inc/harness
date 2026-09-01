// webfaCe Desk — memory as an MCP server (stdio).
//
// Without this, every conversation starts blank: Desk knows who the business is
// (the Desk folder's AGENTS.md) but not that it quoted Dana $2,400 last Tuesday,
// that the Okafors only want texts, or that the owner said never to work Sundays.
//
// An MCP server rather than a shell tool on purpose: the modes without a shell
// (Front desk, Quotes, Bookings, Website) have shell and file-write tools stripped
// from them and from anything they delegate to — MCP tools survive that filter, so
// every mode can remember.
//
// Writing a note is never consequential and never asks: it is recorded, and Desk
// says so in one short line. The owner reviews and deletes on the Memory page.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  BUSINESS, DEFAULT_BUDGET, KINDS,
  append, clean, cleanAbout, newId, read, refuse, remove, search, writeBlock,
} from './ledger.js'

const LEDGER = process.env.DESK_MEMORY_FILE ?? join(homedir(), '.desk', 'memory.jsonl')
// The workspace-instruction loader reads $DSH_HOME/AGENTS.md first in every
// session, so writing the budgeted view there is the whole recall mechanism.
const BLOCK = process.env.DESK_MEMORY_BLOCK ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'AGENTS.md')
const BUDGET = Number(process.env.DESK_MEMORY_BUDGET ?? DEFAULT_BUDGET)

const server = new McpServer({ name: 'webface-desk-memory', version: '0.1.0' })
const text = s => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const fail = e => ({ content: [{ type: 'text', text: `Error: ${e.message ?? e}` }], isError: true })
const refresh = () => writeBlock(BLOCK, read(LEDGER), BUDGET)
const day = at => String(at ?? '').slice(0, 10)

server.registerTool('remember', {
  description: 'Record something worth keeping beyond this conversation: a decision the owner made, a promise given to a customer, a price quoted, or a stated preference. Use it as it happens, then tell the owner in one short line that you noted it. Do not record card numbers, passwords, or anything the owner asks you to keep out.',
  inputSchema: {
    text: z.string().describe('The note, in one plain sentence, with the specifics: who, what, how much, when.'),
    about: z.string().optional().describe("Who it concerns — a customer or supplier by name. Leave out for the business itself."),
    kind: z.enum(KINDS).default('fact').describe('decision = the owner chose it; commitment = someone was promised something; preference = how a person likes to be dealt with; fact = everything else.'),
    pinned: z.boolean().default(false).describe('Only for standing rules the business always works by. Pinned notes are never crowded out by newer ones.'),
  },
}, async ({ text: body, about, kind, pinned }) => {
  try {
    const note = clean(body)
    if (!note) return fail(new Error('nothing to remember'))
    const no = refuse(note)
    if (no) return text(`Not recorded — ${no}, and Desk does not keep those. Say it again without that detail if the rest is worth keeping.`)
    const entry = { id: newId(), at: new Date().toISOString(), kind, about: cleanAbout(about), text: note, pinned: Boolean(pinned), sessionId: process.env.DESK_SESSION_ID ?? '' }
    append(LEDGER, entry)
    refresh()
    const who = entry.about === BUSINESS ? '' : ` about ${entry.about}`
    return text(`Recorded${who}: "${entry.text}"\nTell the owner in one short line that you noted this — for example "Noted${who}: ${entry.text}" — and carry on. It will be there in your next conversation, and the owner can remove it on the Memory page.`)
  } catch (e) { return fail(e) }
})

server.registerTool('recall', {
  description: 'Search everything Desk has ever recorded, including the older notes that do not fit in the opening summary. Use it when the owner asks what was said or agreed before, or before quoting or promising anything to a customer you have dealt with previously.',
  inputSchema: {
    query: z.string().describe('Words to look for — a customer name, a job, an amount.'),
    about: z.string().optional().describe('Restrict to one customer or supplier by name.'),
    limit: z.number().min(1).max(50).default(10),
  },
}, async ({ query, about, limit }) => {
  try {
    const hits = search(read(LEDGER), query, about).slice(0, limit)
    if (hits.length === 0) return text(`Nothing recorded about that. Say so plainly rather than guessing.`)
    return text(hits.map(n => `${day(n.at)} · ${n.about === BUSINESS ? 'the business' : n.about} · ${n.kind} · ${n.text}${n.pinned ? ' (pinned)' : ''}  [${n.id}]`).join('\n'))
  } catch (e) { return fail(e) }
})

server.registerTool('forget', {
  description: "Remove a note when the owner says it is wrong or no longer applies. Find its id with `recall` first, and confirm what you are removing.",
  inputSchema: { id: z.string().describe('The [id] shown by recall.') },
}, async ({ id }) => {
  try {
    const wanted = clean(id, 40)
    const note = read(LEDGER).find(n => n.id === wanted)
    if (!note) return text(`No note with that id — it may already be gone. Use recall to check.`)
    remove(LEDGER, wanted)
    refresh()
    return text(`Forgotten: "${note.text}". Tell the owner it is gone.`)
  } catch (e) { return fail(e) }
})

// A Desk that has never recorded anything still needs the block to exist, so the
// first conversation after an update is not the one that creates it mid-turn.
try { refresh() } catch { /* a read-only or missing home is not a reason to refuse to start */ }

await server.connect(new StdioServerTransport())
