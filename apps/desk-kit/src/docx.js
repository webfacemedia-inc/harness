// Markdown → native .docx via the vendored GenOffice docx-engine (no LibreOffice,
// no cloud), styled with the business's brand: accent headings, a cover page from
// the first H1 with the business name as the kicker, accent-header zebra tables.
import { buildBlankDocx, parseDocx, saveDocx } from '../vendor/genoffice/docx-engine/src/index.ts'
import { accentOf } from './brand.js'

const MONO = 'Courier New'
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function runs(text, color, font) {
  const c = color ? `<w:color w:val="${color}"/>` : ''
  const f = font ? `<w:rFonts w:ascii="${font}" w:hAnsi="${font}"/>` : ''
  const out = []
  const push = (t, inner = '') => { if (!t) return; const rPr = c || inner || f ? `<w:rPr>${f}${c}${inner}</w:rPr>` : ''; out.push(`<w:r>${rPr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`) }
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i); let m
    if ((m = /^\*\*([\s\S]+?)\*\*/.exec(rest))) { push(m[1], '<w:b/>'); i += m[0].length }
    else if ((m = /^`([^`]+)`/.exec(rest))) { push(m[1], `<w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}"/>`); i += m[0].length }
    else if ((m = /^__([\s\S]+?)__/.exec(rest))) { push(m[1], '<w:i/>'); i += m[0].length }
    else if ((m = /^\*([\s\S]+?)\*/.exec(rest)) || (m = /^_([\s\S]+?)_/.exec(rest))) { push(m[1], '<w:i/>'); i += m[0].length }
    else if ((m = /^\[([^\]]+)\]\(([^)]+)\)/.exec(rest))) { push(`${m[1]} (${m[2]})`); i += m[0].length }
    else { const idx = rest.search(/[`*_[]/); if (idx === -1) { push(rest); break } if (idx > 0) { push(rest.slice(0, idx)); i += idx } else { push(rest[0]); i += 1 } }
  }
  return out.join('')
}

export async function markdownToDocx(md, brand) {
  const ACCENT = accentOf(brand), ZEBRA = brand.zebra, INK = brand.ink, MUTED = brand.muted, FONT = brand.font.docx
  const para = (text, pPr = '', color) => `<w:p>${pPr}${runs(text, color, FONT)}</w:p>`
  const cover = (title, date) => {
    const kicker = `<w:p><w:pPr><w:spacing w:before="3000" w:after="60"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="${ACCENT}"/><w:spacing w:val="60"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(brand.business)}</w:t></w:r></w:p>`
    const ttl = `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}"/><w:b/><w:color w:val="${INK}"/><w:sz w:val="72"/></w:rPr><w:t xml:space="preserve">${esc(title)}</w:t></w:r></w:p>`
    const rule = `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="24" w:space="1" w:color="${ACCENT}"/></w:pBdr><w:spacing w:after="140"/></w:pPr></w:p>`
    const meta = `<w:p><w:r><w:rPr><w:color w:val="${MUTED}"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc([brand.business, brand.address, brand.phone, brand.email].filter(Boolean).join(' · '))}${brand.address || brand.phone || brand.email ? '' : ''} · ${esc(date)}</w:t></w:r></w:p>`
    return kicker + ttl + rule + meta + `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
  }
  const tableXml = rows => {
    const isSep = r => r.length > 0 && r.every(c => /^:?-{1,}:?$/.test((c || '').trim()))
    const sepAt1 = rows.length > 1 && isSep(rows[1]); const header = sepAt1 ? rows[0] : []; const body = sepAt1 ? rows.slice(2) : rows
    const b = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="E5E7EB"/>`).join('')
    const hcell = t => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:shd w:val="clear" w:color="auto" w:fill="${ACCENT}"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p></w:tc>`
    const bcell = (t, z) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${z ? `<w:shd w:val="clear" w:color="auto" w:fill="${ZEBRA}"/>` : ''}</w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${runs(t, undefined, FONT)}</w:p></w:tc>`
    const hrow = header.length ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${header.map(hcell).join('')}</w:tr>` : ''
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${b}</w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr>${hrow}${body.map((r, ri) => `<w:tr>${r.map(c => bcell(c, ri % 2 === 1)).join('')}</w:tr>`).join('')}</w:tbl><w:p/>`
  }
  const blank = await buildBlankDocx(); const parsed = await parseDocx(blank); const blocks = []
  const src = (md ?? '').replace(/\r\n/g, '\n'); const lines = src.split('\n')
  const h1 = src.match(/^#\s+(.+)$/m); const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
  const isRow = s => /^\s*\|.*\|\s*$/.test(s); const parseRow = s => s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
  let firstH1 = false, i = 0
  while (i < lines.length) {
    const raw = lines[i]
    if (raw.trim().startsWith('```')) { const buf = []; i++; while (i < lines.length && !lines[i].trim().startsWith('```')) { buf.push(lines[i]); i++ } i++; if (buf.length) blocks.push({ kind: 'xml', xml: `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F3F4F6"/><w:spacing w:after="120"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="${MONO}" w:hAnsi="${MONO}"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${esc(buf.join('\n'))}</w:t></w:r></w:p>` }); continue }
    if (isRow(raw.trim())) { const tbl = []; while (i < lines.length && isRow(lines[i].trim())) { tbl.push(parseRow(lines[i])); i++ } blocks.push({ kind: 'xml', xml: tableXml(tbl) }); continue }
    const t = raw.trim(); if (!t) { i++; continue }
    let m
    if ((m = /^(#{1,6})\s+(.*)$/.exec(t))) { if (h1 && !firstH1 && m[1].length === 1 && m[2].trim() === h1[1].trim()) { firstH1 = true; i++; continue } blocks.push({ kind: 'xml', xml: para(m[2], `<w:pPr><w:pStyle w:val="Heading${m[1].length}"/></w:pPr>`, ACCENT) }) }
    else if ((m = /^[-*]\s+(.*)$/.exec(t))) blocks.push({ kind: 'xml', xml: para(m[1], '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>') })
    else if ((m = /^\d+\.\s+(.*)$/.exec(t))) blocks.push({ kind: 'xml', xml: para(m[1], '<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>') })
    else if ((m = /^>\s?(.*)$/.exec(t))) blocks.push({ kind: 'xml', xml: `<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="${ACCENT}"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="${ZEBRA}"/><w:ind w:left="360"/></w:pPr>${runs(m[1], INK, FONT)}</w:p>` })
    else blocks.push({ kind: 'xml', xml: para(t) })
    i++
  }
  if (h1) blocks.unshift({ kind: 'xml', xml: cover(h1[1].trim(), today) })
  return saveDocx(parsed, blocks)
}
