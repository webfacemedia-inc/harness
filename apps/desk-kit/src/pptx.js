// Markdown → .pptx via pptxgenjs on the business's brand: first heading = title
// slide on the accent colour with the logo, then one content slide per heading.
// pptxgenjs's ESM build trips Node's require-cycle guard under the tsx loader; load its CJS build directly.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
// The package hides its files behind "exports", so load the CJS build by its path in this package's node_modules.
const pptxgen = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'pptxgenjs', 'dist', 'pptxgen.cjs.js'))
import { accentOf } from './brand.js'
import { tidyMarkdown } from './tidy.js'

export async function markdownToPptx(md, brand) {
  const ACCENT = accentOf(brand), INK = brand.ink, MUTED = brand.muted, ZEBRA = brand.zebra, FONT = brand.font.deck
  const pptx = new pptxgen(); pptx.layout = 'LAYOUT_WIDE'; pptx.author = brand.business
  pptx.defineSlideMaster({ title: 'TITLE', background: { color: ACCENT } })
  pptx.defineSlideMaster({ title: 'CONTENT', background: { color: 'FFFFFF' }, objects: [{ text: { text: brand.business, options: { x: 0.5, y: 7.0, w: 8, fontSize: 9, color: MUTED, fontFace: FONT } } }], slideNumber: { x: 12.3, y: 7.0, color: MUTED, fontSize: 9, fontFace: FONT } })
  const lines = tidyMarkdown(md).split('\n'); const slides = []; let cur = null
  const push = title => { cur = { title, rows: [], tables: [] }; slides.push(cur) }
  const isSep = r => r.length > 0 && r.every(c => /^:?-{1,}:?$/.test((c || '').trim()))
  let i = 0
  while (i < lines.length) {
    const raw = lines[i], t = raw.trim()
    if (t.startsWith('```')) { const buf = []; i++; while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ } i++; if (buf.length) { if (!cur) push('Notes'); cur.rows.push({ text: buf.join('\n'), bullet: false, level: 0, mono: true }) } continue }
    if (/^\s*\|.*\|\s*$/.test(t)) { const rows = []; while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i].trim())) { rows.push(lines[i].trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())); i++ } const clean = rows.filter(r => !isSep(r)); if (clean.length) { if (!cur) push('Table'); cur.tables.push(clean) } continue }
    if (!t) { i++; continue }
    let m
    if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) push(m[2])
    else if ((m = /^(\s*)([-*])\s+(.*)$/.exec(raw))) { if (!cur) push('Untitled'); cur.rows.push({ text: m[3], bullet: true, level: Math.min(Math.floor((m[1] || '').length / 2), 3) }) }
    else if ((m = /^\s*\d+\.\s+(.*)$/.exec(raw))) { if (!cur) push('Untitled'); cur.rows.push({ text: m[1], bullet: true, level: 0 }) }
    else { if (!cur) push('Untitled'); cur.rows.push({ text: t, bullet: false, level: 0 }) }
    i++
  }
  if (!slides.length) push((md ?? '').slice(0, 80) || 'Untitled')
  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
  let titleDone = false
  for (const s of slides) {
    const isTitle = !titleDone; titleDone = true
    const slide = pptx.addSlide({ masterName: isTitle ? 'TITLE' : 'CONTENT' })
    if (isTitle) {
      if (brand.logo && !/svg$/i.test(brand.logo)) slide.addImage({ path: brand.logo, x: 0.8, y: 0.7, h: 0.9, w: 0.9 })
      slide.addText(brand.business, { x: 0.8, y: 2.5, w: 11, fontSize: 15, bold: true, color: 'FFFFFF', fontFace: FONT })
      slide.addText(s.title, { x: 0.8, y: 2.95, w: 11.7, h: 2.0, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: FONT, valign: 'top' })
      slide.addText(today, { x: 0.8, y: 5.2, w: 11, fontSize: 13, color: 'FFFFFF', fontFace: FONT, transparency: 30 })
      continue
    }
    slide.addText(s.title, { x: 0.6, y: 0.3, w: 12.1, h: 0.7, fontSize: 26, bold: true, color: ACCENT, fontFace: FONT, valign: 'top' })
    slide.addShape(pptx.ShapeType.rect, { x: 0.65, y: 1.05, w: 1.9, h: 0.07, fill: { color: ACCENT }, line: { type: 'none' } })
    let topY = 1.45
    if (s.rows.length) {
      slide.addText(s.rows.map(r => ({ text: r.text, options: { bullet: r.bullet ? (r.level === 0 ? true : { indent: r.level }) : false, indentLevel: r.level, breakLine: true, paraSpaceAfter: 8, fontSize: r.mono ? 12 : 17, color: r.mono ? '374151' : INK, fontFace: r.mono ? 'Courier New' : FONT } })), { x: 0.7, y: topY, w: 11.9, h: 5.2, valign: 'top', lineSpacingMultiple: 1.12 })
      topY += 3.3
    }
    for (const tbl of s.tables) {
      const ncols = Math.max(...tbl.map(r => r.length), 1)
      const cells = tbl.map((row, ri) => { const p = [...row]; while (p.length < ncols) p.push(''); return p.map(cell => ({ text: cell, options: { bold: ri === 0, color: ri === 0 ? 'FFFFFF' : INK, fill: ri === 0 ? { color: ACCENT } : (ri % 2 === 0 ? undefined : { color: ZEBRA }), align: 'left', valign: 'middle', fontSize: 13, fontFace: FONT } })) })
      slide.addTable(cells, { x: 0.7, y: topY, w: 11.9, colW: Array(ncols).fill(11.9 / ncols), border: { type: 'solid', color: 'E5E7EB', pt: 1 }, autoPage: false })
      topY += 0.4 + tbl.length * 0.38
    }
  }
  return await pptx.write({ outputType: 'nodebuffer' })
}
