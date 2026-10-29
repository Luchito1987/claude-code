/**
 * Resumen de la tarjeta Naranja X (Argentina), en PDF.
 *
 *   17/10/26 NX Virtual 3294FCASA-NETFLIX 01 30.198,49
 *   27/06/25 NaranjaX 491078PLANDEPAGO ^ (F01) 18/24 134.737,42
 *   fecha    tarjeta  cupón+detalle            plan  importe en pesos
 *
 * - Las fechas van con año de dos dígitos y los importes en formato argentino.
 * - "01" es un pago; "18/24" es la cuota 18 de un plan: el importe ya es la
 *   cuota del mes, y las que faltan son las "cuotas futuras" del resumen.
 * - IVA e impuesto de sellos van aparte, en "Otros cargos".
 * - "Pago del resumen anterior" no es un consumo: se ignora.
 *
 * Todo en pesos argentinos. El "total a pagar" es lo que deja la cuenta al
 * día sin financiar: la "menor entrega" financia el resto al ~115% anual, así
 * que como importe del resumen se toma el total.
 */

import { categorize, extractMerchant, type UserRule } from '../categories'
import { toCents } from '../money'
import type { ISODate } from '../dates'
import type { ParsedRow, ParseResult } from './statement'

const FILA = /^(\d{2})\/(\d{2})\/(\d{2})\s+(.+?)\s+(\d{1,3}(?:\.\d{3})*,\d{2})$/

export function isNaranjaStatement(text: string): boolean {
  return /naranja/i.test(text) && /Tu total a pagar es/i.test(text)
}

const fecha = (d: string, m: string, a: string): ISODate => `20${a}-${m}-${d}`

function limpiar(detalle: string): { descripcion: string; cuota: string } {
  let d = detalle
  let cuota = ''
  const plan = d.match(/\s(\d{1,2})\/(\d{1,2})$/)
  if (plan) {
    cuota = `${Number(plan[1])}/${Number(plan[2])}`
    d = d.slice(0, plan.index)
  } else {
    d = d.replace(/\s0?1$/, '')
  }
  d = d
    .replace(/^(NX Virtual|Naranja ?X|Naranja)\s+/i, '')
    .replace(/^\d+(?=[A-Z*])/, '')
    .replace(/[\^]|\(F\d+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return { descripcion: d, cuota }
}

export function parseNaranja(text: string, opts: { userRules?: UserRule[] } = {}): ParseResult {
  const lineas = text.split(/\r?\n/).map((l) => l.trim())
  const total = text.match(/Tu total a pagar es \$\s*([\d.]+,\d{2})/i)
  const vence = text.match(/vence el (\d{2})\/(\d{2})\/(\d{2})/i)
  const cierre = text.match(/El resumen actual cerr[oó] el (\d{2})\/(\d{2})/i)
  const dueDate = vence ? fecha(vence[1], vence[2], vence[3]) : undefined
  const anioCierre = vence ? (cierre && cierre[2] > vence[2] ? String(Number(vence[3]) - 1) : vence[3]) : undefined
  const closing = cierre && anioCierre ? fecha(cierre[1], cierre[2], anioCierre) : undefined

  const rows: ParsedRow[] = []
  let skipped = 0
  let enDetalle = false
  for (const l of lineas) {
    if (/^FECHA\s+TARJETA/i.test(l)) {
      enDetalle = true
      continue
    }
    if (/Pago del resumen anterior/i.test(l)) enDetalle = false
    if (!enDetalle) continue
    const m = l.match(FILA)
    if (!m) {
      skipped++
      continue
    }
    const { descripcion, cuota } = limpiar(m[4])
    const cents = Math.abs(toCents(m[5]))
    if (!cents) continue
    rows.push({
      date: fecha(m[1], m[2], m[3]),
      description: descripcion,
      merchant: extractMerchant(descripcion),
      amountCents: -cents,
      category: categorize(descripcion, opts.userRules ?? []),
      installment: cuota,
      currency: 'ARS',
      rappi: false,
      raw: l,
    })
  }

  // Otros cargos: no tienen fecha, van al cierre del resumen.
  const otros: Array<[string, RegExp]> = [
    ['IVA', /^\(Base\s*Imponible[^)]*\)\s+([\d.]+,\d{2})$/im],
    ['Impuesto de sellos', /^Impuesto\s*de\s*Sellos\s+([\d.]+,\d{2})$/im],
    ['Percepciones', /^Percepci[oó]n[^\d]*\s([\d.]+,\d{2})$/im],
  ]
  for (const [nombre, re] of otros) {
    const m = text.match(re)
    if (!m) continue
    rows.push({
      date: closing ?? dueDate ?? '',
      description: nombre,
      merchant: nombre,
      amountCents: -Math.abs(toCents(m[1])),
      category: 'impuestos',
      installment: '',
      currency: 'ARS',
      rappi: false,
      raw: m[0],
    })
  }

  const totalCents = total ? Math.abs(toCents(total[1])) : undefined
  const suma = rows.reduce((a, r) => a - r.amountCents, 0)
  const warnings: string[] = []
  if (totalCents && suma !== totalCents) {
    warnings.push(`El detalle suma ${suma / 100} y el resumen dice ${totalCents / 100}: puede faltar alguna fila.`)
  }
  return {
    rows,
    skipped,
    strategy: 'text',
    warnings,
    statementDueDate: dueDate,
    statementMinimumCents: totalCents,
    statementTotalCents: totalCents,
  }
}
