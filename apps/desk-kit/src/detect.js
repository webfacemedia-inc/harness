// Brand detection: from the business website (theme colour, logo, icon) or from
// an uploaded logo/letterhead file. Returns suggestions; brand_set saves them.
import { writeFileSync, mkdirSync, copyFileSync, existsSync, unlinkSync } from 'node:fs'
import { join, extname } from 'node:path'
import { BRAND_DIR, WORK } from './brand.js'
import { dominantColours } from './image.js'

const attr = (tag, name) => { const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag); return m ? m[1] : null }

export async function detectFromWebsite(url) {
  const base = /^https?:\/\//.test(url) ? url : `https://${url}`
  const html = await (await fetch(base, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'webfaCe Desk brand detect' } })).text()
  const tags = html.match(/<(meta|link|img)\b[^>]*>/gi) ?? []
  const out = { source: base, colours: [], logoCandidates: [], name: (html.match(/<title>([^<]{1,80})<\/title>/i)?.[1] ?? '').trim() }
  for (const t of tags) {
    if (/name=["']theme-color["']/i.test(t)) { const c = attr(t, 'content'); if (c) out.colours.push(c) }
    if (/property=["']og:image["']/i.test(t)) { const c = attr(t, 'content'); if (c) out.logoCandidates.push(new URL(c, base).href) }
    if (/rel=["'][^"']*icon/i.test(t)) { const c = attr(t, 'href'); if (c) out.logoCandidates.push(new URL(c, base).href) }
    if (/^<img/i.test(t) && /logo/i.test(t)) { const c = attr(t, 'src'); if (c) out.logoCandidates.unshift(new URL(c, base).href) }
  }
  const css = html.match(/#[0-9a-f]{6}\b/gi) ?? []
  const counts = {}; for (const c of css) counts[c.toUpperCase()] = (counts[c.toUpperCase()] ?? 0) + 1
  out.colours.push(...Object.entries(counts).filter(([c]) => !/^#(FFFFFF|000000|F{5}[0-9A-F]|[0-9A-F]F{5})$/.test(c)).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c))
  out.colours = [...new Set(out.colours.map(c => c.toUpperCase()))]
  // Pull the first usable logo candidate to a temp file for a colour read.
  for (const cand of out.logoCandidates.slice(0, 4)) {
    try {
      const r = await fetch(cand, { signal: AbortSignal.timeout(15000) }); if (!r.ok) continue
      const ct = r.headers.get('content-type') ?? ''; if (!/image/.test(ct)) continue
      const ext = /svg/.test(ct) ? '.svg' : /png/.test(ct) ? '.png' : /webp/.test(ct) ? '.webp' : '.jpg'
      mkdirSync(join(WORK, 'brand-candidates'), { recursive: true }); const f = join(WORK, 'brand-candidates', 'logo' + ext)
      writeFileSync(f, Buffer.from(await r.arrayBuffer())); out.logoFile = f
      if (ext !== '.svg') { try { out.logoColour = await dominantColours(f) } catch {} }
      break
    } catch {}
  }
  return out
}

export async function detectFromFile(file) {
  const f = file.startsWith('/') ? file : join(WORK, file)
  if (!existsSync(f)) throw new Error(`No such file: ${file}`)
  const ext = extname(f).toLowerCase()
  const out = { source: f, colours: [], logoFile: f }
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) out.colours.push(await dominantColours(f))
  return out
}

/** Save the chosen logo into the brand folder as logo.<ext>. */
export function adoptLogo(file) {
  mkdirSync(BRAND_DIR, { recursive: true })
  const ext = extname(file).toLowerCase() || '.png'
  for (const old of ['.png', '.jpg', '.jpeg', '.svg', '.webp']) { const p = join(BRAND_DIR, 'logo' + old); if (existsSync(p)) try { unlinkSync(p) } catch {} }
  const dest = join(BRAND_DIR, 'logo' + ext); copyFileSync(file, dest); return dest
}
