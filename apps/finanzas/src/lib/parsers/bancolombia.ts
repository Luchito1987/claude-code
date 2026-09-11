/**
 * Extracto de cuenta de Bancolombia (el CSV que baja la Sucursal Virtual).
 *
 * No se parece a un CSV normal y por eso necesita su propio lector:
 *
 *   - **No tiene encabezados.** Las columnas son posicionales, así que el
 *     detector genérico —que busca una fila con "fecha" e "importe"— no
 *     engancha nada y el archivo entero termina descartado.
 *   - **La fecha viene pegada**, `20260731`, sin separadores.
 *   - **El punto es el decimal**, no el separador de miles: `-3990.00` son tres
 *     mil novecientos noventa pesos, no cuatro.
 *   - **Mezcla saldos con movimientos.** Las filas `SALDO DIA`, `SALDO INICIAL`
 *     y `SALDO FINAL` no son plata que entró o salió: son el saldo con el que
 *     cierra cada día. Importarlas como movimientos duplicaría todo el mes.
 *
 * Esa última fila, `SALDO FINAL`, es la que dice cuánto hay realmente en la
 * cuenta. Verificado contra un extracto real: el saldo del último día más los
 * movimientos de la jornada da exactamente el SALDO FINAL informado.
 *
 * Columnas, en orden: fecha, cuenta, secuencia, ?, oficina, código, detalle,
 * documento, importe, oficina, C/D, y cuatro vacías.
 */

import { toCents, MONEDA_BASE } from '../money'
import { categorize, extractMerchant, type UserRule } from '../categories'
import type { ISODate } from '../dates'
import type { ParsedRow, ParseResult } from './statement'

/**
 * Bancolombia exporta dos archivos distintos y hay que leer los dos:
 *
 *  - **consolidado**: el informe cerrado del mes. Trae las filas de SALDO, así
 *    que dice cuánto quedó en la cuenta, pero solo hasta el último mes cerrado.
 *  - **mensual**: los movimientos del mes en curso. Es el que tiene lo de
 *    ahora, y no trae ningún saldo.
 *
 * Cambian la cantidad de columnas, dónde está cada dato y —lo más traicionero—
 * el orden de la fecha: el consolidado la escribe AAAAMMDD y el mensual DDMMAAAA.
 */
interface Layout {
  name: 'consolidado' | 'mensual'
  cols: number
  date: number
  description: number
  amount: number
}

const LAYOUTS: Layout[] = [
  { name: 'consolidado', cols: 11, date: 0, description: 6, amount: 8 },
  { name: 'mensual', cols: 9, date: 3, description: 7, amount: 5 },
]

/** `SALDO DIA`, `SALDO INICIAL`, `SALDO FINAL`: saldos, no movimientos. */
const BALANCE_ROW = /^SALDO\b/i
const CLOSING_ROW = /^SALDO\s+FINAL/i

function splitLine(line: string): string[] {
  return line.split(',').map((c) => c.trim())
}

const validYear = (y: number) => y >= 2000 && y <= 2100
const validMonthDay = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31

/**
 * Ocho dígitos pegados, en cualquiera de los dos órdenes. Se distingue por
 * dónde cae un año creíble: en `10082026` los primeros cuatro son 1008, que no
 * es un año, así que es DDMMAAAA; en `20260731` sí lo son y es AAAAMMDD.
 */
function parseCompactDate(raw: string): ISODate | null {
  if (!/^\d{8}$/.test(raw)) return null

  const ymd = { y: +raw.slice(0, 4), m: +raw.slice(4, 6), d: +raw.slice(6, 8) }
  if (validYear(ymd.y) && validMonthDay(ymd.m, ymd.d)) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  }

  const dmy = { d: +raw.slice(0, 2), m: +raw.slice(2, 4), y: +raw.slice(4, 8) }
  if (validYear(dmy.y) && validMonthDay(dmy.m, dmy.d)) {
    return `${raw.slice(4, 8)}-${raw.slice(2, 4)}-${raw.slice(0, 2)}`
  }
  return null
}

/** Un importe del banco: dígitos con punto decimal, con o sin signo. */
const AMOUNT = /^-?\d+(\.\d+)?$/

function fitsLayout(cells: string[], l: Layout): boolean {
  return (
    cells.length >= l.cols &&
    parseCompactDate(cells[l.date]) !== null &&
    AMOUNT.test(cells[l.amount] ?? '')
  )
}

/**
 * Reconoce el formato por su forma, no por el nombre del archivo, y de paso
 * decide cuál de los dos es. Pide varias líneas coherentes para no confundirse
 * con un CSV cualquiera que por casualidad tenga un número de ocho dígitos.
 */
export function detectLayout(text: string): Layout | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20)
  if (lines.length < 2) return null

  for (const layout of LAYOUTS) {
    const ok = lines.filter((l) => fitsLayout(splitLine(l), layout)).length
    if (ok >= 2 && ok >= lines.length / 2) return layout
  }
  return null
}

export function isBancolombiaCsv(text: string): boolean {
  return detectLayout(text) !== null
}

export interface BancolombiaOptions {
  userRules?: UserRule[]
}

export function parseBancolombia(text: string, opts: BancolombiaOptions = {}): ParseResult {
  const layout = detectLayout(text)
  if (!layout) return { rows: [], skipped: 0, strategy: 'csv', warnings: [] }

  const rows: ParsedRow[] = []
  let skipped = 0

  let closing: { cents: number; date: ISODate } | null = null
  let daily: { cents: number; date: ISODate } | null = null

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const c = splitLine(line)
    if (c.length < layout.cols) {
      skipped++
      continue
    }

    const date = parseCompactDate(c[layout.date])
    const raw = (c[layout.amount] ?? '').trim()
    if (!date || !raw) {
      skipped++
      continue
    }
    const cents = toCents(raw)
    const description = (c[layout.description] ?? '').trim()

    if (BALANCE_ROW.test(description)) {
      // El saldo del cierre manda; si no viene, sirve el del último día.
      if (CLOSING_ROW.test(description)) closing = { cents, date }
      else if (!daily || date >= daily.date) daily = { cents, date }
      continue
    }

    if (cents === 0) {
      skipped++
      continue
    }

    rows.push({
      date,
      description,
      merchant: extractMerchant(description),
      amountCents: cents,
      category: categorize(description, opts.userRules ?? []),
      installment: '',
      currency: MONEDA_BASE,
      rappi: false,
      raw: line.trim(),
    })
  }

  // El informe mensual del mes en curso no trae ninguna fila de saldo: ahí no
  // hay saldo que informar y quien importa tiene que resolverlo de otro modo.
  const balance = closing ?? daily

  return {
    rows,
    skipped,
    strategy: 'csv',
    warnings: [],
    ...(balance ? { finalBalanceCents: balance.cents, finalBalanceDate: balance.date } : {}),
  }
}
