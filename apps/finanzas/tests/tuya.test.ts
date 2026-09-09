import { describe, expect, it } from 'vitest'
import { isTuyaStatement, parseTuya } from '@/lib/parsers/tuya'
import { parseStatement } from '@/lib/parsers/statement'
import { cardDues } from '@/lib/cashflow'
import { pendingInstallments } from '@/lib/monthly'

/**
 * Recorte de un extracto de Tuya con la forma real y números inventados.
 * Las columnas son: valor de la transacción, saldo pendiente, cuota del mes,
 * dos tasas y el plan de cuotas.
 */
const EXTRACTO = `Extracto Tarjeta de Crédito
03-sep-2026 $550.000,00 $2.150.000,00
Resumen Pago Mínimo Resumen Pago Total
Fecha de Corte: 09-ago-2026 (+) Abono a capital 450.000,00 (+) Saldo pendiente 1.600.000,00
(+) Intereses corrientes 30.000,00 (+) Intereses corrientes 30.000,00
(+) Cuota de manejo 38.800,00 (+) Cuota de manejo 38.800,00
(+) Póliza deudores 31.200,00 (+) Póliza deudores 31.200,00
(+) Intereses de mora 0,00 (+) Intereses de mora 0,00
=PAGO MÍNIMO $550.000,00 =PAGO TOTAL $2.150.000,00
Detalles
Valor Saldo Cuota a pagar Tasa de Interés Tasa de Interés Cuotas
Fecha Descripción
Transacción Pendiente del mes de la transacción Efectiva Anual cobradas/totales
2025/08/25 +COMPRA EXITO.COM | ALMACENES EXITO 2.400.000,00 1.200.000,00 200.000,00 1,88% 25,14% 6/12
2025/09/10 +AVANCE ATM | BCOL HALLBUEVII2 600.000,00 400.000,00 100.000,00 1,87% 24,98% 4/6
2025/09/10 +AVANCE ATM | BCOL HALLBUEVII2 600.000,00 400.000,00 100.000,00 1,87% 24,98% 4/6
2026/08/05 +COMPRAS RECURR | RAPPI COLOMBIA*DL 50.000,00 0,00 50.000,00 2,18% 29,62% 1/1
2026/08/04 -PAGO BOTON BANCOLOM 900.000,00 0,00 0,00 0,00% 0,00% 0/0
2026/08/09 +CUOTA DE MANEJO 38.800,00 0,00 0,00 0,00% 0,00% 0/0
2026/08/09 +SEG DEUD IVA INCL 31.200,00 0,00 0,00 0,00% 0,00% 0/0
Tasas de interés vigente (Agosto 2026)
Cupón de pago
Número de tarjeta: ************0266
Fecha límite de pago: 03-sep-2026`

describe('reconocer el extracto de Tuya', () => {
  it('lo distingue de un resumen cualquiera', () => {
    expect(isTuyaStatement(EXTRACTO)).toBe(true)
    expect(isTuyaStatement('05/07/2026  COTO CICSA  -1.000,00')).toBe(false)
  })

  it('parseStatement lo despacha solo, sin que el importador sepa de bancos', () => {
    const res = parseStatement(EXTRACTO, { kind: 'card' })
    expect(res.rows).toHaveLength(8)
    expect(res.statementDueDate).toBe('2026-09-03')
  })
})

describe('qué importe se toma de cada fila', () => {
  const res = parseTuya(EXTRACTO)
  const buscar = (texto: string) => res.rows.find((r) => r.description.includes(texto))!

  it('con plan de cuotas toma la cuota del mes, no el valor de la compra', () => {
    // La compra fue de 2.400.000 pero este mes se pagan 200.000.
    expect(buscar('EXITO.COM').amountCents).toBe(-20000000)
    expect(buscar('EXITO.COM').installment).toBe('6/12')
  })

  it('sin plan de cuotas toma el valor de la transacción', () => {
    expect(buscar('CUOTA DE MANEJO').amountCents).toBe(-3880000)
    expect(buscar('SEG DEUD').amountCents).toBe(-3120000)
  })

  it('un pago entra en positivo y no cuenta como gasto', () => {
    const pago = buscar('PAGO BOTON')
    expect(pago.amountCents).toBe(90000000)
    expect(pago.category).toBe('pago_tarjeta')
  })

  it('agrega los intereses, que no son una fila de la tabla', () => {
    const intereses = res.rows.find((r) => r.description === 'Intereses del período')!
    expect(intereses.amountCents).toBe(-3000000)
  })

  it('la suma de cargos da exactamente el pago mínimo del extracto', () => {
    const cargos = res.rows.filter((r) => r.amountCents < 0).reduce((a, r) => a + -r.amountCents, 0)
    expect(cargos).toBe(res.meta.minimumCents)
    expect(res.warnings).toHaveLength(0)
  })

  it('avisa si la suma no cierra con lo que declara el extracto', () => {
    const roto = EXTRACTO.replace('=PAGO MÍNIMO $550.000,00', '=PAGO MÍNIMO $999.999,00')
    expect(parseTuya(roto).warnings.join(' ')).toMatch(/no coincide con el pago mínimo/)
  })
})

describe('fechas y períodos', () => {
  const res = parseTuya(EXTRACTO)

  it('lee corte y vencimiento del propio extracto', () => {
    expect(res.meta.closingDate).toBe('2026-08-09')
    expect(res.meta.dueDate).toBe('2026-09-03')
  })

  it('conserva la fecha original de cada compra, aunque sea de otro año', () => {
    expect(res.rows[0].date).toBe('2025-08-25')
  })

  it('el vencimiento del extracto ubica en el ciclo correcto a las compras viejas', () => {
    const card = { id: 'c1', name: 'Tuya', closing_day: 9, due_day: 3 }
    const txs = res.rows
      .filter((r) => r.amountCents < 0)
      .map((r) => ({
        date: r.date,
        amount_cents: r.amountCents,
        category: r.category,
        method: 'credito',
        card_id: 'c1',
        statement_due: res.meta.dueDate,
      }))

    const dues = cardDues(card, txs, '2026-09-01', '2026-08-28')
    // Todo cae en un único resumen, el del 3 de septiembre.
    expect(dues).toHaveLength(1)
    expect(dues[0].due_date).toBe('2026-09-03')
    expect(dues[0].amount_cents).toBe(res.meta.minimumCents)
  })

  it('sin ese dato, una compra de 2025 caería en un resumen de 2025', () => {
    const card = { id: 'c1', name: 'Tuya', closing_day: 9, due_day: 3 }
    const dues = cardDues(
      card,
      [{ date: '2025-08-25', amount_cents: -20000000, category: 'otros', method: 'credito', card_id: 'c1' }],
      '2026-09-01',
      '2025-01-01',
    )
    expect(dues[0].due_date).toBe('2025-10-03')
  })
})

describe('las cuotas que faltan salen del propio extracto', () => {
  it('cada plan deja sus cuotas restantes en los meses siguientes', () => {
    const res = parseTuya(EXTRACTO)
    const txs = res.rows
      .filter((r) => r.installment)
      .map((r, i) => ({
        id: `t${i}`,
        description: r.description,
        merchant: r.merchant,
        amount_cents: r.amountCents,
        installment: r.installment,
        card_id: 'c1',
        billing_period: '2026-09',
        date: r.date,
      }))

    const cuotas = pendingInstallments(txs, '2026-09-08')
    // 6 de la compra (7..12) y 2 por cada avance (5 y 6); el 1/1 no deja nada.
    expect(cuotas).toHaveLength(10)
    const total = cuotas.reduce((a, c) => a + c.amountCents, 0)
    // Coincide con la suma de saldos pendientes del extracto.
    expect(total).toBe(120000000 + 20000000 + 20000000)
  })
})
