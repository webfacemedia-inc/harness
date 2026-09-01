// Tables → .xlsx (and .csv) with the header row in the brand colour.
import ExcelJS from 'exceljs'
import { accentOf } from './brand.js'
import { decodeEntities, tidyText } from './tidy.js'

/** sheets: [{ name, columns: [..], rows: [[..]], totals?: { label, columns: [colIndex..] } }] */
export async function sheetsToXlsx(sheets, brand, outPath) {
  const wb = new ExcelJS.Workbook(); wb.creator = brand.business
  for (const s of sheets) {
    const ws = wb.addWorksheet((tidyText(s.name) || 'Sheet').slice(0, 31))
    ws.addRow(s.columns.map(c => tidyText(c))); const h = ws.getRow(1)
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + accentOf(brand) } }
    for (const r of s.rows) ws.addRow(r.map(v => { if (typeof v !== 'string') return v; const t = decodeEntities(v); return /^-?\$?\d[\d,]*(\.\d+)?$/.test(t) ? Number(t.replace(/[$,]/g, '')) : t }))
    if (s.totals) {
      const row = ws.addRow([]); row.getCell(1).value = s.totals.label ?? 'Total'; row.font = { bold: true }
      for (const c of s.totals.columns ?? []) { const col = ws.getColumn(c + 1).letter; row.getCell(c + 1).value = { formula: `SUM(${col}2:${col}${ws.rowCount - 1})` } }
    }
    ws.columns.forEach(col => { let w = 10; col.eachCell({ includeEmpty: false }, cell => { w = Math.max(w, Math.min(60, String(cell.value ?? '').length + 2)) }); col.width = w })
    ws.views = [{ state: 'frozen', ySplit: 1 }]
  }
  await wb.xlsx.writeFile(outPath)
  const first = sheets[0]; const csv = [first.columns, ...first.rows].map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  return { xlsx: outPath, csv }
}
