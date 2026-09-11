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
import { MONEDA_BASE, toCents, type Moneda } from '../money'
import { categorize, extractMerchant, isRappi, mapCategoryName, type UserRule } from '../categories'
import { compare, type ISODate } from '../dates'
import { isBancolombiaCsv, parseBancolombia } from './bancolombia'
import { isTuyaStatement, parseTuya } from './tuya'

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
  /**
   * Saldo que deja el movimiento más nuevo del archivo, cuando el extracto trae
   * la columna. Es el saldo real de la cuenta y sirve para corregir el que la
   * app viene arrastrando de las cargas a mano.
   */
  finalBalanceCents?: number
  finalBalanceDate?: ISODate
  /**
   * Vencimiento que declara el propio extracto. Vale más que deducirlo del día
   * de cierre de la tarjeta, y es el único dato que ubica en el mes correcto a
   * las compras viejas que siguen en cuotas.
   */
  statementDueDate?: ISODate
  /**
   * Pago mínimo y pago total que declara el resumen de tarjeta, tal cual salen
   * impresos. No se usan para calcular nada: están para que quien importa
   * pueda cotejarlos contra el papel y darse cuenta al toque si el archivo se
   * leyó entero. La suma de los cargos importados tiene que dar el mínimo.
   */
  statementMinimumCents?: number
  statementTotalCents?: number
}

const HEADER_HINTS = {
  date: ['fecha', 'date', 'f. operacion', 'fecha operacion', 'fecha oper', 'fec.', 'dia'],
  description: ['descripcion', 'detalle', 'concepto', 'comercio', 'movimiento', 'description', 'referencia'],
  // Las frases de cuota van primero: en un resumen de tarjeta en cuotas,
  // "valor transaccion"/"monto" es el precio total de la compra, pero lo que
  // hay que proyectar es la cuota que se cobra este ciclo.
  amount: [
    'cuota a pagar del mes', 'cuota a pagar', 'valor cuota', 'valor de la cuota',
    'cuota mensual', 'pago cuota', 'capital facturado del periodo', 'capital facturado',
    'importe', 'monto', 'amount', 'valor', 'pesos', 'importe pesos', 'total',
  ],
  debit: ['debito', 'debitos', 'cargo', 'egreso'],
  credit: ['credito', 'creditos', 'abono', 'ingreso', 'haber'],
  // Idem: "cuotas cobradas/totales" (el progreso "4/6") tiene que ganarle a
  // "cuota a pagar del mes", que ya se usó arriba como columna de importe.
  installment: ['cuotas cobradas', 'cuotas totales', 'cuota', 'cuotas', 'plan'],
  currency: ['moneda', 'divisa'],
  category: ['categoria', 'rubro', 'clasificacion', 'tipo de gasto'],
  // Saldo que va quedando después de cada movimiento. Bancolombia y la mayoría
  // de los bancos colombianos lo traen como última columna, y es de donde sale
  // el saldo real de la cuenta.
  balance: ['saldo', 'nuevo saldo', 'saldo final', 'saldo disponible', 'balance'],
}

/** Un "saldo anterior" es el punto de partida, no el saldo de la cuenta hoy. */
const OPENING_BALANCE = /ANTERI[O0]R|IN[I1]C[I1]AL|APERTURA/

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
  // Año de 4 dígitos primero: cubre "2026-07-05" y también "2026/07/05"
  // (algunos bancos colombianos exportan la fecha con barras). Va antes que
  // el patrón dmy para que un año de 4 dígitos nunca se lea como día/mes.
  { re: /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/, order: 'ymd' },
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
  /**
   * Moneda de los movimientos: la de la cuenta o tarjeta a la que se importan.
   * Un extracto no dice en qué moneda está, pero la cuenta que lo emitió sí.
   */
  currency?: Moneda
  userRules?: UserRule[]
  fallbackYear?: number
  /** Identifica el origen para el fingerprint anti-duplicados. */
  sourceKey?: string
}

export function parseStatement(text: string, opts: ParseOptions): ParseResult {
  // Bancolombia va primero: su CSV no trae encabezados, así que el detector
  // genérico no lo reconoce y el archivo entero se perdería.
  if (isBancolombiaCsv(text)) return parseBancolombia(text, { userRules: opts.userRules })
  // Tuya también necesita el suyo: el último número de cada línea es el plan de
  // cuotas, no el importe, y el parser genérico cargaría cualquier cosa.
  if (isTuyaStatement(text)) return parseTuya(text, { userRules: opts.userRules })
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
    balance: matchColumn(headers, HEADER_HINTS.balance),
  }
  // "Saldo anterior" es el saldo con el que abre el extracto, no el de hoy.
  if (cols.balance !== -1 && OPENING_BALANCE.test(norm(headers[cols.balance]).toUpperCase())) {
    cols.balance = -1
  }
  if (cols.date === -1) return null
  if (cols.amount === -1 && cols.debit === -1 && cols.credit === -1) return null

  const warnings: string[] = []
  if (cols.description === -1) warnings.push('No se encontró columna de descripción; se usa la fila completa.')

  const out: ParsedRow[] = []
  let skipped = 0
  // El saldo del movimiento más nuevo. Se elige por fecha y no por posición
  // porque hay bancos que listan de nuevo a viejo y otros al revés.
  let balance: { cents: number; date: ISODate } | null = null

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const date = parseDate(r[cols.date] ?? '', opts.fallbackYear)
    if (!date) {
      skipped++
      continue
    }

    if (cols.balance !== -1 && (r[cols.balance] ?? '').trim()) {
      const cents = toCents(r[cols.balance])
      // A igual fecha gana la última fila: es el saldo con el que cierra el día.
      if (!balance || compare(date, balance.date) >= 0) balance = { cents, date }
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
        currency: cols.currency !== -1 ? normalizeCurrency(r[cols.currency], opts.currency ?? MONEDA_BASE) : (opts.currency ?? MONEDA_BASE),
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
    ...(balance ? { finalBalanceCents: balance.cents, finalBalanceDate: balance.date } : {}),
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
        currency: opts.currency ?? MONEDA_BASE,
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

/**
 * Qué moneda declara la columna del archivo, cuando la trae. Si no dice nada
 * reconocible manda la de la cuenta destino: el extracto de una caja de ahorro
 * colombiana está en pesos colombianos aunque no lo aclare en ningún renglón.
 */
function normalizeCurrency(raw: string | undefined, porDefecto: Moneda): string {
  const s = (raw ?? '').toUpperCase()
  if (s.includes('USD') || s.includes('DOLAR') || s.includes('U$S')) return 'USD'
  if (s.includes('COP') || s.includes('COL')) return 'COP'
  if (s.includes('ARS') || s.includes('AR$')) return 'ARS'
  return porDefecto
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

/**
 * Huella estable de un movimiento: reimportar el mismo archivo no duplica nada.
 *
 * `occurrence` distingue movimientos realmente repetidos. Un extracto real
 * traía seis cobros idénticos el mismo día —misma fecha, mismo detalle, mismo
 * importe, uno por cada pago hecho— y sin esto los seis colapsaban en uno solo:
 * la app se comía cinco cobros de verdad. Al numerarlos, los seis entran, y
 * reimportar el archivo los vuelve a numerar igual, así que sigue sin duplicar.
 *
 * El cero no se escribe en la huella a propósito: así los movimientos ya
 * importados conservan la que tenían y no se reimportan por duplicado.
 */
export function fingerprint(row: ParsedRow, sourceKey = '', occurrence = 0): string {
  const parts = [sourceKey, row.date, row.description.toLowerCase(), row.amountCents]
  if (occurrence > 0) parts.push(`#${occurrence}`)
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}
