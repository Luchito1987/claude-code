/** Parser CSV/TSV sin dependencias. Soporta comillas, comillas escapadas y CRLF. */

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  const candidates = [';', ',', '\t', '|']
  let best = ','
  let bestScore = -1
  for (const d of candidates) {
    // Cuenta separadores fuera de comillas, promediando por línea.
    const counts = sample.split(/\r?\n/).map((line) => countOutsideQuotes(line, d))
    const nonZero = counts.filter((c) => c > 0)
    if (!nonZero.length) continue
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length
    const consistency = nonZero.filter((c) => c === Math.round(avg)).length / nonZero.length
    const score = avg * consistency
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function countOutsideQuotes(line: string, delim: string): number {
  let inQuotes = false
  let n = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch === delim) n++
  }
  return n
}

export function parseCsv(text: string, delimiter?: string): string[][] {
  const clean = text.replace(/^﻿/, '')
  const delim = delimiter ?? detectDelimiter(clean)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += ch
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}
