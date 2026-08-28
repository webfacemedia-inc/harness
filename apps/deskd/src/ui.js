// Shared look for every deskd page: the homepage's identity (Fraunces
// headings, Inter Tight, brand blue), one top bar with the mark, icons on
// section headers, and buttons whose hover keeps its contrast.
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const MARK = '<svg class="mark" viewBox="0 0 171.28 177.92" aria-hidden="true"><path fill="currentColor" d="M170.38,128.74l.45-.99.36-.72v-.77l.09-.52-.2-.97-.29-.81-.49-.77-.45-.67-46.66-64.72-.23-.36,37.44-22.82.95-2.83-.29-.45-.14-.22v-.14l-.65-.77-.58-.83-.68-.74-.45-.52-.32-.38-.81-.9-.31-.29-.14-.16h0l-.43-.43-.99-.9-2.31-2.56-2.31-2.23-2.54-2.16-2.54-2.11-.9-.67-.9-.45-.9-.29h-1.78l-.92.22-.9.38-.74.67-52.22,33.35-1.33-.38,19.02-40.59-.4-2.7-1.53-1.04-1.66-.81-1.93-.83-2-.67-2.32-.68-2.38-.52-2.61-.52-2.76-.38-1.71-.07-.74.23-.67.36-.67.38-.52.67-.45.88-.38.97-.14.45-34.02,80.01-.38.31-.36.43-.52.31-.67.43-36.48-18.08-2.9.38-.43.68-.27.88-.76,1.94-.88,2.32-.79,2.79-.95,3.6-.83,3.37-.65,3.06-.4,2.92-.14,1.01v.95l.22.9.4.9.43.68.76.61.79.61.97.5.16.09.67.36,1.04.52,1.57.83,1.8.97,2.45,1.26,2.76,1.42,3.26,1.8,1.8.83,1.8.97,1.93.95,2.16,1.13,4.47,2.32,4.99,2.61,5.28,2.77,2.83,1.4,3.06,1.58,6.18,3.21,6.77,3.6.14,1.49-44.26,3.71-2.11,1.8-.13,1.64v1.8l.23,2.03.36,2.16.54,2.16.74,2.47.83,2.54,1.1,2.77.31.74.52.67.5.54.77.36.67.23.88.16h2.09l78.41-10.5,2.81,1.49.74,33.19.97.97.99,1.35.58-.09h.81l.9-.16,1.12-.14,1.12-.31,1.33-.31,1.42-.36,1.57-.31,3.6-1.04,1.8-.45,1.62-.45,1.51-.52,1.4-.43,2.67-.9.97-.61.38-.29.43-.22.31-.38.38-.31.29-.36.31-.31.14-.45v-.22h0l.14-.16v-.45l.14-.38v-1.93l-2.72-62.11,1.19-.97,25.34,36.63,2.59,1.13,1.26-.85,1.51-.95,1.46-1.28,1.66-1.35,1.64-1.64,1.8-1.8,1.8-2.09,2.02-2.18.14-.22.11.02Z"/></svg>'
const svg = (d, extra = '') => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`
export const ICONS = {
  google: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  webface: `<svg class="ic" viewBox="0 0 171.28 177.92" aria-hidden="true"><path fill="currentColor" d="M170.38,128.74l.45-.99.36-.72v-.77l.09-.52-.2-.97-.29-.81-.49-.77-.45-.67-46.66-64.72-.23-.36,37.44-22.82.95-2.83-.29-.45-.14-.22v-.14l-.65-.77-.58-.83-.68-.74-.45-.52-.32-.38-.81-.9-.31-.29-.14-.16h0l-.43-.43-.99-.9-2.31-2.56-2.31-2.23-2.54-2.16-2.54-2.11-.9-.67-.9-.45-.9-.29h-1.78l-.92.22-.9.38-.74.67-52.22,33.35-1.33-.38,19.02-40.59-.4-2.7-1.53-1.04-1.66-.81-1.93-.83-2-.67-2.32-.68-2.38-.52-2.61-.52-2.76-.38-1.71-.07-.74.23-.67.36-.67.38-.52.67-.45.88-.38.97-.14.45-34.02,80.01-.38.31-.36.43-.52.31-.67.43-36.48-18.08-2.9.38-.43.68-.27.88-.76,1.94-.88,2.32-.79,2.79-.95,3.6-.83,3.37-.65,3.06-.4,2.92-.14,1.01v.95l.22.9.4.9.43.68.76.61.79.61.97.5.16.09.67.36,1.04.52,1.57.83,1.8.97,2.45,1.26,2.76,1.42,3.26,1.8,1.8.83,1.8.97,1.93.95,2.16,1.13,4.47,2.32,4.99,2.61,5.28,2.77,2.83,1.4,3.06,1.58,6.18,3.21,6.77,3.6.14,1.49-44.26,3.71-2.11,1.8-.13,1.64v1.8l.23,2.03.36,2.16.54,2.16.74,2.47.83,2.54,1.1,2.77.31.74.52.67.5.54.77.36.67.23.88.16h2.09l78.41-10.5,2.81,1.49.74,33.19.97.97.99,1.35.58-.09h.81l.9-.16,1.12-.14,1.12-.31,1.33-.31,1.42-.36,1.57-.31,3.6-1.04,1.8-.45,1.62-.45,1.51-.52,1.4-.43,2.67-.9.97-.61.38-.29.43-.22.31-.38.38-.31.29-.36.31-.31.14-.45v-.22h0l.14-.16v-.45l.14-.38v-1.93l-2.72-62.11,1.19-.97,25.34,36.63,2.59,1.13,1.26-.85,1.51-.95,1.46-1.28,1.66-1.35,1.64-1.64,1.8-1.8,1.8-2.09,2.02-2.18.14-.22.11.02Z"/></svg>`,
  wordpress: svg('<circle cx="12" cy="12" r="9"/><path d="M6.5 8.5h3M14.5 8.5h3M9 8.5l3 9 3-9M7 8.5l4 10M13 8.5l4 10"/>'),
  plug: svg('<path d="M9 2v6M15 2v6M7 8h10l-1 6a4 4 0 0 1-8 0z"/><path d="M12 18v4"/>'),
  business: svg('<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"/>'),
  files: svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  voice: svg('<path d="M12 3v18M7 8v8M17 8v8M3 11v2M21 11v2"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  rules: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 9.2-9.2M15 8l3 3"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  upload: svg('<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>'),
  back: svg('<path d="M19 12H5M12 19l-7-7 7-7"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
}
export const CSS = `
:root{color-scheme:light dark;--bg:#f5f8fb;--card:#ffffff;--ink:#152029;--mute:#5a6a78;--line:#dfe6ec;--blue:#3499cc;--deep:#1f6f99;--tint:#eef6fb;--ok:#1f8a5b;--err:#b42318;--ok-bg:rgba(31,138,91,.10);--err-bg:rgba(180,35,24,.08)}
@media(prefers-color-scheme:dark){:root{--bg:#0e141a;--card:#151d25;--ink:#eef3f7;--mute:#9db0c0;--line:#26323d;--tint:#14232d}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15.5px/1.55 "Inter Tight",-apple-system,"Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
h1,h2{font-family:Fraunces,Georgia,serif;font-weight:600;letter-spacing:-.01em;text-wrap:balance;margin:0}
h1{font-size:28px;line-height:1.15;margin-bottom:6px}h2{font-size:19px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 6px}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--line);background:var(--card)}
.top .brand{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:600}.top .brand .mark{width:26px;height:27px;color:var(--blue)}.top .brand span{font-weight:400}
.top .who{color:var(--mute);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:45%}
main{max-width:760px;margin:0 auto;padding:24px 20px 72px;overflow-x:hidden}
p{margin:0 0 12px}p.sub{color:var(--mute);margin:0 0 22px;font-size:16px}p.h{color:var(--mute);font-size:14px;margin:0 0 8px}
section,.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin-bottom:18px}
.ic{width:22px;height:22px;flex:none;color:var(--blue)}h2 .ic{width:24px;height:24px}
.pill{font-size:12px;padding:3px 9px;border-radius:999px;background:var(--ok-bg);color:var(--ok);font-weight:600;white-space:nowrap;flex:none}.pill.off{background:rgba(91,107,122,.12);color:var(--mute)}
label{display:block;font-weight:600;font-size:13px;margin:14px 0 6px}label small{font-weight:400;color:var(--mute)}
input,textarea,select{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
input:focus,textarea:focus,select:focus{outline:2px solid var(--blue);outline-offset:1px;border-color:var(--blue)}textarea{resize:vertical}
.btn,button{display:inline-flex;align-items:center;gap:8px;padding:11px 16px;border:1px solid var(--blue);border-radius:10px;background:var(--blue);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;line-height:1.2;margin:6px 8px 6px 0}
.btn:hover,button:hover{background:var(--deep);border-color:var(--deep);color:#fff}
.btn:focus-visible,button:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.ghost,.btn.ghost,button.ghost{background:transparent;color:var(--deep);border-color:var(--line)}
.ghost:hover,.btn.ghost:hover,button.ghost:hover{background:var(--tint);color:var(--deep);border-color:var(--blue)}
.quiet,button.quiet{background:transparent;color:var(--err);border-color:var(--line);padding:6px 10px;font-size:13px;margin:0}.quiet:hover,button.quiet:hover{background:var(--err-bg);color:var(--err);border-color:var(--err)}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}.row small{color:var(--mute);display:block;overflow-wrap:anywhere}
.msg{padding:10px 12px;border-radius:10px;margin:0 0 14px;font-size:14px}.msg.ok{background:var(--ok-bg);color:var(--ok)}.msg.err{background:var(--err-bg);color:var(--err)}
details{margin-top:10px}summary{cursor:pointer;color:var(--deep);font-weight:600}
code{font-size:13px;background:rgba(127,127,127,.12);padding:2px 6px;border-radius:6px;overflow-wrap:anywhere;word-break:break-all}a{color:var(--deep)}
.steps{display:flex;gap:6px;margin:0 0 18px}.steps i{flex:1;height:5px;border-radius:3px;background:var(--line)}.steps i.done{background:var(--ok)}.steps i.now{background:var(--blue)}
.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--deep);margin:0 0 8px;font-weight:600}
.copy{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}.copy code{flex:1 1 auto;min-width:0;padding:8px 10px;border-radius:8px}
.nav{display:flex;justify-content:space-between;align-items:center;margin-top:16px;gap:8px;flex-wrap:wrap}
.tones{display:grid;gap:8px;margin-top:6px}.tones label{display:flex;gap:10px;align-items:flex-start;font-weight:500;margin:0;padding:10px 12px;border:1px solid var(--line);border-radius:10px;cursor:pointer}.tones input{width:auto;margin-top:3px}.tones small{display:block;font-weight:400;color:var(--mute)}
.checks label{display:flex;gap:10px;align-items:center;font-weight:500;margin:8px 0}.checks input{width:auto}
.next{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}tr:last-child td{border-bottom:0}
td.n a{color:inherit;text-decoration:none;font-weight:500}td.n a:hover{color:var(--deep)}td.s,td.d{color:var(--mute);white-space:nowrap;font-variant-numeric:tabular-nums}td.a{text-align:right}
.drop{border:2px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--mute);margin-bottom:18px;background:var(--card)}.drop.over{border-color:var(--blue);color:var(--deep)}.drop label{display:inline;color:var(--deep);font-weight:600;cursor:pointer;margin:0;font-size:inherit}.drop input{display:none}
.empty{padding:28px;text-align:center;color:var(--mute)}#status{color:var(--mute);font-size:13px;min-height:18px;margin:8px 0}
@media(max-width:600px){td.d{display:none}th:nth-child(3){display:none}}
`
/** Page frame shared by every deskd page. */
export function layout({ title, business, body, back = '/', backLabel = 'Back to Desk', head = '' }) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · webfaCe Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter+Tight:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>${head}
<body><div class="top"><a class="brand" href="${esc(back)}">${MARK}<b>webfaCe</b>&nbsp;<span>Desk</span></a><span class="who">${esc(business)}</span></div><main>${body}</main></body></html>`
}
