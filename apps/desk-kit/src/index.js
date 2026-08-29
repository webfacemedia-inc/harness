// webfaCe Desk — deliverables kit as an MCP server (stdio). Every tool writes a
// file the owner can download from Files (or the link in the reply), dressed in
// the business's own brand. Creating a file is never consequential; sending it is.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { readBrand, PROFILE, WORK } from './brand.js'
import { markdownToDocx } from './docx.js'
import { letterhead, htmlToPdf } from './pdf.js'
import { markdownToPptx } from './pptx.js'
import { sheetsToXlsx } from './sheet.js'
import { brandImage, generateImage } from './image.js'
import { detectFromWebsite, detectFromFile, adoptLogo } from './detect.js'

const server = new McpServer({ name: 'webface-desk-kit', version: '0.1.0' })
const text = (s) => ({ content: [{ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) }] })
const fail = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message ?? e}` }], isError: true })
const slug = s => String(s ?? 'file').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file'
const outDir = () => { const d = join(WORK, 'deliverables', new Date().toISOString().slice(0, 10)); mkdirSync(d, { recursive: true }); return d }
const ORIGIN = (process.env.DESK_PUBLIC_ORIGIN ?? '').replace(/\/$/, '')  // e.g. https://demo.webfacedesk.app — links must be absolute to render as links in the chat
const link = p => { const rel = p.startsWith(WORK) ? p.slice(WORK.length + 1) : p; return { path: p, url: `${ORIGIN}/files/dl/${rel.split('/').map(encodeURIComponent).join('/')}`, name: rel.split('/').pop() } }
const done = (files, note = '') => { const items = files.map(link); return text(`${note ? note + '\n' : ''}FILE READY. Your reply to the owner MUST include this line exactly, so they can open it from any device:\n${items.map(i => `📄 [${i.name}](${i.url})`).join('\n')}\n(The file is also under Files → deliverables. Do not paste the whole document into the chat — the file is the deliverable.)`) }
const unique = (dir, base, ext) => { let p = join(dir, `${base}${ext}`); for (let n = 2; existsSync(p); n++) p = join(dir, `${base}-${n}${ext}`); return p }

server.registerTool('make_document', {
  description: 'Write a Word document (.docx) and/or a PDF on the business letterhead from Markdown. Use # Title as the first line; ## for sections; tables with |. Use for letters, proposals, reports, quotes when the owner wants a document.',
  inputSchema: { title: z.string(), markdown: z.string(), format: z.enum(['docx', 'pdf', 'both']).default('both') },
}, async ({ title, markdown, format }) => {
  try {
    const brand = readBrand(), dir = outDir(), base = slug(title), md = markdown.trim().startsWith('#') ? markdown : `# ${title}\n\n${markdown}`
    const files = []
    if (format !== 'pdf') { const p = unique(dir, base, '.docx'); writeFileSync(p, await markdownToDocx(md, brand)); files.push(p) }
    if (format !== 'docx') { const p = unique(dir, base, '.pdf'); htmlToPdf(letterhead(md, brand), p); files.push(p) }
    return done(files, brand.set ? '' : 'Note: no brand is set yet (Business → Brand), so this uses a plain style.')
  } catch (e) { return fail(e) }
})
server.registerTool('make_pdf', {
  description: 'A PDF on the business letterhead (logo, colours, address) from Markdown or HTML — invoices, quotes, letters, one-pagers.',
  inputSchema: { title: z.string(), content: z.string(), html: z.boolean().default(false).describe('true when content is ready HTML instead of Markdown') },
}, async ({ title, content, html }) => {
  try { const brand = readBrand(), p = unique(outDir(), slug(title), '.pdf'); htmlToPdf(letterhead(content, brand, { isHtml: html, title }), p); return done([p]) } catch (e) { return fail(e) }
})
server.registerTool('make_deck', {
  description: 'A PowerPoint deck (.pptx) plus a PDF preview from Markdown: # or ## starts a slide (first one is the title slide), - bullets, | tables.',
  inputSchema: { title: z.string(), markdown: z.string() },
}, async ({ title, markdown }) => {
  try {
    const brand = readBrand(), dir = outDir(), base = slug(title), md = markdown.trim().startsWith('#') ? markdown : `# ${title}\n\n${markdown}`
    const p = unique(dir, base, '.pptx'); writeFileSync(p, await markdownToPptx(md, brand))
    const slides = md.split(/\n(?=#{1,4}\s)/).map(s => s.trim()).filter(Boolean)
    const html = letterhead(slides.map(s => `<section style="page-break-after:always">${s.split('\n')[0].replace(/^#+\s*/, '<h2>')}</h2>${s.split('\n').slice(1).join('\n')}</section>`).join('\n'), brand, { isHtml: false, title })
    const pdf = unique(dir, base, '.pdf'); htmlToPdf(html, pdf)
    return done([p, pdf])
  } catch (e) { return fail(e) }
})
server.registerTool('make_sheet', {
  description: 'A spreadsheet (.xlsx, plus a CSV) with the header row in the brand colour. Numbers in cells become numbers; totals get SUM formulas.',
  inputSchema: { title: z.string(), sheets: z.array(z.object({ name: z.string().optional(), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))), totals: z.object({ label: z.string().optional(), columns: z.array(z.number().int()) }).optional() })).min(1) },
}, async ({ title, sheets }) => {
  try { const brand = readBrand(), dir = outDir(), base = slug(title); const x = unique(dir, base, '.xlsx'); const { csv } = await sheetsToXlsx(sheets, brand, x); const c = unique(dir, base, '.csv'); writeFileSync(c, csv); return done([x, c]) } catch (e) { return fail(e) }
})
server.registerTool('make_text', {
  description: 'A plain file (.txt, .md, .csv, .html) with exactly the given content.',
  inputSchema: { name: z.string().describe('file name with extension, e.g. notes.txt'), content: z.string() },
}, async ({ name, content }) => {
  try { const safe = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, ''); const p = unique(outDir(), safe.replace(/\.[^.]+$/, ''), safe.includes('.') ? '.' + safe.split('.').pop() : '.txt'); writeFileSync(p, content); return done([p]) } catch (e) { return fail(e) }
})
server.registerTool('brand_image', {
  description: 'A branded graphic (social post, Open Graph card, header, story) composed from the brand colour, logo and your words. No picture generation.',
  inputSchema: { kind: z.enum(['social-post', 'og', 'header', 'story']).default('social-post'), headline: z.string(), text: z.string().default(''), name: z.string().optional() },
}, async ({ kind, headline, text: t, name }) => {
  try { const brand = readBrand(); const p = unique(outDir(), slug(name ?? headline), '.png'); await brandImage({ kind, headline, text: t }, brand, p); return done([p]) } catch (e) { return fail(e) }
})
server.registerTool('make_image', {
  description: 'Generate a picture from a description (photos, illustrations). Needs picture generation switched on for this Desk.',
  inputSchema: { prompt: z.string(), size: z.enum(['square', 'landscape_4_3', 'landscape_16_9', 'portrait_4_3']).default('landscape_4_3'), name: z.string().optional() },
}, async ({ prompt, size, name }) => {
  try { const p = unique(outDir(), slug(name ?? prompt.slice(0, 40)), '.png'); await generateImage({ prompt, size }, p); return done([p]) } catch (e) { return fail(e) }
})
server.registerTool('brand_get', { description: 'The brand every deliverable uses: business name, colours, font, logo, tagline.', inputSchema: {} }, async () => text(readBrand()))
server.registerTool('brand_detect', {
  description: 'Suggest a brand from the business website or from a logo/letterhead file in the Desk folder: colours and a logo candidate. Show the owner, then call brand_set with what they approve.',
  inputSchema: { website: z.string().optional(), file: z.string().optional().describe('path in the Desk folder, e.g. uploads/logo.png') },
}, async ({ website, file }) => {
  try { if (file) return text(await detectFromFile(file)); if (website) return text(await detectFromWebsite(website)); const b = readBrand(); if (b.website) return text(await detectFromWebsite(b.website)); return fail(new Error('Give a website or a file.')) } catch (e) { return fail(e) }
})
server.registerTool('brand_set', {
  description: 'Save the brand after the owner approved it: primary/accent colours (hex), font (editorial | classic | plain), tagline, and the logo file to adopt.',
  inputSchema: { primary: z.string().optional(), accent: z.string().optional(), font: z.enum(['editorial', 'classic', 'plain']).optional(), tagline: z.string().optional(), logoFile: z.string().optional(), confirm: z.boolean().default(false) },
}, async ({ primary, accent, font, tagline, logoFile, confirm }) => {
  if (!confirm) return fail(new Error('Refused: saving the brand needs confirm:true after the owner approved it.'))
  try {
    let p = {}; try { p = JSON.parse(readFileSync(PROFILE, 'utf8')) } catch {}
    p.brand = { ...(p.brand ?? {}), ...(primary ? { primary } : {}), ...(accent ? { accent } : {}), ...(font ? { font } : {}), ...(tagline !== undefined ? { tagline } : {}) }
    if (logoFile) p.brand.logo = adoptLogo(logoFile.startsWith('/') ? logoFile : join(WORK, logoFile))
    mkdirSync(dirname(PROFILE), { recursive: true }); writeFileSync(PROFILE + '.tmp', JSON.stringify(p, null, 2), { mode: 0o600 }); renameSync(PROFILE + '.tmp', PROFILE)
    return text({ saved: p.brand })
  } catch (e) { return fail(e) }
})

await server.connect(new StdioServerTransport())
