import { describe, expect, it } from 'vitest'
import { cardDues, dailyBurn, incomeSchedule, loanSchedule, project } from '@/lib/cashflow'

const TODAY = '2026-07-31'

const loan = {
  id: 'l1',
  name: 'Préstamo',
  installment_cents: 10000000,
  installments_total: 12,
  installments_paid: 3,
  first_due_date: '2026-05-10',
  active: 1,
}

describe('loanSchedule', () => {
  it('arranca en la cuota siguiente a la última pagada', () => {
    const events = loanSchedule(loan, TODAY, '2026-10-31')
    expect(events.map((e) => e.date)).toEqual(['2026-08-10', '2026-09-10', '2026-10-10'])
    expect(events[0].label).toContain('cuota 4/12')
  })

  it('no genera cuotas más allá del total', () => {
    const casi = { ...loan, installments_paid: 11 }
    expect(loanSchedule(casi, TODAY, '2027-12-31')).toHaveLength(1)
  })

  it('ignora préstamos dados de baja', () => {
    expect(loanSchedule({ ...loan, active: 0 }, TODAY, '2027-01-01')).toHaveLength(0)
  })
})

describe('incomeSchedule', () => {
  const income = { id: 'i1', name: 'Sueldo', amount_cents: 180000000, day_of_month: 5, active: 1 }

  it('repite mes a mes dentro del rango', () => {
    const events = incomeSchedule(income, TODAY, '2026-10-31')
    expect(events.map((e) => e.date)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05'])
  })

  it('recorta el día al último del mes cuando no existe', () => {
    const events = incomeSchedule({ ...income, day_of_month: 31 }, '2026-02-01', '2026-02-28')
    expect(events[0].date).toBe('2026-02-28')
  })
})

describe('cardDues', () => {
  const card = { id: 'c1', name: 'Visa', closing_day: 25, due_day: 5 }

  it('agrupa los consumos en el resumen que cierra después de la compra', () => {
    const txs = [
      { date: '2026-07-10', amount_cents: -100000, category: 'otros', method: 'credito', card_id: 'c1' },
      { date: '2026-07-20', amount_cents: -50000, category: 'otros', method: 'credito', card_id: 'c1' },
      // Después del cierre del 25: cae en el resumen siguiente.
      { date: '2026-07-28', amount_cents: -70000, category: 'otros', method: 'credito', card_id: 'c1' },
    ]
    const dues = cardDues(card, txs, TODAY)
    expect(dues).toHaveLength(2)
    expect(dues[0]).toMatchObject({ due_date: '2026-08-05', amount_cents: 150000 })
    expect(dues[1]).toMatchObject({ due_date: '2026-09-05', amount_cents: 70000 })
  })

  it('ignora los movimientos de otras tarjetas y los créditos', () => {
    const txs = [
      { date: '2026-07-10', amount_cents: -100000, category: 'otros', method: 'credito', card_id: 'otra' },
      { date: '2026-07-10', amount_cents: 100000, category: 'otros', method: 'credito', card_id: 'c1' },
    ]
    expect(cardDues(card, txs, TODAY)).toHaveLength(0)
  })
})

describe('dailyBurn', () => {
  it('promedia sobre los días que cubre el historial, no sobre la ventana entera', () => {
    const txs = [
      { date: '2026-07-22', amount_cents: -70000, category: 'supermercado', method: 'debito' },
      { date: '2026-07-29', amount_cents: -70000, category: 'delivery', method: 'credito' },
    ]
    // 1.400 en 10 días (22 al 31) = 140 por día.
    expect(dailyBurn(txs, TODAY)).toBe(14000)
  })

  it('deja afuera los rubros que ya se proyectan como eventos propios', () => {
    const txs = [
      { date: '2026-07-30', amount_cents: -500000, category: 'servicios', method: 'debito' },
      { date: '2026-07-30', amount_cents: -500000, category: 'prestamos', method: 'debito' },
      { date: '2026-07-30', amount_cents: 900000, category: 'ingresos', method: 'transferencia' },
    ]
    expect(dailyBurn(txs, TODAY)).toBe(0)
  })
})

describe('project', () => {
  const base = {
    today: TODAY,
    weeks: 4,
    openingCents: 50000000,
    bills: [
      { id: 'b1', name: 'Luz', due_date: '2026-08-10', amount_cents: 8000000, status: 'pendiente' },
      { id: 'b2', name: 'Gas', due_date: '2026-08-12', amount_cents: 5000000, status: 'pagado' },
    ],
    loans: [loan],
    incomes: [{ id: 'i1', name: 'Sueldo', amount_cents: 180000000, day_of_month: 5, active: 1 }],
    cardDues: [{ cardId: 'c1', name: 'Visa', due_date: '2026-08-05', amount_cents: 60000000 }],
    dailyBurnCents: 1000000,
    minBufferCents: 20000000,
  }

  it('ignora las facturas ya pagadas', () => {
    const p = project(base)
    expect(p.events.some((e) => e.label === 'Gas')).toBe(false)
    expect(p.events.some((e) => e.label === 'Luz')).toBe(true)
  })

  it('cierra en saldo inicial + entradas − salidas', () => {
    const p = project(base)
    expect(p.closingCents).toBe(p.openingCents + p.totalInflowCents - p.totalOutflowCents)
  })

  it('separa compromisos de gasto variable proyectado', () => {
    const p = project(base)
    expect(p.projectedVariableCents).toBe(base.dailyBurnCents * 4 * 7)
    expect(p.committedCents).toBe(8000000 + 60000000 + loan.installment_cents)
  })

  it('las semanas encadenan cierre con apertura', () => {
    const p = project(base)
    expect(p.weeks).toHaveLength(4)
    for (let i = 1; i < p.weeks.length; i++) {
      expect(p.weeks[i].openingCents).toBe(p.weeks[i - 1].closingCents)
    }
  })

  it('marca el día en que se perfora el colchón y el piso de la curva', () => {
    const p = project({ ...base, incomes: [] })
    expect(p.breachDate).not.toBeNull()
    expect(p.lowestCents).toBeLessThan(base.minBufferCents)
    expect(p.negativeDate).not.toBeNull()
  })

  it('ancla a hoy las facturas vencidas: la plata falta igual', () => {
    const p = project({
      ...base,
      bills: [{ id: 'b3', name: 'Internet', due_date: '2026-07-01', amount_cents: 3000000, status: 'pendiente' }],
    })
    const evento = p.events.find((e) => e.label.startsWith('Internet'))
    expect(evento?.date).toBe(TODAY)
    expect(evento?.label).toContain('vencida')
  })

  it('sin colchón ni eventos, el saldo no se mueve', () => {
    const p = project({
      ...base,
      bills: [],
      loans: [],
      incomes: [],
      cardDues: [],
      dailyBurnCents: 0,
      minBufferCents: 0,
    })
    expect(p.closingCents).toBe(base.openingCents)
    expect(p.breachDate).toBeNull()
  })
})
