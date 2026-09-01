// Produces one of everything into DESK_WORK_DIR with a sample brand; run with
// DESK_PROFILE_FILE/DESK_BRAND_DIR/DESK_WORK_DIR pointing at a scratch folder.
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { readBrand, WORK } from './brand.js'
import { markdownToDocx } from './docx.js'
import { letterhead, htmlToPdf } from './pdf.js'
import { markdownToPptx } from './pptx.js'
import { sheetsToXlsx } from './sheet.js'
import { brandImage } from './image.js'
const brand = readBrand(); mkdirSync(WORK, { recursive: true })
// The content that has actually broken documents: escaped entities, a squashed
// table, a squashed bullet run. tidy must absorb all of it.
const rough = `# Rough &amp; Ready Check\n\n| Week | What | |------|------| | Week 1 | Kick-off | | Week 2 | Design |\n\n- one - two - three\n`
const md = `# Quote for Dana Okafor\n\nThanks for the clear picture of what you need.\n\n## What we propose\n\n- A Growth site with online booking and review collection\n- Hosting and care plan\n\n| Item | Qty | Price |\n|---|---|---|\n| Growth site | 1 | $6,900 |\n| Hosting + care | 1/mo | $149 |\n\n> Quotes are valid for 30 days.\n`
writeFileSync(join(WORK, 'test.docx'), await markdownToDocx(md, brand)); console.log('docx ok')
htmlToPdf(letterhead(md, brand), join(WORK, 'test.pdf')); console.log('pdf ok')
const roughHtml = letterhead(rough, brand)
if (!roughHtml.includes('<table>') || !roughHtml.includes('<li>') || roughHtml.includes('&amp;amp;')) throw new Error('tidy failed: rough markdown did not become a table, a list, and a real ampersand')
htmlToPdf(roughHtml, join(WORK, 'test-rough.pdf')); console.log('rough pdf ok')
writeFileSync(join(WORK, 'test.pptx'), await markdownToPptx(md.replace('## What we propose', '## What we propose\n\n- One\n- Two\n\n## Pricing'), brand)); console.log('pptx ok')
await sheetsToXlsx([{ name: 'Quote', columns: ['Item', 'Qty', 'Price'], rows: [['Growth site', 1, 6900], ['Hosting + care', 1, 149]], totals: { label: 'Total', columns: [2] } }], brand, join(WORK, 'test.xlsx')); console.log('xlsx ok')
await brandImage({ kind: 'og', headline: 'Quotes in minutes', text: 'From your own price list.' }, brand, join(WORK, 'test-og.png')); console.log('png ok')
console.log('brand:', { business: brand.business, primary: brand.primary, logo: brand.logo, set: brand.set })
