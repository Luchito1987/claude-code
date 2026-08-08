/**
 * Fechas como 'YYYY-MM-DD' en horario local. Se evita Date con timezone para que
 * el día 28 sea el 28 sin importar dónde corra el servidor.
 */

export type ISODate = string

export function todayISO(tz = process.env.TZ ?? 'America/Argentina/Buenos_Aires'): ISODate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return parts
}

export function parseISO(d: ISODate): { y: number; m: number; d: number } {
  const [y, m, day] = d.split('-').map(Number)
  return { y, m, d: day }
}

export function iso(y: number, m: number, d: number): ISODate {
  const days = daysInMonth(y, m)
  const day = Math.min(Math.max(d, 1), days)
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function addDays(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = parseISO(d)
  const t = new Date(Date.UTC(y, m - 1, day + n))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

export function addMonths(d: ISODate, n: number): ISODate {
  const { y, m, d: day } = parseISO(d)
  const total = (y * 12 + (m - 1)) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return iso(ny, nm, day)
}

export function diffDays(a: ISODate, b: ISODate): number {
  const pa = parseISO(a)
  const pb = parseISO(b)
  const ta = Date.UTC(pa.y, pa.m - 1, pa.d)
  const tb = Date.UTC(pb.y, pb.m - 1, pb.d)
  return Math.round((tb - ta) / 86400000)
}

export function compare(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function periodOf(d: ISODate): string {
  return d.slice(0, 7)
}

export function nextPeriod(period: string, n = 1): string {
  const [y, m] = period.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/**
 * Ventana de facturación: del 28 del mes anterior al 15 del mes de vencimiento.
 * Es el período en el que hay que salir a consultar las facturas de servicios.
 * Se identifica por el mes de cierre (el mes del día 15).
 *
 * Ejemplo: hoy 2026-07-31 -> ventana 2026-07-28 .. 2026-08-15 (período 2026-08).
 */
export interface BillingWindow {
  period: string
  start: ISODate
  end: ISODate
  /** true si `ref` cae dentro de la ventana (es decir, toca revisar facturas). */
  open: boolean
}

export const WINDOW_START_DAY = 28
export const WINDOW_END_DAY = 15

export function billingWindowFor(period: string): BillingWindow {
  const [y, m] = period.split('-').map(Number)
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  return {
    period,
    start: iso(prev.y, prev.m, WINDOW_START_DAY),
    end: iso(y, m, WINDOW_END_DAY),
    open: false,
  }
}

/** Ventana vigente para una fecha dada. */
export function currentWindow(ref: ISODate = todayISO()): BillingWindow {
  const { y, m, d } = parseISO(ref)
  // Del 28 en adelante ya estamos trabajando sobre las facturas del mes siguiente.
  const period = d >= WINDOW_START_DAY ? nextPeriod(`${y}-${String(m).padStart(2, '0')}`) : `${y}-${String(m).padStart(2, '0')}`
  const w = billingWindowFor(period)
  return { ...w, open: ref >= w.start && ref <= w.end }
}

/** Lunes de la semana ISO que contiene `d`. */
export function weekStart(d: ISODate): ISODate {
  const { y, m, d: day } = parseISO(d)
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay() // 0 = domingo
  const back = dow === 0 ? 6 : dow - 1
  return addDays(d, -back)
}

const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export function dayOfWeekName(d: ISODate): string {
  const { y, m, d: day } = parseISO(d)
  return DOW[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

export function formatDate(d: ISODate): string {
  const { m, d: day } = parseISO(d)
  return `${day} ${MONTHS[m - 1].slice(0, 3)}`
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/**
 * Mes financiero. El mes se cierra el día 27 y arranca el 28: a partir de ahí lo
 * que hay que pagar ya es del mes siguiente. Es la misma regla que abre la
 * ventana de consulta de facturas, aplicada a cualquier fecha.
 *
 *   financialMonth('2026-07-27') -> '2026-07'
 *   financialMonth('2026-07-28') -> '2026-08'
 */
export function financialMonth(d: ISODate = todayISO()): string {
  const { y, m, d: day } = parseISO(d)
  const period = `${y}-${String(m).padStart(2, '0')}`
  return day >= WINDOW_START_DAY ? nextPeriod(period) : period
}

/** Rango de días que cubre un mes financiero: del 28 del mes anterior al 27. */
export function monthRange(period: string): { start: ISODate; end: ISODate } {
  const [y, m] = period.split('-').map(Number)
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  return {
    start: iso(prev.y, prev.m, WINDOW_START_DAY),
    end: iso(y, m, WINDOW_START_DAY - 1),
  }
}

/** Los N meses financieros a partir del actual, incluido. */
export function nextMonths(count: number, from: string = financialMonth()): string[] {
  return Array.from({ length: count }, (_, i) => nextPeriod(from, i))
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function formatMonthShort(period: string): string {
  const [y, m] = period.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`
}

/** Cuántos días tiene el mes financiero: sirve para prorratear el gasto variable. */
export function daysInFinancialMonth(period: string): number {
  const { start, end } = monthRange(period)
  return diffDays(start, end) + 1
}
