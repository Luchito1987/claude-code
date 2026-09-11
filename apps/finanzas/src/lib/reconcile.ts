/**
 * Conciliación entre lo cargado a mano y lo que después aparece en el extracto.
 *
 * Un gasto entra dos veces por caminos distintos: primero se le saca la foto al
 * ticket en el momento, y días después el mismo consumo llega en el resumen del
 * banco. Son el mismo gasto y no puede contarse dos veces.
 *
 * El único dato que sobrevive a los dos caminos es **el importe**. La
 * descripción no sirve: el ticket dice "ALMACENES EXITO S.A." y el extracto
 * "COMPRA 4471 EXITO WOW BQUILLA". La fecha tampoco cierra exacto, porque el
 * banco imputa el consumo uno o dos días después. Así que se cruza por importe
 * exacto y fecha cercana, y en el empate gana la fecha más próxima.
 */

import { financialMonth, type ISODate } from './dates'

export interface Reconcilable {
  id: string
  date: ISODate
  amountCents: number
}

/** Días de tolerancia entre la compra y su imputación en el banco. */
export const DEFAULT_WINDOW_DAYS = 3

const MS_DAY = 86400000

function daysApart(a: ISODate, b: ISODate): number {
  const diff = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)
  return Math.abs(Math.round(diff / MS_DAY))
}

/**
 * Busca, entre los movimientos ya cargados, el que corresponde a una línea del
 * extracto. Devuelve null si no hay ninguno que cierre.
 *
 * `used` son los que ya se aparearon en esta misma importación: sin eso, dos
 * compras del mismo importe en la misma semana se aparearían las dos contra el
 * mismo ticket y una quedaría sin registrar.
 */
export function findAlreadyLoaded(
  candidates: Reconcilable[],
  row: { date: ISODate; amountCents: number },
  opts: { windowDays?: number; used?: Set<string> } = {},
): Reconcilable | null {
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS
  const used = opts.used ?? new Set<string>()

  const posibles = candidates
    .filter((c) => !used.has(c.id))
    .filter((c) => c.amountCents === row.amountCents)
    .filter((c) => daysApart(c.date, row.date) <= windowDays)

  if (!posibles.length) return null

  // El más cercano en el tiempo; a igual distancia, el más viejo (el ticket se
  // cargó antes que la imputación del banco).
  return posibles.sort((a, b) => {
    const d = daysApart(a.date, row.date) - daysApart(b.date, row.date)
    return d !== 0 ? d : a.date.localeCompare(b.date)
  })[0]
}

// ---------------------------------------------------------------------------
// Compromisos del mes contra el extracto
// ---------------------------------------------------------------------------

/**
 * Algo que se paga una vez por mes financiero y que el extracto puede
 * confirmar: una factura de servicio, el resumen de una tarjeta, la cuota de un
 * préstamo.
 *
 * `pattern` es cómo se llama ese pago en el extracto, y es imprescindible
 * porque nada más cierra. El nombre no se parece —"Air-e (Energía)" se paga
 * como "PAGO SV EMPRESA DE ENERGIA AI", la tarjeta Falabella como "PAGO PSE
 * BANCO FALABELLA S A"— y el importe tampoco: la factura suele estar estimada y
 * el resumen de tarjeta casi nunca se paga por el total exacto.
 */
export interface Settleable {
  id: string
  label: string
  pattern: string
  /** Lo que la app venía diciendo que había que pagar. */
  amountCents: number
  /**
   * Mes financiero al que pertenece, cuando el compromiso es de un mes puntual.
   * Una factura de agosto solo la puede pagar un movimiento de agosto; sin
   * esto, el pago del gas de 2024 marcaba pagada la factura de 2026 —hay una
   * sola factura por servicio y por mes, y el patrón matchea siempre igual.
   *
   * Las tarjetas y los préstamos no lo llevan: se repiten todos los meses, y
   * cada pago salda el mes en el que cae.
   */
  period?: string
}

export interface Settlement<T extends Settleable = Settleable> {
  target: T
  /** Lo que salió de verdad de la cuenta, en positivo. */
  paidCents: number
  date: ISODate
  /** Mes financiero al que corresponde el pago. */
  period: string
  /** El importe que teníamos no era el real: hay que corregirlo con este. */
  amountChanged: boolean
  /** Qué línea del extracto lo pagó, para poder marcarla y no contarla dos veces. */
  rowIndex: number
}

export interface SettleOptions {
  /**
   * Cruzar también por importe exacto cuando el compromiso no tiene patrón
   * configurado. Sirve para las cuotas de préstamo, que salen siempre por el
   * mismo número; no sirve para tarjetas, donde el pago rara vez coincide con
   * el resumen.
   */
  matchByAmount?: boolean
}

/**
 * Cruza los movimientos del extracto contra los compromisos que siguen
 * pendientes.
 *
 * Se cruza por patrón y no por importe a propósito: el caso que motivó todo
 * esto es una factura de luz estimada en $809.590 que se pagó $879.690. Por
 * importe no habría cruzado nunca, y es justamente el caso donde más sirve
 * —además de marcarla paga, corrige el número.
 *
 * Un compromiso se salda una vez por mes financiero, no una vez por archivo: un
 * extracto de tres meses trae tres pagos de la misma tarjeta y cada uno salda
 * el suyo.
 */
export function settleFromStatement<T extends Settleable>(
  targets: T[],
  rows: Array<{ date: ISODate; description: string; amountCents: number }>,
  opts: SettleOptions = {},
): Array<Settlement<T>> {
  const out: Array<Settlement<T>> = []
  const usadas = new Set<string>()

  rows.forEach((row, rowIndex) => {
    // Solo la plata que sale paga un compromiso.
    if (row.amountCents >= 0) return
    const texto = normalize(row.description)
    const period = financialMonth(row.date)
    const paidCents = Math.abs(row.amountCents)

    const target = targets.find((t) => {
      if (usadas.has(`${t.id}:${period}`)) return false
      if (t.period !== undefined && t.period !== period) return false
      if (t.pattern.trim() !== '' && texto.includes(normalize(t.pattern))) return true
      // El importe es el segundo camino, no el de reemplazo: la misma cuota
      // sale un mes como "PAGO CREDITO SUC VIRTUAL" y otro como "DEBITO POR
      // ABONO CARTERA", y el patrón solo cubre uno de los dos.
      return opts.matchByAmount === true && t.amountCents > 0 && t.amountCents === paidCents
    })
    if (!target) return

    usadas.add(`${target.id}:${period}`)
    out.push({
      target,
      paidCents,
      date: row.date,
      period,
      amountChanged: paidCents !== target.amountCents,
      rowIndex,
    })
  })

  return out
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Los tres compromisos concretos
// ---------------------------------------------------------------------------

type StatementRow = { date: ISODate; description: string; amountCents: number }

/**
 * Una factura del mes esperando que el banco la confirme. Conserva
 * `serviceName` porque así la nombra la consulta que la trae de la base.
 */
export interface PendingBill {
  id: string
  serviceName: string
  pattern: string
  amountCents: number
  /** Mes de la factura. Ver `Settleable.period`. */
  period?: string
}

type BillTarget = PendingBill & { label: string }

export interface SettledBill extends Settlement<BillTarget> {
  /** El mismo objeto que `target`, con el nombre que usa el resto del código. */
  bill: BillTarget
}

export function settleBillsFromStatement(bills: PendingBill[], rows: StatementRow[]): SettledBill[] {
  const targets: BillTarget[] = bills.map((b) => ({ ...b, label: b.serviceName }))
  return settleFromStatement(targets, rows).map((s) => ({ ...s, bill: s.target }))
}

/**
 * El resumen de una tarjeta que vence en el mes.
 *
 * Nunca se cruza por importe: el resumen decía $977.117 y el pago real fue
 * $2.731.870 porque se pagó bastante más que el mínimo. Si aparece un pago a
 * esa tarjeta, la tarjeta está paga, y el importe que vale es el que salió de
 * la cuenta.
 */
export function settleCardsFromStatement(
  cards: Settleable[],
  rows: StatementRow[],
): Settlement[] {
  return settleFromStatement(cards, rows)
}

/**
 * La cuota de un préstamo.
 *
 * Acá sí vale cruzar por importe cuando no hay patrón configurado: la cuota
 * sale siempre por el mismo número, así que un débito exacto de $1.748.074 en
 * un mes donde la cuota es de $1.748.074 no es una casualidad.
 */
export function settleLoansFromStatement(
  loans: Settleable[],
  rows: StatementRow[],
): Settlement[] {
  return settleFromStatement(loans, rows, { matchByAmount: true })
}
