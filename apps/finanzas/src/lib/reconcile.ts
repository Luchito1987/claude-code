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

import type { ISODate } from './dates'

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
// Facturas contra el extracto
// ---------------------------------------------------------------------------

/**
 * Una factura del mes esperando que el banco la confirme.
 *
 * `pattern` es cómo se llama ese servicio en el extracto. Hace falta porque el
 * nombre no se parece —"Air-e (Energía)" se paga como "PAGO SV EMPRESA DE
 * ENERGIA AI"— y el importe tampoco sirve para cruzar: la factura suele estar
 * estimada y el banco tiene el número real.
 */
export interface PendingBill {
  id: string
  serviceName: string
  pattern: string
  amountCents: number
}

export interface SettledBill {
  bill: PendingBill
  /** Lo que salió de verdad, en positivo. */
  paidCents: number
  date: ISODate
  /** El estimado no daba: hay que corregir la factura con este importe. */
  amountChanged: boolean
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

/**
 * Cruza los movimientos del extracto contra las facturas pendientes del mes.
 *
 * Cruza por patrón y no por importe a propósito: el caso que motivó todo esto
 * es una factura de luz estimada en $809.590 que se pagó $879.690. Por importe
 * no habría cruzado nunca, y es justamente el caso donde más sirve —además de
 * marcarla paga, corrige el número.
 */
export function settleBillsFromStatement(
  bills: PendingBill[],
  rows: Array<{ date: ISODate; description: string; amountCents: number }>,
): SettledBill[] {
  const out: SettledBill[] = []
  const usadas = new Set<string>()

  for (const row of rows) {
    // Solo la plata que sale paga una factura.
    if (row.amountCents >= 0) continue
    const texto = normalize(row.description)

    const bill = bills.find(
      (b) => !usadas.has(b.id) && b.pattern.trim() !== '' && texto.includes(normalize(b.pattern)),
    )
    if (!bill) continue

    usadas.add(bill.id)
    const paidCents = Math.abs(row.amountCents)
    out.push({ bill, paidCents, date: row.date, amountChanged: paidCents !== bill.amountCents })
  }

  return out
}
