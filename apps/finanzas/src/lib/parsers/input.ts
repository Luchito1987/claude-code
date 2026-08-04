/**
 * Punto de entrada único para un archivo subido: decide si es planilla o texto
 * y devuelve los movimientos, sin que quien llama tenga que saber el formato.
 * Con una planilla de varias hojas se queda con la que más movimientos aporta,
 * que en un extracto bajado de Excel siempre es la del detalle.
 */

import { parseRows, parseStatement, type ParseOptions, type ParseResult } from './statement'
import { describeSheet, isSpreadsheet, readWorkbook, type Sheet } from './xlsx'

export interface FileParseResult extends ParseResult {
  /** Hoja elegida, cuando el origen fue una planilla. */
  sheetName?: string
  /** Estructura de todas las hojas, para diagnosticar cuando no se reconoce nada. */
  sheets?: Sheet[]
}

/** Los home banking exportan tanto UTF-8 como Windows-1252. */
export function decodeText(buffer: ArrayBuffer | Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer as ArrayBuffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer as ArrayBuffer)
  }
}

export async function parseUploadedFile(
  fileName: string,
  buffer: ArrayBuffer | Buffer,
  opts: ParseOptions,
): Promise<FileParseResult> {
  if (!isSpreadsheet(fileName)) {
    return parseStatement(decodeText(buffer), opts)
  }

  const sheets = await readWorkbook(buffer)
  let best: FileParseResult | null = null

  for (const sheet of sheets) {
    const parsed = parseRows(sheet.rows, opts)
    if (parsed && (!best || parsed.rows.length > best.rows.length)) {
      best = { ...parsed, sheetName: sheet.name }
    }
  }

  if (best?.rows.length) return { ...best, sheets }

  return {
    rows: [],
    skipped: sheets.reduce((a, s) => a + s.rows.length, 0),
    strategy: 'csv',
    sheets,
    warnings: [
      `Se leyeron ${sheets.length} hoja(s) pero ninguna tiene una tabla con columnas de fecha e importe.`,
      ...sheets.flatMap((s) => describeSheet(s, 4)),
    ],
  }
}
