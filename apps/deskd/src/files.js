// Files: the Desk folder (/srv/desk/work) from any device — browse, upload,
// download, delete. Paths are confined to the root; dotfiles and AGENTS.md
// (the business profile) are shown read-only.
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs'
import { join, resolve, basename, extname } from 'node:path'
import { pipeline } from 'node:stream/promises'

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
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => !d.name.startsWith('.'))
    .map(d => { const st = statSync(join(dir, d.name)); return { name: d.name, dir: d.isDirectory(), size: st.size, mtime: st.mtime } })
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
}

export function page({ business, rel }) {
  const dir = safe(rel); const crumbs = rel ? rel.split('/').filter(Boolean) : []
  const rows = list(dir).map(e => {
    const path = [...crumbs, e.name].join('/')
    const lock = PROTECTED.has(e.name)
    return `<tr><td class="n">${e.dir ? `📁 <a href="/files?dir=${encodeURIComponent(path)}">${esc(e.name)}</a>` : `<a href="/files/dl/${encodeURIComponent(path)}">${esc(e.name)}</a>`}</td><td class="s">${e.dir ? '' : fmtSize(e.size)}</td><td class="d">${e.mtime.toISOString().slice(0, 16).replace('T', ' ')}</td><td class="a">${e.dir || lock ? '' : `<button data-del="${esc(path)}">Delete</button>`}</td></tr>`
  }).join('')
  const crumbHtml = ['<a href="/files">Desk</a>', ...crumbs.map((c, i) => `<a href="/files?dir=${encodeURIComponent(crumbs.slice(0, i + 1).join('/'))}">${esc(c)}</a>`)].join(' / ')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Files · webfaCe Desk</title>
<style>
:root{color-scheme:light dark;--bg:#f5f7fa;--card:#fff;--ink:#16212b;--mute:#5b6b7a;--line:#dde4ea;--blue:#3499cc;--blue-ink:#22729c}
@media(prefers-color-scheme:dark){:root{--bg:#0f151b;--card:#161e26;--ink:#eef3f7;--mute:#9db0c0;--line:#25313c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Segoe UI",Inter,system-ui,sans-serif}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--card)}
.top a.back{color:var(--blue-ink);text-decoration:none;font-weight:600}.crumbs a{color:inherit;text-decoration:none}.crumbs a:hover{color:var(--blue-ink)}
main{max-width:860px;margin:0 auto;padding:20px}
.drop{border:2px dashed var(--line);border-radius:12px;padding:22px;text-align:center;color:var(--mute);margin-bottom:18px;background:var(--card)}.drop.over{border-color:var(--blue);color:var(--blue-ink)}
.drop label{color:var(--blue-ink);font-weight:600;cursor:pointer}.drop input{display:none}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}tr:last-child td{border-bottom:0}
td.n a{color:inherit;text-decoration:none;font-weight:500}td.n a:hover{color:var(--blue-ink)}td.s,td.d{color:var(--mute);white-space:nowrap;font-variant-numeric:tabular-nums}td.a{text-align:right}
button{font:inherit;font-size:13px;padding:5px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;cursor:pointer}button:hover{border-color:#b42318;color:#b42318}
.empty{padding:28px;text-align:center;color:var(--mute)}#status{color:var(--mute);font-size:13px;min-height:18px;margin:8px 0}
@media(max-width:600px){td.d{display:none}th:nth-child(3){display:none}}
</style>
<body>
<div class="top"><a class="back" href="/">← Back to Desk</a><div class="crumbs">${crumbHtml}</div><span style="color:var(--mute);font-size:13px">${esc(business)}</span></div>
<main>
<div class="drop" id="drop">Drop files here, or <label>choose files<input id="pick" type="file" multiple></label>. They land in this folder and your team can use them right away.</div>
<div id="status"></div>
${rows ? `<table><thead><tr><th>Name</th><th>Size</th><th>Changed</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">Nothing here yet.</div>'}
</main>
<script>
const dir=${JSON.stringify(crumbs.join('/'))};const status=document.getElementById('status');const drop=document.getElementById('drop');
async function upload(files){for(const f of files){status.textContent='Uploading '+f.name+'…';const r=await fetch('/files/up/'+encodeURIComponent((dir?dir+'/':'')+f.name),{method:'PUT',body:f,credentials:'same-origin'});if(!r.ok){status.textContent='Could not upload '+f.name+': '+await r.text();return}}location.reload()}
document.getElementById('pick').addEventListener('change',e=>upload(e.target.files));
['dragenter','dragover'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',e=>upload(e.dataTransfer.files));
document.querySelectorAll('button[data-del]').forEach(b=>b.addEventListener('click',async()=>{const p=b.dataset.del;if(!confirm('Delete '+p+'?'))return;const r=await fetch('/files/rm/'+encodeURIComponent(p),{method:'POST',credentials:'same-origin'});if(r.ok)location.reload();else status.textContent='Could not delete: '+await r.text()}));
</script></body></html>`
}

export async function handle(req, res, u, { business }) {
  const p = u.pathname
  if (p === '/files' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(page({ business, rel: u.searchParams.get('dir') ?? '' }))
  }
  if (p.startsWith('/files/dl/') && req.method === 'GET') {
    const f = safe(p.slice('/files/dl/'.length)); if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(f).size, 'content-disposition': `attachment; filename="${encodeURIComponent(basename(f))}"` })
    return pipeline(createReadStream(f), res)
  }
  if (p.startsWith('/files/up/') && req.method === 'PUT') {
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
