// Images: composed brand graphics with sharp (no model), and generated pictures via fal when a key is set.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { accentOf } from './brand.js'

const SIZES = { 'social-post': [1080, 1080], og: [1200, 630], header: [1600, 400], story: [1080, 1920] }
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A branded graphic: accent background, the logo, and a headline + line of text. */
export async function brandImage({ kind = 'social-post', headline = '', text = '' }, brand, outPath) {
  const [w, h] = SIZES[kind] ?? SIZES['social-post']
  const accent = '#' + accentOf(brand)
  const fs = Math.round(Math.min(w, h) / 12), fs2 = Math.round(fs * 0.5)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${accent}"/>
<text x="${w * 0.08}" y="${h * 0.52}" font-family="${brand.font.body.split(',')[0].replace(/"/g, '')}, Arial" font-size="${fs}" font-weight="700" fill="#fff">${esc(headline).slice(0, 40)}</text>
<text x="${w * 0.08}" y="${h * 0.52 + fs * 1.3}" font-family="Arial" font-size="${fs2}" fill="#fff" opacity="0.9">${esc(text).slice(0, 80)}</text>
<text x="${w * 0.08}" y="${h * 0.9}" font-family="Arial" font-size="${Math.round(fs2 * 0.8)}" fill="#fff" opacity="0.8">${esc(brand.business)}</text></svg>`
  let img = sharp(Buffer.from(svg))
  if (brand.logo) {
    const logo = await sharp(brand.logo.endsWith('.svg') ? Buffer.from(readFileSync(brand.logo)) : brand.logo).resize({ height: Math.round(h * 0.12), fit: 'inside' }).png().toBuffer()
    img = img.composite([{ input: logo, top: Math.round(h * 0.08), left: Math.round(w * 0.08) }])
  }
  await img.png().toFile(outPath); return outPath
}

/** A generated picture through fal (FLUX); needs FAL_KEY on the box. */
export async function generateImage({ prompt, size = 'landscape_4_3' }, outPath) {
  const key = process.env.FAL_KEY; if (!key) throw new Error('Picture generation is not switched on for this Desk yet (no FAL_KEY).')
  const r = await fetch('https://fal.run/fal-ai/flux/schnell', { method: 'POST', headers: { authorization: `Key ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ prompt, image_size: size, num_images: 1, enable_safety_checker: true }), signal: AbortSignal.timeout(90000) })
  const j = await r.json().catch(() => ({})); const url = j.images?.[0]?.url
  if (!r.ok || !url) throw new Error(`Picture generation failed: ${j.detail ?? j.error ?? r.status}`)
  const bytes = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60000) })).arrayBuffer())
  await sharp(bytes).png().toFile(outPath); return outPath
}

/** Dominant colours of an image file (for brand detection). */
export async function dominantColours(file) {
  const { dominant } = await sharp(file).stats()
  const hex = c => c.toString(16).padStart(2, '0')
  return '#' + (hex(dominant.r) + hex(dominant.g) + hex(dominant.b)).toUpperCase()
}
