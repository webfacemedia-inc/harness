// The platform email look — the same template as the Convex control plane's
// convex/email.ts (that copy is the future; this one retires with deskapi at
// cut-over). White card on a cool light ground, serif title, brand-blue
// button, and a palette locked light three ways so iPhone Mail's dark mode
// cannot invert it: `color-scheme: light only`, explicit colours on every
// element, and a dark-scheme media query re-asserting the light palette.
const INK = '#17222b'
const MUTE = '#5c6b76'
const LINE = '#dfe6ea'
const PAPER = '#edf2f6'
const CARD = '#fffffe'
const BLUE = '#3499cc'
const DEEP = '#1f6f99'
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const SERIF = "Georgia,'Times New Roman',serif"

export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const p = html => `<p class="ink" style="margin:0 0 14px;font:15px/1.6 ${SANS};color:${INK}">${html}</p>`

export const link = (href, label) => `<a href="${esc(href)}" style="color:${DEEP};text-decoration:underline">${label}</a>`

export const btn = (href, label) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0"><tr><td class="btn" bgcolor="${BLUE}" style="background-color:${BLUE};border-radius:10px">` +
  `<a href="${esc(href)}" style="display:inline-block;padding:12px 24px;font:600 15px ${SANS};color:${CARD};text-decoration:none">${label}</a>` +
  `</td></tr></table>`

export const panel = inner =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px"><tr><td class="tint" bgcolor="#eef6fb" style="background-color:#eef6fb;border-radius:10px;padding:14px 16px">${inner}</td></tr></table>`

export const muted = html => `<p class="mute" style="margin:14px 0 0;font:13px/1.6 ${SANS};color:${MUTE}">${html}</p>`

export function renderEmail({ title, body, preheader }) {
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}${'&nbsp;&zwnj;'.repeat(24)}</div>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">` +
    `<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">` +
    `<title>${esc(title)}</title><style>` +
    `:root{color-scheme:light only;supported-color-schemes:light only}` +
    `@media (prefers-color-scheme:dark){` +
    `body,.paper{background-color:${PAPER}!important}` +
    `.card{background-color:${CARD}!important}` +
    `.tint{background-color:#eef6fb!important}` +
    `.ink,h1{color:${INK}!important}` +
    `.mute{color:${MUTE}!important}` +
    `.btn{background-color:${BLUE}!important}.btn a{color:${CARD}!important}` +
    `}` +
    `[data-ogsc] .ink,[data-ogsc] h1{color:${INK}!important}[data-ogsc] .mute{color:${MUTE}!important}` +
    `[data-ogsb] body,[data-ogsb] .paper{background-color:${PAPER}!important}[data-ogsb] .card{background-color:${CARD}!important}` +
    `</style></head>` +
    `<body class="paper" bgcolor="${PAPER}" style="margin:0;padding:0;background-color:${PAPER}">${pre}` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="paper" bgcolor="${PAPER}" style="background-color:${PAPER}"><tr><td align="center" style="padding:36px 16px 28px">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px">` +
    `<tr><td style="padding:0 6px 14px">` +
    `<span class="ink" style="font:600 17px ${SANS};color:${INK}">webfaCe</span>` +
    `<span style="font:600 19px ${SERIF};color:${DEEP}">&thinsp;Desk</span>` +
    `</td></tr>` +
    `<tr><td class="card" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${LINE};border-radius:14px;padding:28px 28px 22px">` +
    `<h1 style="margin:0 0 14px;font:600 24px/1.3 ${SERIF};color:${INK};letter-spacing:-.01em">${esc(title)}</h1>` +
    body +
    `</td></tr>` +
    `<tr><td style="padding:16px 6px 0"><p class="mute" style="margin:0;font:13px/1.7 ${SANS};color:${MUTE}">webfaCeMEdia &middot; Toronto<br>Questions? Just reply &mdash; a person reads this inbox.</p></td></tr>` +
    `</table></td></tr></table></body></html>`
}
