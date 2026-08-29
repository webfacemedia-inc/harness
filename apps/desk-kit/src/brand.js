// The brand every deliverable is dressed in. Comes from the Desk's Business
// profile (profile.json → brand) and the logo saved under DESK_BRAND_DIR. With
// no brand set, documents fall back to a neutral style — never our own colours.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const PROFILE = process.env.DESK_PROFILE_FILE ?? '/srv/desk/profile.json'
export const BRAND_DIR = process.env.DESK_BRAND_DIR ?? '/srv/desk/brand'
export const WORK = process.env.DESK_WORK_DIR ?? '/srv/desk/work'

const FONTS = {
  editorial: { display: 'Fraunces, Georgia, serif', body: '"Inter Tight", Inter, Arial, sans-serif', docx: 'Georgia', deck: 'Georgia' },
  classic: { display: 'Georgia, serif', body: '"Helvetica Neue", Helvetica, Arial, sans-serif', docx: 'Georgia', deck: 'Arial' },
  plain: { display: 'Arial, sans-serif', body: 'Arial, sans-serif', docx: 'Arial', deck: 'Arial' },
}
const hex = v => { const m = String(v ?? '').trim().match(/^#?([0-9a-f]{6})$/i); return m ? m[1].toUpperCase() : null }

/** @returns {{business:string,address:string,phone:string,email:string,website:string,owner:string,tagline:string,primary:string|null,accent:string|null,ink:string,muted:string,zebra:string,font:{display:string,body:string,docx:string,deck:string},logo:string|null,logoMime:string|null,set:boolean}} */
export function readBrand() {
  let p = {}
  try { p = JSON.parse(readFileSync(PROFILE, 'utf8')) } catch {}
  const b = p.brand ?? {}
  const primary = hex(b.primary), accent = hex(b.accent) ?? primary
  let logo = null, logoMime = null
  if (existsSync(BRAND_DIR)) {
    const f = readdirSync(BRAND_DIR).find(n => /^logo\.(png|jpe?g|svg|webp)$/i.test(n))
    if (f) { logo = join(BRAND_DIR, f); logoMime = /svg$/i.test(f) ? 'image/svg+xml' : /png$/i.test(f) ? 'image/png' : /webp$/i.test(f) ? 'image/webp' : 'image/jpeg' }
  }
  return {
    business: p.business ?? 'Your business', address: p.address ?? '', phone: p.phone ?? '', email: p.email ?? '', website: p.website ?? '', owner: p.owner ?? '',
    tagline: b.tagline ?? '',
    primary, accent, ink: '1F2933', muted: '6B7280', zebra: primary ? tint(primary) : 'F3F4F6',
    font: FONTS[b.font] ?? FONTS.classic, logo, logoMime, set: Boolean(primary || logo),
  }
}
/** A very light tint of a hex colour for zebra rows / callouts. */
export function tint(h) {
  const n = parseInt(h, 16); const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const mix = c => Math.round(c + (255 - c) * 0.9).toString(16).padStart(2, '0')
  return (mix(r) + mix(g) + mix(b)).toUpperCase()
}
/** Logo as a data URI for HTML/PDF, or null. */
export function logoDataUri(brand) {
  if (!brand.logo) return null
  return `data:${brand.logoMime};base64,${readFileSync(brand.logo).toString('base64')}`
}
/** The colour used for headings/tables: the brand's, or a neutral dark grey. */
export const accentOf = brand => brand.accent ?? '374151'
