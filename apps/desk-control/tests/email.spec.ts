// The email template's contract: branded, and locked light — iPhone Mail's
// dark mode must find nothing to invert. These assertions pin the three
// defence layers so a refactor cannot quietly drop one.
import { describe, expect, it } from 'vitest'
import { renderEmail, esc, p, btn, link, panel, muted, restyleParagraphs } from '../convex/email'

describe('renderEmail', () => {
  const html = renderEmail({
    title: 'Your Desk is ready',
    preheader: 'The preview line',
    body: p('Hello there.') + btn('https://example.com/x', 'Open') + panel(p('inset')) + muted('small print'),
  })

  it('declares light only, both meta and CSS', () => {
    expect(html).toContain('<meta name="color-scheme" content="light only">')
    expect(html).toContain('<meta name="supported-color-schemes" content="light only">')
    expect(html).toContain(':root{color-scheme:light only')
  })

  it('re-asserts the light palette under a dark scheme with !important', () => {
    const dark = html.slice(html.indexOf('@media (prefers-color-scheme:dark)'))
    for (const rule of ['background-color:#edf2f6!important', 'background-color:#fffffe!important', 'color:#17222b!important']) {
      expect(dark).toContain(rule)
    }
  })

  it('paints every surface and every paragraph explicitly', () => {
    expect(html).toMatch(/<body[^>]*bgcolor="#edf2f6"[^>]*background-color:#edf2f6/)
    for (const par of html.split('<p ').slice(1)) expect(par.slice(0, par.indexOf('>'))).toContain('color:#')
    // Off-white and near-black, never pure #fff/#000 the crude inverters key on.
    expect(html).not.toMatch(/#fff[^ef]/)
    expect(html).not.toContain('#000')
  })

  it('carries the brand and the footer voice', () => {
    expect(html).toContain('webfaCe')
    expect(html).toContain('#3499cc')
    expect(html).toContain('webfaCeMEdia &middot; Toronto')
    expect(html).not.toContain('Inc')
  })

  it('escapes the title and preheader', () => {
    const evil = renderEmail({ title: '<b>x</b>', preheader: '<i>y</i>', body: '' })
    expect(evil).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(evil).toContain('&lt;i&gt;y&lt;/i&gt;')
  })
})

describe('helpers', () => {
  it('esc covers the four HTML metacharacters', () => {
    expect(esc('<a href="&">')).toBe('&lt;a href=&quot;&amp;&quot;&gt;')
  })

  it('link and btn escape their hrefs', () => {
    expect(link('https://x/"onmouseover="1', 'go')).toContain('&quot;onmouseover=&quot;')
    expect(btn('https://x/"y', 'go')).toContain('&quot;y')
  })

  it('restyleParagraphs dresses bare paragraphs and escapes plain text', () => {
    expect(restyleParagraphs('<p>one</p><p>two</p>')).not.toContain('<p>')
    expect(restyleParagraphs('<p>one</p>')).toContain('color:#17222b')
    expect(restyleParagraphs('a < b')).toContain('a &lt; b')
  })
})
