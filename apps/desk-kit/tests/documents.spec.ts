// desk-kit is a plain-JS MCP server shipped as source, outside both TypeScript programs; these
// tests are .ts only because the vitest include glob is *.spec.ts, which leaves every value
// crossing the import boundary untyped — the rules disabled below report that boundary, never a
// defect.
/* oxlint-disable typescript/no-unsafe-assignment */
/* oxlint-disable typescript/no-unsafe-call */
/* oxlint-disable typescript/no-unsafe-member-access */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decodeEntities, tidyMarkdown } from '../src/tidy.js'
import { letterhead, deckLetterhead } from '../src/pdf.js'

// Every case here reached an owner as a broken document before it became a test.

const BRAND = {
  business: 'Maple & Main Plumbing', address: '12 Main St, Toronto, ON', phone: '416-555-0100',
  email: 'hello@maplemain.ca', website: 'https://maplemain.ca', owner: 'Dana', tagline: 'Fast, tidy, guaranteed.',
  primary: '1F6F99', accent: '3499CC', ink: '1F2933', muted: '6B7280', zebra: 'EEF6FB',
  font: { display: 'Georgia, serif', body: 'Helvetica, Arial, sans-serif', docx: 'Georgia', deck: 'Arial' },
  logo: null, logoMime: null, set: true,
}

describe('what a model writes becomes what a document needs', () => {
  it('decodes the entities that printed literally, and only those', () => {
    expect(decodeEntities('Maple &amp; Main &ndash; est. 2019')).toBe('Maple & Main – est. 2019')
    // Text must stay text: &lt; and &gt; never decode, so nothing can become markup.
    expect(decodeEntities('5 &lt; 7 &gt; 3')).toBe('5 &lt; 7 &gt; 3')
    expect(decodeEntities('&amp;nbsp;')).toBe('&nbsp;')
  })

  it('rebuilds a table squashed onto one line', () => {
    const tidied = tidyMarkdown('| Week | What | |------|------| | Week 1 | Kick-off | | Week 2 | Design |')
    expect(tidied.split('\n')).toEqual(['| Week | What |', '|------|------|', '| Week 1 | Kick-off |', '| Week 2 | Design |'])
  })

  it('splits a bullet run glued into one paragraph', () => {
    expect(tidyMarkdown('- Toronto studio - We design and build - Every site is mobile-first').split('\n')).toHaveLength(3)
  })

  it('splits a squashed numbered run', () => {
    expect(tidyMarkdown('1. Worksheet goes out 2. Kick-off call 3. Deposit invoice').split('\n')).toEqual([
      '1. Worksheet goes out', '2. Kick-off call', '3. Deposit invoice',
    ])
  })

  it('leaves an ordinary bullet with one hyphenated phrase alone', () => {
    const line = '- A well-known plumber - trusted since 2019'
    expect(tidyMarkdown(line)).toBe(line)
  })

  it('never touches fenced code', () => {
    const md = '```\n| not | a | table |\n- not - a - list\n```'
    expect(tidyMarkdown(md)).toBe(md)
  })
})

describe('the letterhead', () => {
  it('prints an escaped title as its real characters, once', () => {
    const html = letterhead('# Quote — Maple &amp; Main\n\nBody.', BRAND)
    expect(html).toContain('Quote — Maple &amp; Main</h1>') // single-escaped: renders as "&"
    expect(html).not.toContain('&amp;amp;')
  })

  it('renders a squashed table as a real table', () => {
    const html = letterhead('# T\n\n| Week | What | |------|------| | Week 1 | Kick-off |', BRAND)
    expect(html).toContain('<table>')
    expect(html).toContain('<td>Kick-off</td>')
  })

  it('keeps the closing line in flow after the content, never positioned over it', () => {
    const html = letterhead('# T\n\nBody.', BRAND)
    expect(html.indexOf('class="end"')).toBeGreaterThan(html.indexOf('Body.'))
    expect(html).not.toMatch(/class="end"[^>]*position\s*:\s*(fixed|absolute)/)
  })
})

describe('the deck PDF preview', () => {
  const DECK = '# Maple &amp; Main — deck\n\n## Who we are\n\n- One\n- Two\n\n## Pricing\n\n| Item | Cost |\n|---|---|\n| Site | $6,900 |\n'

  it('parses each slide as markdown — bullets and tables, never literal pipes', () => {
    const html = deckLetterhead(DECK, BRAND, 'Maple &amp; Main — deck')
    expect(html).toContain('<li>One</li>')
    expect(html).toContain('<td>$6,900</td>')
    expect(html).not.toContain('|---|')
  })

  it('says the title once, and puts no page break after the last slide', () => {
    const html = deckLetterhead(DECK, BRAND, 'Maple &amp; Main — deck')
    expect(html.match(/Maple &amp; Main — deck/g)).toHaveLength(2) // <title> + the h1, no repeated section
    const sections = [...html.matchAll(/<section style="([^"]*)"/g)].map(m => m[1])
    expect(sections.at(-1)).toBe('')
    expect(sections.slice(0, -1).every(s => s.includes('page-break-after'))).toBe(true)
  })
})

describe('the docx walker', () => {
  // The vendored docx engine is TypeScript the product loads through tsx; vitest's own
  // transform refuses the vendor tree, so this runs it exactly as the MCP server does.
  it('writes decoded entities and both tables, and treats __ as bold', () => {
    const kit = join(dirname(fileURLToPath(import.meta.url)), '..')
    const script = `
      import { markdownToDocx } from './src/docx.js'
      import JSZip from 'jszip'
      const brand = ${JSON.stringify(BRAND)}
      const buf = await markdownToDocx('# Quote — Maple &amp; Main\\n\\n__Total__ due for Maple &amp; Main.\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |\\n\\n| C | D | |---|---| | 3 | 4 |', brand)
      const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')
      process.stdout.write(xml)
    `
    const xml = execFileSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', script], { cwd: kit, encoding: 'utf8', timeout: 60_000 })
    expect(xml).not.toContain('&amp;amp;')
    expect(xml).toContain('Maple &amp; Main') // single-escaped in XML: renders as "&"
    expect((xml.match(/<w:tbl>/g) ?? [])).toHaveLength(2)
    expect(xml).toMatch(/<w:b\/>[^>]*<\/w:rPr><w:t[^>]*>Total/)
  })
})
