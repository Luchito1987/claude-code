/**
 * Extracto de cuenta de ahorros de Bancolombia, bajado en Excel.
 *
 * Es el único documento que trae el saldo, y por eso el que ancla la cuenta:
 * Bancolombia lo emite por trimestre y después de la fecha de corte sólo da
 * movimientos sueltos. Tiene tres particularidades que el lector genérico de
 * tablas no resuelve:
 *
 *  - Arriba de la tabla hay un bloque con el cliente, el período y un resumen,
 *    así que el encabezado de columnas no está en las primeras filas.
 *  - Las fechas vienen sin año ("1/07"). El año sale del período del
 *    encabezado, y un trimestre que cruza diciembre pasa al año siguiente.
 *  - Los importes vienen en formato estadounidense ("-1,500,000.00", ".10"),
 *    al revés del colombiano que usa el resto de la app.
 *
 * El resumen trae saldo anterior y saldo actual, lo que permite comprobar que
 * no se perdió ninguna fila: saldo anterior más la suma de los movimientos
 * tiene que dar el saldo actual, al peso. Si no da, se avisa.
 */

import { type ISODate } from '../dates'
import { MONEDA_BASE } from '../money'
import { buildRow, type ParseOptions, type ParseResult, type ParsedRow } from './statement'

const norm = (s: string | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase()

/** "-1,500,000.00" → -150000000. ".10" → 10. Vacío o ilegible → null. */
export function usToCents(s: string | undefined): number | null {
  const limpio = (s ?? '').replace(/[\s$,]/g, '')
  if (!/^-?\d*\.?\d+$/.test(limpio)) return null
  return Math.round(Number(limpio) * 100)
}

/** "2026/06/30" → "2026-06-30". */
function isoDesde(s: string | undefined): ISODate | null {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec((s ?? '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

export function isBancolombiaExtracto(rows: string[][]): boolean {
  return (
    rows.some((r) => norm(r[0]) === 'DESDE' && norm(r[1]) === 'HASTA') &&
    rows.some((r) => norm(r[0]) === 'FECHA' && r.some((c) => norm(c) === 'SALDO'))
  )
}

export function parseBancolombiaExtracto(rows: string[][], opts: ParseOptions): ParseResult | null {
  if (!isBancolombiaExtracto(rows)) return null

  const iPeriodo = rows.findIndex((r) => norm(r[0]) === 'DESDE' && norm(r[1]) === 'HASTA')
  const desde = isoDesde(rows[iPeriodo + 1]?.[0])
  const hasta = isoDesde(rows[iPeriodo + 1]?.[1])
  if (!desde || !hasta) return null

  const iTabla = rows.findIndex((r) => norm(r[0]) === 'FECHA' && r.some((c) => norm(c) === 'SALDO'))
  const cab = rows[iTabla].map(norm)
  const col = {
    fecha: 0,
    descripcion: cab.indexOf('DESCRIPCION'),
    valor: cab.indexOf('VALOR'),
    saldo: cab.indexOf('SALDO'),
  }
  if (col.valor === -1) return null

  const warnings: string[] = []
  const out: ParsedRow[] = []
  let skipped = 0
  let ultimoSaldo: number | null = null
  const anioInicial = Number(desde.slice(0, 4))

  for (const r of rows.slice(iTabla + 1)) {
    const m = /^(\d{1,2})\/(\d{1,2})$/.exec((r[col.fecha] ?? '').trim())
    if (!m) {
      if (r.some((c) => c.trim())) skipped++
      continue
    }
    const [dia, mes] = [m[1].padStart(2, '0'), m[2].padStart(2, '0')]
    let date: ISODate = `${anioInicial}-${mes}-${dia}`
    // Un trimestre de noviembre a enero: "3/01" es del año siguiente.
    if (date < desde) date = `${anioInicial + 1}-${mes}-${dia}`

    const cents = usToCents(r[col.valor])
    if (cents === null || cents === 0) {
      skipped++
      continue
    }
    const saldo = col.saldo !== -1 ? usToCents(r[col.saldo]) : null
    if (saldo !== null) ultimoSaldo = saldo

    const description = (col.descripcion !== -1 ? r[col.descripcion] : r.slice(1, col.valor).join(' ')) ?? ''
    out.push(
      buildRow({
        date,
        description,
        cents,
        installment: '',
        currency: opts.currency ?? MONEDA_BASE,
        raw: r.join(' | '),
        opts,
      }),
    )
  }

  // El resumen: la fila de valores que sigue a "SALDO ANTERIOR … SALDO ACTUAL".
  const iResumen = rows.findIndex((r) => norm(r[0]) === 'SALDO ANTERIOR')
  const cabResumen = iResumen !== -1 ? rows[iResumen].map(norm) : []
  const valResumen = iResumen !== -1 ? rows[iResumen + 1] ?? [] : []
  const saldoAnterior = usToCents(valResumen[cabResumen.indexOf('SALDO ANTERIOR')])
  const saldoActual = usToCents(valResumen[cabResumen.indexOf('SALDO ACTUAL')])

  if (saldoAnterior !== null && saldoActual !== null) {
    const suma = out.reduce((a, x) => a + x.amountCents, 0)
    const diferencia = saldoAnterior + suma - saldoActual
    if (diferencia !== 0) {
      warnings.push(
        `El extracto no cierra: saldo anterior más los ${out.length} movimientos da ` +
          `${((saldoAnterior + suma) / 100).toFixed(2)} y el banco informa ${(saldoActual / 100).toFixed(2)}. ` +
          'Puede faltar alguna fila; conviene revisar el archivo antes de confiar en el saldo.',
      )
    }
  }

  const final = saldoActual ?? ultimoSaldo
  return {
    rows: out,
    skipped,
    strategy: 'csv',
    warnings,
    ...(final !== null ? { finalBalanceCents: final, finalBalanceDate: hasta } : {}),
  }
}
