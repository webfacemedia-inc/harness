// Markdown/HTML → PDF on the business's letterhead, printed by headless Chrome
// (already on every box) with its own profile dir so it never touches the shared Desk browser.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { marked } from 'marked'
import { accentOf, logoDataUri } from './brand.js'
import { tidyMarkdown, tidyText } from './tidy.js'

const CHROME = process.env.DESK_CHROME ?? ['/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync)
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Wrap Markdown (or ready HTML when `isHtml`) in the letterhead: logo, business line, accent rules. */
export function letterhead(content, brand, { isHtml = false, title = '' } = {}) {
  const src = isHtml ? content ?? '' : tidyMarkdown(content)
  const h1 = !isHtml && src.match(/^#\s+(.+)$/m)
  const heading = tidyText(title) || (h1 ? h1[1].trim() : '')
  const rest = h1 ? src.replace(/^#\s+.+\n?/, '') : src
  const body = isHtml ? src : marked.parse(rest, { async: false })
  const accent = '#' + accentOf(brand)
  const logo = logoDataUri(brand)
  const line = [brand.address, brand.phone, brand.email, brand.website.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ')
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(heading || brand.business)}</title>
<style>
@page { margin: 16mm 16mm 18mm; }
:root { --accent:${accent}; --ink:#${brand.ink}; --muted:#${brand.muted}; --line:#E5E7EB; --soft:#${brand.zebra}; }
* { box-sizing: border-box } html { -webkit-print-color-adjust: exact; print-color-adjust: exact }
body { margin:0; font: 10.5pt/1.6 ${brand.font.body}; color: var(--ink) }
.head { display:flex; align-items:center; justify-content:space-between; gap:16px; padding-bottom:10px; border-bottom:2px solid var(--accent); margin-bottom:22px }
.head img { max-height:44px; max-width:180px } .head .biz { font: 600 13pt ${brand.font.display}; color: var(--ink) } .head .line { font-size:8.5pt; color: var(--muted); margin-top:2px }
h1.doc { font: 600 22pt/1.15 ${brand.font.display}; margin: 0 0 4px } .date { color: var(--muted); font-size: 9pt; margin: 0 0 18px }
h1, h2, h3 { font-family: ${brand.font.display}; color: var(--accent); margin: 18px 0 6px } h2 { font-size: 14pt } h3 { font-size: 12pt }
p { margin: 0 0 9px } ul, ol { margin: 0 0 10px 20px } li { margin: 2px 0 }
table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 10pt } th { background: var(--accent); color: #fff; text-align: left; padding: 6px 8px } td { padding: 6px 8px; border-bottom: 1px solid var(--line) } tr:nth-child(even) td { background: var(--soft) }
blockquote { margin: 10px 0; padding: 8px 12px; border-left: 4px solid var(--accent); background: var(--soft) } code { font-family: "Courier New", monospace; font-size: 9.5pt } pre { background: #F3F4F6; padding: 10px; border-radius: 6px; font-size: 9pt; white-space: pre-wrap }
.end { margin-top: 28px; padding-top: 8px; border-top: 1px solid var(--line); font-size: 8pt; color: var(--muted); display:flex; justify-content:space-between }
thead { display: table-header-group } tr, blockquote, pre { page-break-inside: avoid } h2, h3 { page-break-after: avoid }
</style></head><body>
<div class="head"><div>${logo ? `<img src="${logo}" alt="">` : ''}</div><div style="text-align:right"><div class="biz">${esc(brand.business)}</div>${line ? `<div class="line">${esc(line)}</div>` : ''}</div></div>
${heading ? `<h1 class="doc">${esc(heading)}</h1><div class="date">${esc(today)}</div>` : ''}
${body}
<div class="end"><span>${esc(brand.business)}${brand.tagline ? ' · ' + esc(brand.tagline) : ''}</span><span>${esc(today)}</span></div>
</body></html>`
}

/** Print HTML to a PDF file; returns the PDF path or throws with Chrome's stderr. */
export function htmlToPdf(html, outPath) {
  if (!CHROME) throw new Error('Chrome is not installed on this Desk, so PDFs cannot be made yet.')
  const dir = mkdtempSync(join(tmpdir(), 'desk-kit-'))
  const htmlPath = join(dir, 'doc.html'); writeFileSync(htmlPath, html)
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--user-data-dir=${join(dir, 'profile')}`, '--no-pdf-header-footer', `--print-to-pdf=${outPath}`, `file://${htmlPath}`], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 60000 })
  rmSync(dir, { recursive: true, force: true })
  if (!existsSync(outPath)) throw new Error(`PDF render failed: ${String(r.stderr ?? '').slice(0, 200)}`)
  return outPath
}

/**
 * The deck's PDF preview: one page per slide. Each slide's body is rendered
 * through marked on its own — markdown left inside a raw <section> block is
 * not markdown to marked, which is how a deck once printed its bullets and
 * tables as literal pipes and dashes.
 */
export function deckLetterhead(md, brand, title) {
  const slides = tidyMarkdown(md).split(/\n(?=#{1,4}\s)/).map(s => s.trim()).filter(Boolean)
  const esc2 = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const heading = tidyText(title) || (slides[0] ?? '').split('\n')[0].replace(/^#+\s*/, '')
  const html = slides.map((s, i) => {
    const [first, ...rest] = s.split('\n')
    const body = rest.join('\n').replace(/^\s*---\s*$/gm, '')
    const slideTitle = first.replace(/^#+\s*/, '')
    // The first slide is the deck's title: the letterhead already prints it as the
    // document heading, so repeating it as a section would say the same thing twice.
    const h2 = i === 0 && slideTitle === heading ? '' : `<h2>${esc2(slideTitle)}</h2>`
    if (h2 === '' && !body.trim()) return ''
    // No page break after the last slide, or the closing line gets a page to itself.
    const brk = i === slides.length - 1 ? '' : 'page-break-after:always'
    return `<section style="${brk}">${h2}${marked.parse(body, { async: false })}</section>`
  }).filter(Boolean).join('\n')
  return letterhead(html, brand, { isHtml: true, title: heading })
}
