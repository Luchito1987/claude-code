/**
 * Extracto de tarjeta de crédito de Tuya (Éxito, Alkosto y demás marcas que
 * emite). Llega en PDF y su tabla no se parece a la de un resumen común:
 *
 *   2025/08/25 +COMPRA EXITO.COM | ALMACENES EXITO 4.008.204,00 1.669.540,94 139.128,45 1,88% 25,14% 12/24
 *   fecha      descripción                          valor        saldo        cuota mes  tasas   cuotas
 *
 * Tres cosas que hay que entender para no cargar cualquier cosa:
 *
 * 1. La fecha es la de la compra original, no la del período. El extracto
 *    lista **todos los planes vigentes**, así que hay filas de hace un año.
 * 2. Lo que se paga este mes es la "cuota a pagar del mes", no el valor de la
 *    transacción ni el saldo. Un parser genérico tomaría el último número de la
 *    línea, que acá es el plan de cuotas.
 * 3. La cuota de manejo, el seguro y los pagos vienen con cuotas "0/0": ahí el
 *    importe del mes es el valor de la transacción.
 *
 * Los intereses corrientes no son una fila de la tabla: salen del recuadro del
 * pago mínimo. Sin ellos la suma no llega al total del extracto, así que se
 * agregan como un movimiento propio.
 */

import { categorize, extractMerchant, isRappi, type UserRule } from '../categories'
import { toCents } from '../money'
import type { ISODate } from '../dates'
import type { ParsedRow, ParseResult } from './statement'

/** fecha · signo+descripción · valor · saldo · cuota del mes · dos tasas · N/M */
const FILA =
  /^(\d{4})\/(\d{2})\/(\d{2})\s+([+-])(.+?)\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+[\d,]+%\s+[\d,]+%\s+(\d+)\/(\d+)$/

const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}

/** "03-sep-2026" -> "2026-09-03". Es como Tuya escribe corte y vencimiento. */
function fechaLarga(texto: string): ISODate | null {
  const m = texto.match(/(\d{1,2})-([a-zA-Z]{3})-(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  return mes ? `${m[3]}-${mes}-${m[1].padStart(2, '0')}` : null
}

export interface TuyaMeta {
  /** Cierre del período. */
  closingDate?: ISODate
  /** Fecha límite de pago: es el vencimiento real, mejor que deducirlo. */
  dueDate?: ISODate
  minimumCents?: number
  totalCents?: number
}

export function isTuyaStatement(text: string): boolean {
  const tieneMarca = /\bTUYA\s?S\.?A|Extracto Tarjeta de Cr[eé]dito/i.test(text)
  const tieneTabla = /Cuota a pagar\s+del mes|Cuotas\s*\n?\s*cobradas\/totales|cobradas\/totales/i.test(text)
  return tieneMarca && (tieneTabla || FILA.test(text.split('\n').find((l) => FILA.test(l)) ?? ''))
}

/** Lee el recuadro del pago mínimo, que no forma parte de la tabla. */
function leerEncabezado(text: string): TuyaMeta & { interestCents: number } {
  const buscar = (re: RegExp): number => {
    const m = text.match(re)
    return m ? Math.abs(toCents(m[1])) : 0
  }
  // Cada concepto aparece dos veces (columna del mínimo y del total): con la
  // primera alcanza, son el mismo número.
  const corrientes = buscar(/Intereses corrientes\s+([\d.]+,\d{2})/i)
  const mora = buscar(/Intereses de mora\s+([\d.]+,\d{2})/i)

  const corte = text.match(/Fecha de Corte:\s*(\d{1,2}-[a-zA-Z]{3}-\d{4})/i)
  const limite = text.match(/Fecha l[ií]mite de pago:\s*(\d{1,2}-[a-zA-Z]{3}-\d{4})/i)

  return {
    closingDate: corte ? (fechaLarga(corte[1]) ?? undefined) : undefined,
    dueDate: limite ? (fechaLarga(limite[1]) ?? undefined) : undefined,
    minimumCents: buscar(/=?PAGO M[IÍ]NIMO\s*\$?\s*([\d.]+,\d{2})/i) || undefined,
    totalCents: buscar(/=?PAGO TOTAL\s*\$?\s*([\d.]+,\d{2})/i) || undefined,
    interestCents: corrientes + mora,
  }
}

export interface TuyaParseResult extends ParseResult {
  meta: TuyaMeta
}

export function parseTuya(text: string, opts: { userRules?: UserRule[] } = {}): TuyaParseResult {
  const { interestCents, ...meta } = leerEncabezado(text)
  const rows: ParsedRow[] = []
  const warnings: string[] = []
  let skipped = 0

  for (const linea of text.split(/\r?\n/)) {
    if (!linea.trim()) continue
    const m = linea.match(FILA)
    if (!m) {
      skipped++
      continue
    }

    const [, anio, mes, dia, signo, descripcionCruda, valor, , cuotaMes, cobradas, totales] = m
    const date = `${anio}-${mes}-${dia}`
    const descripcion = descripcionCruda.replace(/\s*\|\s*/g, ' · ').replace(/\s+/g, ' ').trim()
    const plan = Number(totales)

    // Con plan de cuotas se paga la cuota del mes; sin plan (manejo, seguro,
    // pagos) el importe es el valor de la transacción.
    const cents = plan > 0 ? Math.abs(toCents(cuotaMes)) : Math.abs(toCents(valor))
    if (!cents) {
      skipped++
      continue
    }

    const esPago = signo === '-'
    rows.push({
      date,
      description: descripcion,
      merchant: extractMerchant(descripcion),
      // Un pago no es un gasto: entra en positivo y no suma al resumen.
      amountCents: esPago ? cents : -cents,
      category: esPago ? 'pago_tarjeta' : categorize(descripcion, opts.userRules ?? []),
      installment: plan > 0 ? `${Number(cobradas)}/${plan}` : '',
      currency: 'ARS',
      rappi: isRappi(descripcion),
      raw: linea.trim(),
    })
  }

  // Los intereses no son una fila: sin ellos la suma no llega al pago mínimo.
  if (interestCents > 0) {
    rows.push({
      date: meta.closingDate ?? rows[rows.length - 1]?.date ?? '',
      description: 'Intereses del período',
      merchant: 'Intereses',
      amountCents: -interestCents,
      category: 'prestamos',
      installment: '',
      currency: 'ARS',
      rappi: false,
      raw: 'recuadro del pago mínimo',
    })
  }

  // El propio extracto dice cuánto suma: si no coincide, algo se leyó mal.
  const cargos = rows.filter((r) => r.amountCents < 0).reduce((a, r) => a + -r.amountCents, 0)
  if (meta.minimumCents && Math.abs(cargos - meta.minimumCents) > 100) {
    warnings.push(
      `La suma de los movimientos (${(cargos / 100).toLocaleString('es-CO')}) no coincide con el pago mínimo ` +
        `del extracto (${(meta.minimumCents / 100).toLocaleString('es-CO')}): revisá el detalle antes de confiar en el total.`,
    )
  }

  return {
    rows,
    skipped,
    strategy: 'text',
    warnings,
    meta,
    statementDueDate: meta.dueDate,
    statementMinimumCents: meta.minimumCents,
    statementTotalCents: meta.totalCents,
  }
}
