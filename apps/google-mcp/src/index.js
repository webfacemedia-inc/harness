#!/usr/bin/env node
// webfaCe Desk — Google connector as an MCP server (stdio).
// Gmail, Calendar, Drive, Contacts over the customer's own OAuth client.
// Anything that leaves the account (send, create/move/delete events) requires
// confirm:true so the Bot has to state the action before it happens; Desk's
// own approval layer sits on top of that.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { google } from 'googleapis'
import { clientFor } from './auth.js'
import { listAccounts, resolveAccount } from './config.js'

const server = new McpServer({ name: 'webface-desk-google', version: '0.1.0' })
const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: `Error: ${e?.message ?? e}` }] })
const acct = z.string().optional().describe('Connected account (full address or unique prefix). Omit when only one is connected.')

function gmailFor(account) { return google.gmail({ version: 'v1', auth: clientFor(resolveAccount(account)) }) }
function calFor(account) { return google.calendar({ version: 'v3', auth: clientFor(resolveAccount(account)) }) }
function driveFor(account) { return google.drive({ version: 'v3', auth: clientFor(resolveAccount(account)) }) }
function peopleFor(account) { return google.people({ version: 'v1', auth: clientFor(resolveAccount(account)) }) }

const header = (msg, name) => msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
function bodyText(payload) {
  if (!payload) return ''
  const parts = payload.parts ?? []
  const pick = (mime) => {
    const stack = [payload]; while (stack.length) { const p = stack.pop(); if (p.mimeType === mime && p.body?.data) return Buffer.from(p.body.data, 'base64url').toString('utf8'); if (p.parts) stack.push(...p.parts) }
    return ''
  }
  const plain = pick('text/plain'); if (plain) return plain
  const html = pick('text/html'); if (html) return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return parts.length ? '(no readable body)' : (payload.body?.data ? Buffer.from(payload.body.data, 'base64url').toString('utf8') : '')
}
function mime({ to, cc, bcc, subject, body, html, inReplyTo, references, from }) {
  const lines = []
  if (from) lines.push(`From: ${from}`)
  lines.push(`To: ${to}`); if (cc) lines.push(`Cc: ${cc}`); if (bcc) lines.push(`Bcc: ${bcc}`)
  lines.push(`Subject: ${subject}`)
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`); if (references) lines.push(`References: ${references}`)
  lines.push('MIME-Version: 1.0', `Content-Type: ${html ? 'text/html' : 'text/plain'}; charset=UTF-8`, '', html ?? body)
  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

server.registerTool('google_accounts', { description: 'List the Google accounts connected to this Desk.', inputSchema: {} }, async () => text({ accounts: listAccounts() }))

server.registerTool('gmail_search', {
  description: 'Search mail with Gmail query syntax (e.g. "is:unread newer_than:2d", "from:x subject:quote"). Returns threads with the latest message summary.',
  inputSchema: { query: z.string(), max: z.number().int().min(1).max(50).default(15), account: acct },
}, async ({ query, max, account }) => {
  try {
    const gmail = gmailFor(account)
    const list = await gmail.users.threads.list({ userId: 'me', q: query, maxResults: max })
    const out = []
    for (const t of list.data.threads ?? []) {
      const th = await gmail.users.threads.get({ userId: 'me', id: t.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
      const msgs = th.data.messages ?? []; const last = msgs[msgs.length - 1]
      out.push({ threadId: t.id, messages: msgs.length, subject: header(last, 'Subject'), from: header(last, 'From'), to: header(last, 'To'), date: header(last, 'Date'), snippet: last.snippet, labels: last.labelIds, lastMessageId: last.id })
    }
    return text(out)
  } catch (e) { return fail(e) }
})

server.registerTool('gmail_read', {
  description: 'Read one thread in full (all messages, plain text bodies, attachment names).',
  inputSchema: { threadId: z.string(), account: acct },
}, async ({ threadId, account }) => {
  try {
    const th = await gmailFor(account).users.threads.get({ userId: 'me', id: threadId, format: 'full' })
    return text((th.data.messages ?? []).map(m => ({ id: m.id, from: header(m, 'From'), to: header(m, 'To'), cc: header(m, 'Cc'), date: header(m, 'Date'), subject: header(m, 'Subject'), messageIdHeader: header(m, 'Message-ID'), body: bodyText(m.payload).slice(0, 20000), attachments: (function walk(p, acc=[]) { if (p?.filename) acc.push(p.filename); for (const c of p?.parts ?? []) walk(c, acc); return acc })(m.payload) })))
  } catch (e) { return fail(e) }
})

server.registerTool('gmail_draft', {
  description: 'Create a DRAFT (never sent). For replies pass replyToMessageId so it threads. Use html for formatted mail with real links; never paste bare URLs into plain text.',
  inputSchema: { to: z.string(), subject: z.string(), body: z.string().optional(), html: z.string().optional(), cc: z.string().optional(), bcc: z.string().optional(), replyToMessageId: z.string().optional(), account: acct },
}, async ({ to, subject, body, html, cc, bcc, replyToMessageId, account }) => {
  try {
    const gmail = gmailFor(account); let threadId, inReplyTo, references
    if (replyToMessageId) { const m = await gmail.users.messages.get({ userId: 'me', id: replyToMessageId, format: 'metadata', metadataHeaders: ['Message-ID', 'References'] }); threadId = m.data.threadId; inReplyTo = header(m.data, 'Message-ID'); references = [header(m.data, 'References'), inReplyTo].filter(Boolean).join(' ') }
    if (!body && !html) throw new Error('body or html is required')
    const raw = mime({ to, cc, bcc, subject, body, html, inReplyTo, references })
    const d = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw, threadId } } })
    return text({ draftId: d.data.id, messageId: d.data.message?.id, threadId: d.data.message?.threadId, status: 'draft — not sent' })
  } catch (e) { return fail(e) }
})

server.registerTool('gmail_send_draft', {
  description: 'SEND an existing draft. Consequential: requires confirm:true, and you must have told the user exactly what will be sent and to whom.',
  inputSchema: { draftId: z.string(), confirm: z.boolean().default(false), account: acct },
}, async ({ draftId, confirm, account }) => {
  if (!confirm) return fail(new Error('Refused: sending needs confirm:true after the user approved this exact draft.'))
  try { const r = await gmailFor(account).users.drafts.send({ userId: 'me', requestBody: { id: draftId } }); return text({ sent: true, messageId: r.data.id, threadId: r.data.threadId }) } catch (e) { return fail(e) }
})

server.registerTool('gmail_label', {
  description: 'Add/remove labels on a thread (e.g. mark read: remove UNREAD; archive: remove INBOX; star: add STARRED).',
  inputSchema: { threadId: z.string(), add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]), account: acct },
}, async ({ threadId, add, remove, account }) => {
  try { await gmailFor(account).users.threads.modify({ userId: 'me', id: threadId, requestBody: { addLabelIds: add, removeLabelIds: remove } }); return text({ ok: true }) } catch (e) { return fail(e) }
})

server.registerTool('calendar_list', {
  description: 'List events between two ISO times (default: now → +7 days) on a calendar (default primary).',
  inputSchema: { timeMin: z.string().optional(), timeMax: z.string().optional(), calendarId: z.string().default('primary'), max: z.number().int().min(1).max(100).default(50), account: acct },
}, async ({ timeMin, timeMax, calendarId, max, account }) => {
  try {
    const now = new Date(); const r = await calFor(account).events.list({ calendarId, timeMin: timeMin ?? now.toISOString(), timeMax: timeMax ?? new Date(now.getTime() + 7 * 864e5).toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: max })
    return text((r.data.items ?? []).map(e => ({ id: e.id, summary: e.summary, start: e.start?.dateTime ?? e.start?.date, end: e.end?.dateTime ?? e.end?.date, location: e.location, attendees: (e.attendees ?? []).map(a => a.email), status: e.status, link: e.htmlLink })))
  } catch (e) { return fail(e) }
})

server.registerTool('calendar_free', {
  description: 'Free/busy for a window on the primary calendar: returns busy blocks so you can propose open slots.',
  inputSchema: { timeMin: z.string(), timeMax: z.string(), account: acct },
}, async ({ timeMin, timeMax, account }) => {
  try { const r = await calFor(account).freebusy.query({ requestBody: { timeMin, timeMax, items: [{ id: 'primary' }] } }); return text(r.data.calendars?.primary?.busy ?? []) } catch (e) { return fail(e) }
})

server.registerTool('calendar_create', {
  description: 'Create an event. Consequential: requires confirm:true after the user approved the details. Times are ISO with offset; attendees get invitations.',
  inputSchema: { summary: z.string(), start: z.string(), end: z.string(), description: z.string().optional(), location: z.string().optional(), attendees: z.array(z.string()).default([]), calendarId: z.string().default('primary'), confirm: z.boolean().default(false), account: acct },
}, async ({ summary, start, end, description, location, attendees, calendarId, confirm, account }) => {
  if (!confirm) return fail(new Error('Refused: creating an event needs confirm:true after the user approved it.'))
  try { const r = await calFor(account).events.insert({ calendarId, sendUpdates: attendees.length ? 'all' : 'none', requestBody: { summary, description, location, start: { dateTime: start }, end: { dateTime: end }, attendees: attendees.map(email => ({ email })) } }); return text({ id: r.data.id, link: r.data.htmlLink }) } catch (e) { return fail(e) }
})

server.registerTool('calendar_update', {
  description: 'Move or edit an event (start/end/summary/location). Consequential: requires confirm:true.',
  inputSchema: { eventId: z.string(), start: z.string().optional(), end: z.string().optional(), summary: z.string().optional(), location: z.string().optional(), calendarId: z.string().default('primary'), confirm: z.boolean().default(false), account: acct },
}, async ({ eventId, start, end, summary, location, calendarId, confirm, account }) => {
  if (!confirm) return fail(new Error('Refused: changing an event needs confirm:true.'))
  try { const body = {}; if (start) body.start = { dateTime: start }; if (end) body.end = { dateTime: end }; if (summary) body.summary = summary; if (location) body.location = location; const r = await calFor(account).events.patch({ calendarId, eventId, sendUpdates: 'all', requestBody: body }); return text({ id: r.data.id, link: r.data.htmlLink }) } catch (e) { return fail(e) }
})

server.registerTool('drive_search', {
  description: 'Search Drive by name/content (Drive query syntax or plain words). Read-only.',
  inputSchema: { query: z.string(), max: z.number().int().min(1).max(50).default(20), account: acct },
}, async ({ query, max, account }) => {
  try { const q = /[=']|contains/.test(query) ? query : `fullText contains '${query.replace(/'/g, "\\'")}'`; const r = await driveFor(account).files.list({ q: `${q} and trashed=false`, pageSize: max, fields: 'files(id,name,mimeType,modifiedTime,webViewLink,size)' }); return text(r.data.files ?? []) } catch (e) { return fail(e) }
})

server.registerTool('drive_read', {
  description: 'Read a Drive file as text (Docs/Sheets/Slides exported; plain files fetched). Read-only, capped at 100k chars.',
  inputSchema: { fileId: z.string(), account: acct },
}, async ({ fileId, account }) => {
  try {
    const drive = driveFor(account); const meta = await drive.files.get({ fileId, fields: 'id,name,mimeType' }); const m = meta.data.mimeType ?? ''
    const exportMime = m === 'application/vnd.google-apps.document' ? 'text/plain' : m === 'application/vnd.google-apps.spreadsheet' ? 'text/csv' : m === 'application/vnd.google-apps.presentation' ? 'text/plain' : null
    const r = exportMime ? await drive.files.export({ fileId, mimeType: exportMime }, { responseType: 'text' }) : await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' })
    return text({ name: meta.data.name, mimeType: m, content: String(r.data).slice(0, 100000) })
  } catch (e) { return fail(e) }
})

server.registerTool('contacts_search', {
  description: 'Find people in the account\'s contacts by name/email/phone.',
  inputSchema: { query: z.string(), account: acct },
}, async ({ query, account }) => {
  try { const r = await peopleFor(account).people.searchContacts({ query, readMask: 'names,emailAddresses,phoneNumbers,organizations', pageSize: 10 }); return text((r.data.results ?? []).map(x => ({ name: x.person?.names?.[0]?.displayName, emails: (x.person?.emailAddresses ?? []).map(e => e.value), phones: (x.person?.phoneNumbers ?? []).map(p => p.value), org: x.person?.organizations?.[0]?.name }))) } catch (e) { return fail(e) }
})

await server.connect(new StdioServerTransport())
