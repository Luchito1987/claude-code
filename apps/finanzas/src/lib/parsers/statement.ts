/**
 * Importador de extractos. Acepta CSV/TSV de home banking y también texto pegado
 * desde un PDF (los bancos argentinos casi siempre exportan uno u otro).
 *
 * La estrategia es tolerante a formatos: se busca la fila de encabezados por
 * palabras clave y, si no aparece, se cae a un parseo por líneas con regex
 * (fecha ... descripción ... importe).
 */

import { createHash } from 'node:crypto'
import { parseCsv } from './csv'
import { toCents } from '../money'
import { categorize, extractMerchant, isRappi, mapCategoryName, type UserRule } from '../categories'
import type { ISODate } from '../dates'

export interface ParsedRow {
  date: ISODate
  description: string
  merchant: string
  amountCents: number
  category: string
  installment: string
  currency: string
  rappi: boolean
  raw: string
}

export interface ParseResult {
  rows: ParsedRow[]
  skipped: number
  delimiter?: string
  columns?: Record<string, number>
  strategy: 'csv' | 'text'
  warnings: string[]
}

const HEADER_HINTS = {
  date: ['fecha', 'date', 'f. operacion', 'fecha operacion', 'fecha oper', 'fec.', 'dia'],
  description: ['descripcion', 'detalle', 'concepto', 'comercio', 'movimiento', 'description', 'referencia'],
  amount: ['importe', 'monto', 'amount', 'valor', 'pesos', 'importe pesos', 'total'],
  debit: ['debito', 'debitos', 'cargo', 'egreso'],
  credit: ['credito', 'creditos', 'abono', 'ingreso', 'haber'],
  installment: ['cuota', 'cuotas', 'plan'],
  currency: ['moneda', 'divisa'],
  category: ['categoria', 'rubro', 'clasificacion', 'tipo de gasto'],
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchColumn(headers: string[], hints: string[]): number {
  const normed = headers.map(norm)
  for (const hint of hints) {
    const exact = normed.indexOf(hint)
    if (exact !== -1) return exact
  }
  for (const hint of hints) {
    const partial = normed.findIndex((h) => h.includes(hint))
    if (partial !== -1) return partial
  }
  return -1
}

/** Encuentra la fila que parece encabezado dentro de las primeras 15. */
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].map(norm)
    const hasDate = cells.some((c) => HEADER_HINTS.date.some((h) => c.includes(h)))
    const hasAmount = cells.some((c) =>
      [...HEADER_HINTS.amount, ...HEADER_HINTS.debit, ...HEADER_HINTS.credit].some((h) => c.includes(h)),
    )
    if (hasDate && hasAmount) return i
  }
  return -1
}

const DATE_PATTERNS: Array<{ re: RegExp; order: 'dmy' | 'ymd' }> = [
  { re: /(\d{4})-(\d{2})-(\d{2})/, order: 'ymd' },
  { re: /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/, order: 'dmy' },
]

const MONTH_ABBR: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12,
}

export function parseDate(input: string, fallbackYear?: number): ISODate | null {
  const s = input.trim()
  if (!s) return null

  const abbr = s.match(/(\d{1,2})[\s-]([a-zA-Z]{3})[\s-]?(\d{2,4})?/)
  if (abbr) {
    const m = MONTH_ABBR[abbr[2].toLowerCase()]
    if (m) {
      const y = abbr[3] ? expandYear(Number(abbr[3])) : (fallbackYear ?? new Date().getFullYear())
      return `${y}-${String(m).padStart(2, '0')}-${abbr[1].padStart(2, '0')}`
    }
  }

  for (const { re, order } of DATE_PATTERNS) {
    const m = s.match(re)
    if (!m) continue
    if (order === 'ymd') return `${m[1]}-${m[2]}-${m[3]}`
    const day = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    const year = expandYear(Number(m[3]))
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  return null
}

function expandYear(y: number): number {
  if (y >= 1000) return y
  return y < 70 ? 2000 + y : 1900 + y
}

export interface ParseOptions {
  /**
   * Define cómo se lee el signo del importe:
   *  - 'account': se respeta el signo del extracto.
   *  - 'card':    los consumos vienen positivos y son egresos.
   *  - 'gastos':  planilla propia de gastos, donde todo positivo es un gasto y
   *               la columna de categoría, si existe, la puso el usuario.
   */
  kind: 'card' | 'account' | 'gastos'
  userRules?: UserRule[]
  fallbackYear?: number
  /** Identifica el origen para el fingerprint anti-duplicados. */
  sourceKey?: string
}

export function parseStatement(text: string, opts: ParseOptions): ParseResult {
  const csv = tryParseCsv(text, opts)
  if (csv && csv.rows.length) return csv
  return parseFreeText(text, opts)
}

function tryParseCsv(text: string, opts: ParseOptions): ParseResult | null {
  return parseRows(parseCsv(text), opts)
}

/**
 * Parseo a partir de una matriz ya armada. Lo usan tanto el CSV como las hojas
 * de Excel: una vez que las celdas son strings, el problema es el mismo.
 */
export function parseRows(rows: string[][], opts: ParseOptions): ParseResult | null {
  if (rows.length < 2) return null
  const headerIdx = findHeaderRow(rows)
  if (headerIdx === -1) return null

  const headers = rows[headerIdx]
  const cols = {
    date: matchColumn(headers, HEADER_HINTS.date),
    description: matchColumn(headers, HEADER_HINTS.description),
    amount: matchColumn(headers, HEADER_HINTS.amount),
    debit: matchColumn(headers, HEADER_HINTS.debit),
    credit: matchColumn(headers, HEADER_HINTS.credit),
    installment: matchColumn(headers, HEADER_HINTS.installment),
    currency: matchColumn(headers, HEADER_HINTS.currency),
    category: matchColumn(headers, HEADER_HINTS.category),
  }
  if (cols.date === -1) return null
  if (cols.amount === -1 && cols.debit === -1 && cols.credit === -1) return null

  const warnings: string[] = []
  if (cols.description === -1) warnings.push('No se encontró columna de descripción; se usa la fila completa.')

  const out: ParsedRow[] = []
  let skipped = 0

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const date = parseDate(r[cols.date] ?? '', opts.fallbackYear)
    if (!date) {
      skipped++
      continue
    }
    const description = (cols.description !== -1 ? r[cols.description] : r.join(' ')).trim()

    let cents = 0
    if (cols.amount !== -1 && (r[cols.amount] ?? '').trim()) {
      cents = toCents(r[cols.amount])
    } else {
      const debit = cols.debit !== -1 ? Math.abs(toCents(r[cols.debit] ?? '')) : 0
      const credit = cols.credit !== -1 ? Math.abs(toCents(r[cols.credit] ?? '')) : 0
      cents = credit - debit
    }
    if (cents === 0) {
      skipped++
      continue
    }

    out.push(
      buildRow({
        date,
        description,
        cents,
        installment: cols.installment !== -1 ? (r[cols.installment] ?? '').trim() : '',
        currency: cols.currency !== -1 ? normalizeCurrency(r[cols.currency]) : 'ARS',
        sheetCategory: cols.category !== -1 ? (r[cols.category] ?? '').trim() : '',
        raw: r.join(' | '),
        opts,
      }),
    )
  }

  return {
    rows: out,
    skipped,
    columns: cols,
    strategy: 'csv',
    warnings,
  }
}

/** Fallback: una transacción por línea, con la fecha al inicio y el importe al final. */
const LINE_RE =
  /^\s*(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[\s-][a-zA-Z]{3}[\s-]?\d{0,4})\s+(.+?)\s+(-?\(?\$?\s?[\d.,]+\)?-?)\s*$/

function parseFreeText(text: string, opts: ParseOptions): ParseResult {
  const out: ParsedRow[] = []
  let skipped = 0
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const m = line.match(LINE_RE)
    if (!m) {
      skipped++
      continue
    }
    const date = parseDate(m[1], opts.fallbackYear)
    const cents = toCents(m[3])
    if (!date || cents === 0) {
      skipped++
      continue
    }
    const rest = m[2].trim()
    const cuota = rest.match(/\b(\d{1,2})\s?[/de]{1,2}\s?(\d{1,2})\b/i)
    out.push(
      buildRow({
        date,
        description: rest,
        cents,
        installment: cuota ? `${cuota[1]}/${cuota[2]}` : '',
        currency: 'ARS',
        raw: line.trim(),
        opts,
      }),
    )
  }
  return {
    rows: out,
    skipped,
    strategy: 'text',
    warnings: out.length
      ? []
      : ['No se reconoció ninguna línea. Revisá que cada renglón tenga fecha, detalle e importe.'],
  }
}

function normalizeCurrency(raw: string | undefined): string {
  const s = (raw ?? '').toUpperCase()
  if (s.includes('USD') || s.includes('DOLAR') || s.includes('U$S')) return 'USD'
  return 'ARS'
}

function buildRow(args: {
  date: ISODate
  description: string
  cents: number
  installment: string
  currency: string
  raw: string
  opts: ParseOptions
  sheetCategory?: string
}): ParsedRow {
  const { date, description, installment, currency, raw, opts } = args
  // Tanto en un resumen de tarjeta como en una planilla de gastos el importe
  // llega positivo, pero para el flujo de caja es plata que sale.
  const amountCents = opts.kind === 'account' ? args.cents : -Math.abs(args.cents)
  const merchant = extractMerchant(description)
  // La categoría que el usuario ya escribió en su planilla gana: la puso él.
  const propia = args.sheetCategory ? mapCategoryName(args.sheetCategory) : null
  return {
    date,
    description: description.replace(/\s+/g, ' ').trim(),
    merchant,
    amountCents,
    category:
      propia ?? (amountCents > 0 ? 'ingresos' : categorize(description, opts.userRules ?? [])),
    installment,
    currency,
    rappi: isRappi(description),
    raw,
  }
}

/** Huella estable de un movimiento: reimportar el mismo archivo no duplica nada. */
export function fingerprint(row: ParsedRow, sourceKey = ''): string {
  return createHash('sha256')
    .update([sourceKey, row.date, row.description.toLowerCase(), row.amountCents].join('|'))
    .digest('hex')
    .slice(0, 32)
}
