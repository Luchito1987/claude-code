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
import { toCents, MONEDA_BASE } from '../money'
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
  /**
   * Fecha límite de pago: es el vencimiento real, mejor que deducirlo.
   *
   * Queda vacía cuando el extracto dice "INMEDIATO" en vez de una fecha, que es
   * lo que imprime cuando la tarjeta está en mora: ya no hay plazo que esperar.
   */
  dueDate?: ISODate
  /**
   * Lo que se paga este mes por los consumos del período, sin arrastres.
   * Es contra este número que tiene que cerrar la suma del detalle.
   */
  cuotaDelMesCents?: number
  minimumCents?: number
  totalCents?: number
  /** Lo que quedó sin pagar de períodos anteriores, más lo que devengó. */
  moraCents?: number
  interesesMoraCents?: number
  /** Si el extracto declara mora. El pago mínimo la incluye. */
  enMora?: boolean
  /** Cargos del recuadro que no siempre bajan a la tabla de movimientos. */
  manejoCents?: number
  polizaCents?: number
  otrosCents?: number
}

export function isTuyaStatement(text: string): boolean {
  const tieneMarca = /\bTUYA\s?S\.?A|Extracto Tarjeta de Cr[eé]dito/i.test(text)
  const tieneTabla = /Cuota a pagar\s+del mes|Cuotas\s*\n?\s*cobradas\/totales|cobradas\/totales/i.test(text)
  return tieneMarca && (tieneTabla || FILA.test(text.split('\n').find((l) => FILA.test(l)) ?? ''))
}

/**
 * Lee el recuadro del pago mínimo, que no forma parte de la tabla.
 *
 * El recuadro cambia de forma cuando la tarjeta entra en mora: al VALOR CUOTA
 * del período se le suman el saldo que quedó sin pagar antes y sus intereses, y
 * la fecha límite deja de ser una fecha para pasar a decir "INMEDIATO". Por eso
 * el pago mínimo no sirve para verificar que el detalle se leyó completo: la
 * diferencia no es un error de lectura, es deuda vieja que no figura en la
 * tabla de este mes.
 */
function leerEncabezado(text: string): TuyaMeta & { interestCents: number } {
  const buscar = (re: RegExp): number => {
    const m = text.match(re)
    return m ? Math.abs(toCents(m[1])) : 0
  }
  // Cada concepto aparece dos veces (columna del mínimo y del total): con la
  // primera alcanza, son el mismo número.
  const corrientes = buscar(/Intereses corrientes\s+([\d.]+,\d{2})/i)
  const mora = buscar(/Intereses de mora\s+([\d.]+,\d{2})/i)
  const saldoMora = buscar(/Saldo en mora\s+([\d.]+,\d{2})/i)
  /*
   * Cuota de manejo, póliza y "otros" a veces bajan a la tabla como filas con
   * cuotas 0/0 y a veces sólo figuran acá arriba: cambia entre extractos del
   * mismo banco. Se leen siempre del recuadro y, si ya vinieron en la tabla, se
   * descartan al armar las filas para no cobrarlos dos veces.
   */
  const manejo = buscar(/Cuota de manejo\s+([\d.]+,\d{2})/i)
  const poliza = buscar(/P[oó]liza deudores\s+([\d.]+,\d{2})/i)
  const otros = buscar(/\(\+\)\s*\*?Otros\s+([\d.]+,\d{2})/i)

  const corte = text.match(/Fecha de Corte:\s*(\d{1,2}-[a-zA-Z]{3}-\d{4})/i)
  const limite = text.match(/Fecha l[ií]mite de pago:\s*(\d{1,2}-[a-zA-Z]{3}-\d{4})/i)

  return {
    closingDate: corte ? (fechaLarga(corte[1]) ?? undefined) : undefined,
    dueDate: limite ? (fechaLarga(limite[1]) ?? undefined) : undefined,
    cuotaDelMesCents: buscar(/\(=\)\s*VALOR CUOTA\s+([\d.]+,\d{2})/i) || undefined,
    minimumCents: buscar(/=?PAGO M[IÍ]NIMO\s*\$?\s*([\d.]+,\d{2})/i) || undefined,
    totalCents: buscar(/=?PAGO TOTAL\s*\$?\s*([\d.]+,\d{2})/i) || undefined,
    moraCents: saldoMora || undefined,
    interesesMoraCents: mora || undefined,
    enMora: saldoMora > 0 || /tienes tu tarjeta en mora/i.test(text),
    manejoCents: manejo || undefined,
    polizaCents: poliza || undefined,
    otrosCents: otros || undefined,
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
      currency: MONEDA_BASE,
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
      currency: MONEDA_BASE,
      rappi: false,
      raw: 'recuadro del pago mínimo',
    })
  }

  /*
   * Lo que arrastra de meses anteriores entra como una fila propia.
   *
   * No está en la tabla de movimientos —la tabla es del período— pero es plata
   * que hay que pagar y que vence ya. Sin esta fila, la app mostraría como
   * deuda del mes sólo la cuota corriente y el número quedaría corto justo
   * cuando más importa que no lo esté.
   */
  /*
   * Cargos del recuadro que este extracto no bajó a la tabla. Se agregan sólo
   * si no aparecieron ya como fila: en los extractos donde vienen con cuotas
   * 0/0 sumarlos de nuevo los cobraría dos veces.
   */
  const yaEstaEnLaTabla = (patron: RegExp, cents: number) =>
    rows.some((r) => patron.test(r.description) && Math.abs(r.amountCents) === cents)

  const delRecuadro: Array<[RegExp, number | undefined, string, string]> = [
    [/manejo/i, meta.manejoCents, 'Cuota de manejo', 'Tuya'],
    // "SEG DEUD IVA INCL" es como Tuya abrevia la póliza en la tabla.
    [/p[oó]liza|seg(ur)?o?\b|deud/i, meta.polizaCents, 'Póliza de deudores', 'Tuya'],
    [/otros/i, meta.otrosCents, 'Otros cargos del extracto', 'Tuya'],
  ]

  for (const [patron, cents, descripcion, comercio] of delRecuadro) {
    if (!cents || yaEstaEnLaTabla(patron, cents)) continue
    rows.push({
      date: meta.closingDate ?? rows[rows.length - 1]?.date ?? '',
      description: descripcion,
      merchant: comercio,
      amountCents: -cents,
      category: 'servicios',
      installment: '',
      currency: MONEDA_BASE,
      rappi: false,
      raw: 'recuadro del pago mínimo',
    })
  }

  if (meta.moraCents) {
    rows.push({
      date: meta.closingDate ?? rows[rows.length - 1]?.date ?? '',
      description: 'Saldo en mora de períodos anteriores',
      merchant: 'Mora',
      amountCents: -meta.moraCents,
      category: 'prestamos',
      installment: '',
      currency: MONEDA_BASE,
      rappi: false,
      raw: 'recuadro del pago mínimo',
    })
  }

  /*
   * Contra qué se verifica que el detalle se leyó completo.
   *
   * Contra el VALOR CUOTA, que es lo que el período genera, y no contra el pago
   * mínimo: cuando hay mora el mínimo incluye deuda vieja que no figura en esta
   * tabla, y comparar contra él daría una diferencia que no es un error de
   * lectura. Sin mora los dos números coinciden y da lo mismo cuál se use.
   */
  const cargos = rows.filter((r) => r.amountCents < 0).reduce((a, r) => a + -r.amountCents, 0)
  // El pago mínimo es lo que hay que pagar, con mora o sin ella: es contra ese
  // número que se contrasta, porque es el que está impreso en el papel.
  const esperado = meta.minimumCents ?? meta.cuotaDelMesCents ?? 0
  const pesos = (c: number) => c.toLocaleString('es-CO', { minimumFractionDigits: 2 })

  const diferencia = esperado - cargos
  if (esperado && Math.abs(diferencia) > 100) {
    warnings.push(
      `El detalle suma ${pesos(cargos / 100)} y el extracto exige ${pesos(esperado / 100)}: ` +
        `${diferencia > 0 ? 'faltan' : 'sobran'} ${pesos(Math.abs(diferencia) / 100)}. ` +
        'Se usa el importe del extracto, que es el que hay que pagar; la diferencia queda sólo en el detalle.',
    )
  }

  if (meta.enMora) {
    warnings.push(
      `Esta tarjeta está en mora: ${pesos((meta.moraCents ?? 0) / 100)} de períodos anteriores y ` +
        `${pesos((meta.interesesMoraCents ?? 0) / 100)} de intereses, que el extracto suma al pago mínimo. ` +
        'Por eso el mínimo es mayor que la cuota del mes.',
    )
  }

  if (!meta.dueDate && /Fecha l[ií]mite de pago:\s*INMEDIATO/i.test(text)) {
    warnings.push(
      'El extracto no trae fecha de vencimiento: dice "INMEDIATO", que es lo que imprime cuando hay mora. ' +
        'El resumen se ubica en el mes en curso.',
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
