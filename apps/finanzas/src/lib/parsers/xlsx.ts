/**
 * Lectura de planillas (.xlsx / .xlsm). Convierte cada hoja a una matriz de
 * strings para que la use el mismo detector de columnas que el CSV: así un
 * extracto bajado en Excel y uno en CSV siguen el mismo camino.
 *
 * Lo único que necesita cuidado son las fechas y los números, que en Excel no
 * son texto: se normalizan a 'YYYY-MM-DD' y a un decimal con punto, que es lo
 * que `parseDate` y `toCents` esperan.
 */

import ExcelJS from 'exceljs'

export interface Sheet {
  name: string
  rows: string[][]
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) {
    // Excel guarda las fechas en UTC; se lee en UTC para no correr un día.
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value.trim()

  const obj = value as Record<string, unknown>

  // Celda con fórmula: interesa el resultado, no la fórmula.
  if ('result' in obj) return cellToString(obj.result)
  // Texto enriquecido: se concatenan los fragmentos.
  if ('richText' in obj && Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('').trim()
  }
  if ('text' in obj) return cellToString(obj.text)
  if ('hyperlink' in obj) return cellToString(obj.text ?? obj.hyperlink)
  if ('error' in obj) return ''

  return String(value)
}

export async function readWorkbook(buffer: ArrayBuffer | Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook()
  // exceljs declara su propio tipo Buffer, incompatible con el de Node aunque
  // en tiempo de ejecución sea el mismo objeto.
  await wb.xlsx.load(buffer as never)

  const sheets: Sheet[] = []
  wb.eachSheet((ws) => {
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // `row.values` viene con un hueco en el índice 0.
      const values = row.values as unknown[]
      for (let i = 1; i < values.length; i++) cells.push(cellToString(values[i]))
      // Quita las columnas vacías del final, que Excel arrastra de más.
      while (cells.length && cells[cells.length - 1] === '') cells.pop()
      if (cells.some((c) => c !== '')) rows.push(cells)
    })
    sheets.push({ name: ws.name, rows })
  })
  return sheets
}

export function isSpreadsheet(fileName: string): boolean {
  return /\.(xlsx|xlsm|xltx)$/i.test(fileName)
}

/** Resumen de estructura, para poder mirar una planilla desconocida sin abrirla. */
export function describeSheet(sheet: Sheet, preview = 8): string[] {
  const columnas = Math.max(0, ...sheet.rows.map((r) => r.length))
  const out = [`Hoja "${sheet.name}": ${sheet.rows.length} filas × ${columnas} columnas`]
  for (const row of sheet.rows.slice(0, preview)) {
    out.push('  ' + row.map((c) => (c.length > 18 ? `${c.slice(0, 17)}…` : c)).join(' | '))
  }
  if (sheet.rows.length > preview) out.push(`  … ${sheet.rows.length - preview} filas más`)
  return out
}
