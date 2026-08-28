#!/usr/bin/env node
// webfaCe Desk — WordPress connector (MCP over stdio) on the site's REST API.
// Env: WP_URL (https://example.com), WP_USER, WP_APP_PASSWORD (Application
// Password from Users → Profile). Reads are free; publishing, updating live
// content, and deleting need confirm:true so the owner's approval gate holds.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const URL_ = (process.env.WP_URL ?? '').replace(/\/+$/, '')
const AUTH = 'Basic ' + Buffer.from(`${process.env.WP_USER ?? ''}:${process.env.WP_APP_PASSWORD ?? ''}`).toString('base64')
if (!URL_ || !process.env.WP_USER || !process.env.WP_APP_PASSWORD) { console.error('WP_URL, WP_USER and WP_APP_PASSWORD are required'); process.exit(2) }

async function wp(path, { method = 'GET', body, raw } = {}) {
  const r = await fetch(`${URL_}/wp-json/wp/v2${path}`, { method, headers: { authorization: AUTH, ...(raw ? {} : { 'content-type': 'application/json' }), accept: 'application/json' }, body: raw ?? (body ? JSON.stringify(body) : undefined), signal: AbortSignal.timeout(30000) })
  const text = await r.text(); let j; try { j = JSON.parse(text) } catch { j = text }
  if (!r.ok) throw new Error(`WordPress ${method} ${path} → ${r.status}: ${typeof j === 'object' ? (j.message ?? JSON.stringify(j)) : String(j).slice(0, 200)}`)
  return { data: j, total: Number(r.headers.get('x-wp-total') ?? 0) }
}
const strip = s => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const slim = p => ({ id: p.id, type: p.type, status: p.status, title: strip(p.title?.rendered ?? p.title), slug: p.slug, link: p.link, date: p.date, modified: p.modified, excerpt: strip(p.excerpt?.rendered).slice(0, 240), categories: p.categories, parent: p.parent })
const text = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] })
const server = new McpServer({ name: 'webface-desk-wordpress', version: '0.1.0' })
const confirm = z.boolean().optional().describe('Must be true to change live content — set only after the owner approved the exact change.')

server.tool('wp_site_info', 'What this WordPress site is: name, description, URL, timezone, the connected user and their capabilities.', {}, async () => {
  const site = await fetch(`${URL_}/wp-json`, { headers: { authorization: AUTH } }).then(r => r.json())
  const me = (await wp('/users/me?context=edit')).data
  return text({ name: site.name, description: site.description, url: site.url, home: site.home, timezone: site.timezone_string, gmt_offset: site.gmt_offset, user: { id: me.id, name: me.name, roles: me.roles }, namespaces: (site.namespaces ?? []).filter(n => !n.startsWith('wp/')) })
})
server.tool('wp_list_posts', 'List posts (newest first). Use status "draft" to see drafts, "any" for everything.', { search: z.string().optional(), status: z.enum(['publish', 'draft', 'pending', 'future', 'private', 'any']).optional(), per_page: z.number().int().min(1).max(50).optional(), page: z.number().int().min(1).optional() }, async ({ search, status = 'any', per_page = 20, page = 1 }) => {
  const q = new URLSearchParams({ per_page: String(per_page), page: String(page), status, context: 'edit', orderby: 'modified', order: 'desc' }); if (search) q.set('search', search)
  const { data, total } = await wp(`/posts?${q}`); return text({ total, posts: data.map(slim) })
})
server.tool('wp_get_post', 'Read one post or page in full (title, content as HTML, status, categories).', { id: z.number().int(), type: z.enum(['posts', 'pages']).optional() }, async ({ id, type = 'posts' }) => {
  const p = (await wp(`/${type}/${id}?context=edit`)).data; return text({ ...slim(p), content: p.content?.raw ?? p.content?.rendered ?? '' })
})
server.tool('wp_create_post', 'Create a post or page. Always lands as a DRAFT unless status "publish" is given together with confirm:true.', { title: z.string(), content: z.string().describe('HTML or block markup'), type: z.enum(['posts', 'pages']).optional(), status: z.enum(['draft', 'publish', 'pending']).optional(), excerpt: z.string().optional(), categories: z.array(z.number().int()).optional(), slug: z.string().optional(), parent: z.number().int().optional(), confirm }, async ({ title, content, type = 'posts', status = 'draft', excerpt, categories, slug, parent, confirm: ok }) => {
  if (status === 'publish' && ok !== true) throw new Error('Publishing needs confirm:true after the owner approved it — create it as a draft first.')
  const body = { title, content, status, excerpt, slug, parent }; if (type === 'posts' && categories) body.categories = categories
  const p = (await wp(`/${type}`, { method: 'POST', body })).data; return text({ created: slim(p), editLink: `${URL_}/wp-admin/post.php?post=${p.id}&action=edit` })
})
server.tool('wp_update_post', 'Update a post or page. Changing a PUBLISHED item, or publishing, needs confirm:true; editing a draft does not.', { id: z.number().int(), type: z.enum(['posts', 'pages']).optional(), title: z.string().optional(), content: z.string().optional(), status: z.enum(['draft', 'publish', 'pending', 'private']).optional(), excerpt: z.string().optional(), slug: z.string().optional(), categories: z.array(z.number().int()).optional(), confirm }, async ({ id, type = 'posts', confirm: ok, ...patch }) => {
  const cur = (await wp(`/${type}/${id}?context=edit`)).data
  const goesLive = cur.status === 'publish' || patch.status === 'publish'
  if (goesLive && ok !== true) throw new Error(`This ${type === 'pages' ? 'page' : 'post'} is live (or would go live) — needs confirm:true after the owner approved the exact change.`)
  const p = (await wp(`/${type}/${id}`, { method: 'POST', body: patch })).data; return text({ updated: slim(p) })
})
server.tool('wp_list_pages', 'List pages with their hierarchy.', { search: z.string().optional(), per_page: z.number().int().min(1).max(100).optional() }, async ({ search, per_page = 50 }) => {
  const q = new URLSearchParams({ per_page: String(per_page), status: 'any', context: 'edit', orderby: 'menu_order', order: 'asc' }); if (search) q.set('search', search)
  const { data, total } = await wp(`/pages?${q}`); return text({ total, pages: data.map(slim) })
})
server.tool('wp_list_categories', 'Post categories (id, name, count).', {}, async () => { const { data } = await wp('/categories?per_page=100'); return text(data.map(c => ({ id: c.id, name: c.name, slug: c.slug, count: c.count }))) })
server.tool('wp_list_media', 'Recent media library items.', { search: z.string().optional(), per_page: z.number().int().min(1).max(50).optional() }, async ({ search, per_page = 20 }) => {
  const q = new URLSearchParams({ per_page: String(per_page) }); if (search) q.set('search', search)
  const { data, total } = await wp(`/media?${q}`); return text({ total, media: data.map(m => ({ id: m.id, title: strip(m.title?.rendered), url: m.source_url, mime: m.mime_type, alt: m.alt_text, date: m.date })) })
})
server.tool('wp_upload_media', 'Upload an image or file to the media library from a URL (e.g. a file in the Desk folder served by Files, or any public URL).', { url: z.string().url(), filename: z.string(), alt: z.string().optional(), title: z.string().optional() }, async ({ url, filename, alt, title }) => {
  { const h = new URL(url); const priv = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i
    if (h.protocol !== 'https:' || priv.test(h.hostname)) throw new Error('media can only be fetched from a public https:// address') }
  const src = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error' }); if (!src.ok) throw new Error(`could not fetch ${url}: ${src.status}`)
  const buf = Buffer.from(await src.arrayBuffer()); const mime = src.headers.get('content-type') ?? 'application/octet-stream'
  const r = await fetch(`${URL_}/wp-json/wp/v2/media`, { method: 'POST', headers: { authorization: AUTH, 'content-type': mime, 'content-disposition': `attachment; filename="${filename}"` }, body: buf })
  const m = await r.json(); if (!r.ok) throw new Error(`upload failed: ${m.message ?? r.status}`)
  if (alt || title) await wp(`/media/${m.id}`, { method: 'POST', body: { alt_text: alt, title } })
  return text({ id: m.id, url: m.source_url, mime: m.mime_type })
})
server.tool('wp_delete_post', 'Move a post or page to the Trash. Needs confirm:true.', { id: z.number().int(), type: z.enum(['posts', 'pages']).optional(), confirm }, async ({ id, type = 'posts', confirm: ok }) => {
  if (ok !== true) throw new Error('Deleting needs confirm:true after the owner approved it.')
  const p = (await wp(`/${type}/${id}`, { method: 'DELETE' })).data; return text({ trashed: slim(p) })
})

await server.connect(new StdioServerTransport())
