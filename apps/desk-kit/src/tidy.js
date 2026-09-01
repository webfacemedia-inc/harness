// Defence against the markdown a model actually writes, applied at every tool
// boundary before a document is generated. Two failure classes have reached
// owners' hands:
//
//   1. Pre-escaped entities — a title of "Maple &amp; Main" was escaped again by
//      the letterhead and printed literally. Only entities that cannot create
//      markup are decoded; &lt; and &gt; stay escaped so text can never become
//      HTML in the PDF path.
//   2. Squashed blocks — a whole table on one line ("| Week | What | |---|---| |
//      Week 1 | ... |") or a bullet run glued into one paragraph ("- one - two -
//      three") renders as a paragraph of pipes and dashes. The seams are
//      recovered conservatively: only lines that already start as a table row or
//      list item are ever split.

const ENTITIES = [
  [/&nbsp;/g, ' '],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
  [/&rsquo;/g, '’'],
  [/&lsquo;/g, '‘'],
  [/&rdquo;/g, '”'],
  [/&ldquo;/g, '“'],
  [/&ndash;/g, '–'],
  [/&mdash;/g, '—'],
  [/&hellip;/g, '…'],
  [/&amp;/g, '&'], // last, so "&amp;nbsp;" resolves in one pass without ever looping to a full unescape
]

/** Decode the entities a model leaves in plain text. Never &lt;/&gt; — text must stay text. */
export function decodeEntities(s) {
  let out = String(s ?? '')
  for (const [re, to] of ENTITIES) out = out.replace(re, to)
  return out
}

/** A table squashed onto one line: row seams show as "| |". Put the newlines back. */
function unsquashTableLine(line) {
  const t = line.trim()
  if (!t.startsWith('|') || !/\|\s*:?-{3,}/.test(t) || !/\|\s+\|/.test(t)) return line
  return t.replace(/\|\s+\|/g, '|\n|')
}

/**
 * A bullet run glued into one paragraph. Applies only to a line that already
 * starts as a list item and carries at least two more separators, so the worst
 * a false match can do is split one long item in two.
 */
function unsquashListLine(line) {
  const t = line.trim()
  if (/^[-*]\s+\S/.test(t)) {
    const parts = t.split(/\s+-\s+/)
    if (parts.length >= 3) return parts.map((p, i) => (i === 0 ? p : `- ${p}`)).join('\n')
  }
  if (/^\d+\.\s+\S/.test(t)) {
    const parts = t.split(/\s+(?=\d+\.\s)/)
    if (parts.length >= 3) return parts.join('\n')
  }
  return line
}

/**
 * Markdown as the generators should see it: entities decoded, squashed tables
 * and lists reflowed. Fenced code is passed through untouched.
 * @param md - markdown as the model wrote it.
 * @returns markdown safe to hand to marked / the docx and pptx walkers.
 */
export function tidyMarkdown(md) {
  const lines = decodeEntities(String(md ?? '').replace(/\r\n/g, '\n')).split('\n')
  const out = []
  let fenced = false
  for (const line of lines) {
    if (line.trim().startsWith('```')) { fenced = !fenced; out.push(line); continue }
    if (fenced) { out.push(line); continue }
    out.push(unsquashListLine(unsquashTableLine(line)))
  }
  return out.join('\n')
}

/** One line of plain text (a title, a sheet name): entities decoded, whitespace collapsed. */
export const tidyText = s => decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim()
