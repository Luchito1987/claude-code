import { describe, expect, it } from 'vitest'
import {
  debtSummary,
  monthlyOutlook,
  parseInstallment,
  pendingInstallments,
  pendingLoanInstallments,
  settledLoanInstallments,
} from '@/lib/monthly'
import { financialMonth, monthRange, nextMonths } from '@/lib/dates'

const HOY = '2026-08-05'

describe('mes financiero', () => {
  it('cierra el 27 y arranca el 28', () => {
    expect(financialMonth('2026-08-27')).toBe('2026-08')
    expect(financialMonth('2026-08-28')).toBe('2026-09')
    expect(financialMonth('2026-08-01')).toBe('2026-08')
  })

  it('cruza el año', () => {
    expect(financialMonth('2026-12-28')).toBe('2027-01')
  })

  it('el rango va del 28 anterior al 27', () => {
    expect(monthRange('2026-09')).toEqual({ start: '2026-08-28', end: '2026-09-27' })
    expect(monthRange('2027-01')).toEqual({ start: '2026-12-28', end: '2027-01-27' })
  })

  it('enumera los meses siguientes desde el actual', () => {
    expect(nextMonths(3, '2026-11')).toEqual(['2026-11', '2026-12', '2027-01'])
  })
})

describe('parseInstallment', () => {
  it('lee las formas que usan los resúmenes', () => {
    expect(parseInstallment('3/6')).toEqual({ n: 3, total: 6 })
    expect(parseInstallment('03/06')).toEqual({ n: 3, total: 6 })
    expect(parseInstallment('cuota 2 de 12')).toEqual({ n: 2, total: 12 })
  })

  it('rechaza lo que no es una cuota', () => {
    expect(parseInstallment('')).toBeNull()
    expect(parseInstallment('7/6')).toBeNull()
    expect(parseInstallment('un pago')).toBeNull()
  })
})

describe('cuotas de tarjeta pendientes', () => {
  const compra = {
    id: 't1',
    description: 'ZARA ARGENTINA',
    merchant: 'ZARA ARGENTINA',
    amount_cents: -2500000,
    installment: '3/6',
    card_id: 'c1',
    billing_period: '2026-08',
    date: '2026-05-09',
  }

  it('deja una cuota por mes hasta completar el plan', () => {
    const cuotas = pendingInstallments([compra], HOY)
    expect(cuotas.map((c) => c.period)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(cuotas.map((c) => c.number)).toEqual([4, 5, 6])
    expect(cuotas.every((c) => c.amountCents === 2500000)).toBe(true)
  })

  it('la última cuota no deja nada pendiente', () => {
    expect(pendingInstallments([{ ...compra, installment: '6/6' }], HOY)).toHaveLength(0)
  })

  it('ignora los pagos en una cuota', () => {
    expect(pendingInstallments([{ ...compra, installment: '' }], HOY)).toHaveLength(0)
  })

  it('descarta las cuotas de meses que ya pasaron', () => {
    // Resumen viejo: las cuotas 4 y 5 caían en marzo y abril.
    const vieja = { ...compra, billing_period: '2026-02' }
    const cuotas = pendingInstallments([vieja], HOY)
    expect(cuotas.every((c) => c.period >= '2026-08')).toBe(true)
  })

  it('si falta el mes de resumen lo deduce de la fecha', () => {
    const sinPeriodo = { ...compra, billing_period: null, date: '2026-08-10' }
    expect(pendingInstallments([sinPeriodo], HOY)[0].period).toBe('2026-09')
  })
})

describe('cuotas de préstamo', () => {
  const prestamo = {
    id: 'l1',
    name: 'Personal',
    installment_cents: 18500000,
    installments_total: 24,
    installments_paid: 7,
    first_due_date: '2026-01-15',
    active: 1,
  }

  it('ubica cada cuota en su mes financiero', () => {
    const cuotas = pendingLoanInstallments([prestamo], HOY)
    expect(cuotas).toHaveLength(17)
    expect(cuotas[0]).toMatchObject({ period: '2026-08', number: 8 })
  })

  it('una cuota atrasada se arrastra al mes en curso', () => {
    const atrasado = { ...prestamo, installments_paid: 5 }
    const cuotas = pendingLoanInstallments(atrasado ? [atrasado] : [], HOY)
    // Las cuotas 6 y 7 vencían en junio y julio: van al mes actual.
    expect(cuotas.filter((c) => c.period === '2026-08')).toHaveLength(3)
  })

  /*
   * Con la cuota de agosto ya paga, el préstamo se caía entero de la lista del
   * mes: la próxima pendiente es la de septiembre y no quedaba nada que mostrar
   * en agosto. El tablero decía que ese mes no se pagaba ninguna cuota.
   */
  it('la cuota ya pagada del mes se sigue pudiendo mostrar', () => {
    const alDia = { ...prestamo, installments_paid: 8 }
    expect(pendingLoanInstallments([alDia], HOY).filter((c) => c.period === '2026-08')).toHaveLength(0)

    const saldadas = settledLoanInstallments([alDia], '2026-08')
    expect(saldadas).toHaveLength(1)
    expect(saldadas[0]).toMatchObject({ period: '2026-08', number: 8, amountCents: 18500000 })
  })

  it('un préstamo dado de baja conserva las cuotas que sí pagó', () => {
    const cerrado = { ...prestamo, active: 0 }
    expect(pendingLoanInstallments([cerrado], HOY)).toHaveLength(0)
    expect(settledLoanInstallments([cerrado], '2026-07')).toHaveLength(1)
  })

  it('no inventa cuotas en un mes donde no vencía ninguna', () => {
    expect(settledLoanInstallments([prestamo], '2025-12')).toHaveLength(0)
  })
})

describe('proyección mensual', () => {
  const base = {
    months: ['2026-08', '2026-09', '2026-10'],
    bills: [
      { name: 'Luz', period: '2026-08', amount_cents: 4200000, estimated: 0 },
      { name: 'Gas', period: '2026-08', amount_cents: 1850000, estimated: 1 },
    ],
    serviceEstimates: [
      { name: 'Luz', cents: 4000000 },
      { name: 'Gas', cents: 1800000 },
    ],
    loans: [
      {
        id: 'l1',
        name: 'Personal',
        installment_cents: 18500000,
        installments_total: 24,
        installments_paid: 7,
        first_due_date: '2026-01-15',
        active: 1,
      },
    ],
    installments: pendingInstallments(
      [
        {
          id: 't1',
          description: 'ZARA',
          merchant: 'ZARA',
          amount_cents: -2500000,
          installment: '3/6',
          card_id: 'c1',
          billing_period: '2026-08',
          date: '2026-05-09',
        },
      ],
      HOY,
    ),
    cardDues: [{ cardId: 'c1', name: 'Visa', due_date: '2026-08-05', amount_cents: 30000000 }],
    incomeMonthlyCents: 167000000,
    dailyBurnCents: 0,
    today: HOY,
  }

  it('usa las facturas reales del mes y estima los meses siguientes', () => {
    const [agosto, septiembre] = monthlyOutlook(base)
    expect(agosto.serviciosCents).toBe(4200000 + 1850000)
    expect(septiembre.serviciosCents).toBe(4000000 + 1800000)
    expect(septiembre.serviciosEstimados).toBe(true)
  })

  it('el resumen importado manda sobre la cuota proyectada del mismo mes', () => {
    // En agosto hay resumen real: no se suma además la cuota proyectada.
    const [agosto] = monthlyOutlook(base)
    expect(agosto.tarjetasCents).toBe(30000000)
    expect(agosto.tarjetasEstimadas).toBe(false)
  })

  it('en los meses sin resumen proyecta las cuotas', () => {
    const [, septiembre] = monthlyOutlook(base)
    expect(septiembre.tarjetasCents).toBe(2500000)
    expect(septiembre.tarjetasEstimadas).toBe(true)
  })

  it('suma la cuota del préstamo en cada mes', () => {
    for (const mes of monthlyOutlook(base)) expect(mes.prestamosCents).toBe(18500000)
  })

  it('el total es la suma de las partes y el neto lo que sobra del ingreso', () => {
    for (const m of monthlyOutlook(base)) {
      expect(m.totalCents).toBe(m.serviciosCents + m.prestamosCents + m.tarjetasCents + m.variableCents)
      expect(m.netoCents).toBe(m.ingresosCents - m.totalCents)
    }
  })

  it('prorratea el gasto variable por los días del mes', () => {
    const [agosto] = monthlyOutlook({ ...base, dailyBurnCents: 100000 })
    // Del 28 de julio al 27 de agosto: 31 días.
    expect(agosto.variableCents).toBe(100000 * 31)
  })
})

describe('resumen de deudas', () => {
  const args = {
    cards: [{ id: 'c1', name: 'Visa' }],
    loans: [
      {
        id: 'l1',
        name: 'Personal',
        installment_cents: 18500000,
        installments_total: 10,
        installments_paid: 8,
        first_due_date: '2026-01-15',
        active: 1,
      },
    ],
    installments: pendingInstallments(
      [
        {
          id: 't1',
          description: 'ZARA',
          merchant: 'ZARA',
          amount_cents: -2500000,
          installment: '3/6',
          card_id: 'c1',
          billing_period: '2026-08',
          date: '2026-05-09',
        },
      ],
      HOY,
    ),
    cardDues: [{ cardId: 'c1', name: 'Visa', due_date: '2026-08-05', amount_cents: 30000000 }],
    incomeMonthlyCents: 100000000,
    today: HOY,
  }

  it('suma resumen a vencer más cuotas futuras por tarjeta', () => {
    const d = debtSummary(args)
    expect(d.cards[0].resumenCents).toBe(30000000)
    expect(d.cards[0].cuotasCents).toBe(2500000 * 3)
    expect(d.cards[0].totalCents).toBe(30000000 + 7500000)
  })

  it('el saldo del préstamo son las cuotas que faltan', () => {
    const d = debtSummary(args)
    expect(d.loans[0].remaining).toBe(2)
    expect(d.loans[0].totalCents).toBe(18500000 * 2)
  })

  it('el total junta tarjetas y préstamos', () => {
    const d = debtSummary(args)
    expect(d.totalCents).toBe(37500000 + 37000000)
  })

  it('calcula el peso sobre el ingreso del mes en curso', () => {
    const d = debtSummary(args)
    // En agosto solo vence el resumen: con 8 cuotas pagas desde enero, la
    // novena del préstamo recién cae en septiembre.
    expect(d.proximoMesCents).toBe(30000000)
    expect(d.pesoSobreIngreso).toBe(30)
  })

  it('los meses siguientes suman cuota de tarjeta y de préstamo', () => {
    const d = debtSummary(args)
    const septiembre = d.porMes.find((m) => m.period === '2026-09')
    expect(septiembre?.cents).toBe(2500000 + 18500000)
  })

  it('dice hasta cuándo dura la deuda', () => {
    const d = debtSummary(args)
    expect(d.ultimoMes).toBe('2026-11')
    expect(d.mesesRestantes).toBe(4)
  })

  it('sin deudas no explota', () => {
    const vacio = debtSummary({ ...args, loans: [], installments: [], cardDues: [] })
    expect(vacio.totalCents).toBe(0)
    expect(vacio.mesesRestantes).toBe(0)
    expect(vacio.ultimoMes).toBeNull()
  })
})
