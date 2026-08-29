// Files: the Desk folder (/srv/desk/work) from any device — browse, upload,
// download, delete. Paths are confined to the root; dotfiles and AGENTS.md
// (the business profile) are shown read-only.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs'
import { join, resolve, basename, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { layout, ICONS } from './ui.js'

export const ROOT = process.env.DESK_WORK_DIR ?? '/srv/desk/work'
const PROTECTED = new Set(['AGENTS.md'])
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.json': 'application/json', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.zip': 'application/zip', '.html': 'text/html; charset=utf-8' }

function safe(rel) {
  const p = resolve(ROOT, '.' + '/' + decodeURIComponent(rel ?? '').replace(/\\/g, '/'))
  if (p !== ROOT && !p.startsWith(ROOT + '/')) throw Object.assign(new Error('Outside the Desk folder'), { status: 400 })
  return p
}
const fmtSize = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function list(dir) {
  const out = readdirSync(dir, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.') && !d.name.endsWith('.bak'))
    .map(d => { const st = statSync(join(dir, d.name)); return { name: d.name, dir: d.isDirectory(), size: st.size, mtime: st.mtime } })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  return out.sort((x, y) => (y.name === 'deliverables') - (x.name === 'deliverables') || (y.dir - x.dir) || x.name.localeCompare(y.name))
}

export function page({ business, rel }) {
  const dir = safe(rel); const crumbs = rel ? rel.split('/').filter(Boolean) : []
  const rows = list(dir).map(e => {
    const path = [...crumbs, e.name].join('/')
    const lock = PROTECTED.has(e.name)
    return `<tr><td class="n">${e.dir ? `📁 <a href="/files?dir=${encodeURIComponent(path)}">${esc(e.name)}</a>` : `<a href="/files/view?p=${encodeURIComponent(path)}">${esc(e.name)}</a>`}</td><td class="s">${e.dir ? '' : fmtSize(e.size)}</td><td class="d">${e.mtime.toISOString().slice(0, 16).replace('T', ' ')}</td><td class="a">${e.dir || lock ? '' : `<button class="quiet" data-del="${esc(path)}">Delete</button>`}</td></tr>`
  }).join('')
  const crumbHtml = ['<a href="/files">Desk</a>', ...crumbs.map((c, i) => `<a href="/files?dir=${encodeURIComponent(crumbs.slice(0, i + 1).join('/'))}">${esc(c)}</a>`)].join(' / ')
  const body = `<h1>${ICONS.files} Files</h1><p class="sub"><a href="/files/export">Download everything (files and conversations)</a> · ${crumbHtml}</p>
<div class="drop" id="drop">Drop files here, or <label>choose files<input id="pick" type="file" multiple></label>. They land in this folder and Desk can use them right away.</div>
<div id="status"></div>
${rows ? `<table><thead><tr><th>Name</th><th>Size</th><th>Changed</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Nothing here yet.</div>'}
<script>
const dir=${JSON.stringify(crumbs.join('/'))};const status=document.getElementById('status');const drop=document.getElementById('drop');
async function upload(files){for(const f of files){status.textContent='Uploading '+f.name+'…';const r=await fetch('/files/up/'+encodeURIComponent((dir?dir+'/':'')+f.name),{method:'PUT',body:f,credentials:'same-origin'});if(!r.ok){status.textContent='Could not upload '+f.name+': '+await r.text();return}}location.reload()}
document.getElementById('pick').addEventListener('change',e=>upload(e.target.files));
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>upload(e.dataTransfer.files));
document.querySelectorAll('button[data-del]').forEach(b=>b.addEventListener('click',async()=>{const p=b.dataset.del;if(!confirm('Delete '+p+'?'))return;const r=await fetch('/files/rm/'+encodeURIComponent(p),{method:'POST',credentials:'same-origin'});if(r.ok)location.reload();else status.textContent='Could not delete: '+await r.text()}));
</script>`
  return layout({ title: 'Files', business, body })
}

export async function handle(req, res, u, { business }) {
  const p = u.pathname
  if (p === '/files' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(page({ business, rel: u.searchParams.get('dir') ?? '' }))
  }
  if (p === '/files/view') {
    // A file with a way back: the viewer keeps the Desk's bar (Back, Download) and previews what a browser can show.
    const rel = (u.searchParams.get('p') ?? '').replace(/^\/+/, ''); const f = safe(rel)
    if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page({ business, rel: '' })) }
    const dl = `/files/dl/${rel.split('/').map(encodeURIComponent).join('/')}`
    const kind = /\.(png|jpe?g|gif|webp|svg)$/i.test(rel) ? 'image' : /\.csv$/i.test(rel) ? 'csv' : /\.(pdf|txt|md|html?)$/i.test(rel) ? 'frame' : 'none'
    const body = `<div class="bar"><a class="btn ghost" href="/" style="margin:0;padding:7px 12px;font-size:13px">← Desk</a><a class="btn ghost" href="/files?dir=${encodeURIComponent(rel.split('/').slice(0, -1).join('/'))}" style="margin:0 0 0 8px;padding:7px 12px;font-size:13px">← Files</a><span class="h" style="margin-left:12px;font-size:13px;color:var(--mute)">${esc(rel.split('/').pop())}</span><span id="dlstatus" style="margin-left:auto;font-size:12px;color:var(--mute)"></span><a class="btn" href="${dl}" onclick="return deskDownload(this.href, ${JSON.stringify(rel.split('/').pop())})" style="margin:0 0 0 10px;padding:7px 12px;font-size:13px">Download</a></div>
${kind === 'csv' ? `<div class="view csv"><table id="csv"></table></div><script>fetch(${JSON.stringify(dl + '?inline=1')},{credentials:'same-origin'}).then(function(r){return r.text()}).then(function(t){var rows=[],row=[],cell='',q=false;for(var i=0;i<t.length;i++){var c=t[i];if(q){if(c==='"'&&t[i+1]==='"'){cell+='"';i++}else if(c==='"'){q=false}else cell+=c}else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\\n'||c==='\\r'){if(c==='\\r'&&t[i+1]==='\\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}var tb=document.getElementById('csv');rows.forEach(function(r,ri){var tr=document.createElement('tr');r.forEach(function(v){var td=document.createElement(ri?'td':'th');td.textContent=v;tr.appendChild(td)});tb.appendChild(tr)})})</script>` : kind === 'image' ? `<div class="view"><img src="${dl}?inline=1" alt=""></div>` : kind === 'frame' ? `<iframe class="view" src="${dl}?inline=1" title="${esc(rel)}"></iframe>` : `<div class="view none"><p>This file type has no preview here. <a href="${dl}" onclick="return deskDownload(this.href, ${JSON.stringify(rel.split('/').pop())})">Download it</a> and open it on your computer.</p></div>`}`
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(layout({ title: rel.split('/').pop(), business, back: '/files', head: '<style>main{max-width:none;padding:0;height:calc(100dvh - 53px);display:flex;flex-direction:column}.bar{display:flex;gap:10px;align-items:center;padding:8px 14px;background:var(--card);border-bottom:1px solid var(--line)}.view{flex:1;min-height:0;width:100%;border:0;background:#f3f4f6;display:block}img.view,.view img{max-width:100%;max-height:100%;object-fit:contain;margin:auto;display:block}.view.none{display:grid;place-items:center;color:var(--mute)}.view.csv{overflow:auto;background:#fff;padding:16px}.view.csv table{border-collapse:collapse;font-size:14px}.view.csv th{background:var(--tint);text-align:left;position:sticky;top:0}.view.csv th,.view.csv td{padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}@media(max-width:600px){.bar .h{display:none}}</style>', body }))
  }
  if (p === '/files/open') {
    // Produced-file chips hand over an absolute path; only paths inside the Desk folder are served.
    const abs = resolve(u.searchParams.get('path') ?? '')
    if (!abs.startsWith(resolve(ROOT) + '/')) { res.writeHead(404); return res.end('Not in the Desk folder') }
    const rel = abs.slice(resolve(ROOT).length + 1)
    res.writeHead(302, { location: `/files/view?p=${encodeURIComponent(rel)}` }); return res.end()
  }
  if (p.startsWith('/files/dl/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const f = safe(p.slice('/files/dl/'.length)); if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found') }
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(f).size, 'content-disposition': `${u.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${encodeURIComponent(basename(f))}"` }); return res.end() }
    res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(f).size, 'content-disposition': `${u.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="${encodeURIComponent(basename(f))}"` })
    return pipeline(createReadStream(f), res)
  }
  if (p.startsWith('/files/up/') && req.method === 'PUT') {
    // 10 GB per Desk (the plan's file allowance): refuse an upload that would cross it.
    const LIMIT = 10 * 1024 ** 3; const incoming = Number(req.headers['content-length'] ?? 0)
    const used = (() => { const walk = d => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? walk(join(d, e.name)) : statSync(join(d, e.name)).size), 0); try { return walk(WORK) } catch { return 0 } })()
    if (used + incoming > LIMIT) { res.writeHead(413, { 'content-type': 'text/plain' }); return res.end(`This Desk holds ${(used / 1024 ** 3).toFixed(1)} GB of files; the plan includes 10 GB. Delete something first.`) }

    const f = safe(p.slice('/files/up/'.length)); const name = basename(f)
    if (PROTECTED.has(name) || name.startsWith('.')) { res.writeHead(403); return res.end('That file is managed by Desk') }
    mkdirSync(resolve(f, '..'), { recursive: true })
    await pipeline(req, createWriteStream(f)); res.writeHead(200); return res.end('ok')
  }
  if (p.startsWith('/files/rm/') && req.method === 'POST') {
    const f = safe(p.slice('/files/rm/'.length)); const name = basename(f)
    if (PROTECTED.has(name) || !existsSync(f)) { res.writeHead(403); return res.end('That file cannot be deleted here') }
    statSync(f).isDirectory() ? rmSync(f, { recursive: true }) : unlinkSync(f); res.writeHead(200); return res.end('ok')
  }
  return false
}
