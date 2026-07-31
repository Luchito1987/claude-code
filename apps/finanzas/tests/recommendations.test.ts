import { describe, expect, it } from 'vitest'
import { buildRecommendations, type RecoInput } from '@/lib/recommendations'
import { project } from '@/lib/cashflow'

const TODAY = '2026-07-31'

function baseInput(over: Partial<RecoInput> = {}): RecoInput {
  const projection = project({
    today: TODAY,
    weeks: 8,
    openingCents: 100_000_00,
    bills: [],
    loans: [],
    incomes: [],
    cardDues: [],
    dailyBurnCents: 0,
    minBufferCents: 0,
  })
  return {
    today: TODAY,
    projection,
    transactions: [],
    bills: [],
    services: [],
    loans: [],
    monthlyIncomeCents: 1_000_000_00,
    minBufferCents: 0,
    windowOpen: false,
    windowPeriod: '2026-08',
    ...over,
  }
}

const tx = (date: string, merchant: string, cents: number, category = 'otros') => ({
  date,
  description: merchant,
  merchant,
  amount_cents: -cents,
  category,
})

describe('alerta de caja', () => {
  it('marca crítica cuando la proyección se va a negativo', () => {
    const projection = project({
      today: TODAY,
      weeks: 4,
      openingCents: 10_000_00,
      bills: [{ id: 'b', name: 'Luz', due_date: '2026-08-05', amount_cents: 90_000_00, status: 'pendiente' }],
      loans: [],
      incomes: [],
      cardDues: [],
      dailyBurnCents: 0,
      minBufferCents: 50_000_00,
    })
    const recos = buildRecommendations(baseInput({ projection, minBufferCents: 50_000_00 }))
    expect(recos[0].severity).toBe('critica')
    expect(recos[0].id).toBe('caja-negativa')
    expect(recos[0].impactCents).toBeGreaterThan(0)
  })

  it('no inventa alertas cuando la caja está sana', () => {
    const recos = buildRecommendations(baseInput())
    expect(recos.some((r) => r.severity === 'critica')).toBe(false)
  })
})

describe('facturas vencidas', () => {
  it('las lista y suma el total impago', () => {
    const recos = buildRecommendations(
      baseInput({
        bills: [
          { id: 'b1', name: 'Gas', due_date: '2026-07-10', amount_cents: 20_000_00, status: 'pendiente', estimated: 0 },
          { id: 'b2', name: 'Luz', due_date: '2026-08-10', amount_cents: 30_000_00, status: 'pendiente', estimated: 0 },
        ],
      }),
    )
    const r = recos.find((x) => x.id === 'facturas-vencidas')
    expect(r?.impactCents).toBe(20_000_00)
    expect(r?.title).toContain('1 factura')
  })
})

describe('suscripciones', () => {
  const mensual = (merchant: string, cents: number) =>
    ['2026-05-10', '2026-06-10', '2026-07-10'].map((d) => tx(d, merchant, cents))

  it('detecta cargos mensuales de importe estable', () => {
    const recos = buildRecommendations(
      baseInput({ transactions: [...mensual('NETFLIX', 9_900_00), ...mensual('SPOTIFY', 4_500_00)] }),
    )
    const r = recos.find((x) => x.id === 'suscripciones')
    expect(r).toBeDefined()
    expect(r?.impactCents).toBe(14_400_00)
  })

  it('no confunde al súper, donde comprás varias veces por mes', () => {
    const supermercado = [
      '2026-05-03', '2026-05-17', '2026-05-28',
      '2026-06-04', '2026-06-19', '2026-06-27',
      '2026-07-02', '2026-07-14', '2026-07-25',
    ].map((d) => tx(d, 'COTO CICSA', 45_000_00, 'supermercado'))
    const recos = buildRecommendations(baseInput({ transactions: supermercado }))
    expect(recos.find((x) => x.id === 'suscripciones')).toBeUndefined()
  })

  it('tampoco confunde importes que varían mes a mes', () => {
    const transactions = [
      tx('2026-05-10', 'FERRETERIA', 10_000_00),
      tx('2026-06-10', 'FERRETERIA', 45_000_00),
      tx('2026-07-10', 'FERRETERIA', 22_000_00),
    ]
    expect(buildRecommendations(baseInput({ transactions })).find((x) => x.id === 'suscripciones')).toBeUndefined()
  })
})

describe('carga de deuda', () => {
  it('avisa cuando las cuotas superan el 25% del ingreso', () => {
    const recos = buildRecommendations(
      baseInput({
        loans: [
          { name: 'Personal', installment_cents: 400_000_00, installments_total: 12, installments_paid: 2, active: 1 },
        ],
      }),
    )
    const r = recos.find((x) => x.id === 'carga-deuda')
    expect(r?.severity).toBe('alta')
    expect(r?.title).toContain('40%')
  })

  it('se calla si la carga es razonable', () => {
    const recos = buildRecommendations(
      baseInput({
        loans: [
          { name: 'Personal', installment_cents: 100_000_00, installments_total: 12, installments_paid: 2, active: 1 },
        ],
      }),
    )
    expect(recos.find((x) => x.id === 'carga-deuda')).toBeUndefined()
  })
})

describe('ventana de facturación', () => {
  it('recuerda confirmar los importes estimados mientras está abierta', () => {
    const bills = [
      { id: 'b1', name: 'Luz', due_date: '2026-08-08', amount_cents: 42_000_00, status: 'pendiente', estimated: 1 },
    ]
    expect(
      buildRecommendations(baseInput({ bills, windowOpen: true })).find((r) => r.id === 'ventana-facturacion'),
    ).toBeDefined()
    expect(
      buildRecommendations(baseInput({ bills, windowOpen: false })).find((r) => r.id === 'ventana-facturacion'),
    ).toBeUndefined()
  })
})

describe('delivery', () => {
  it('cuantifica el ahorro de bajar un tercio de los pedidos', () => {
    const transactions = ['2026-07-05', '2026-07-12', '2026-07-19', '2026-07-26'].map((d) =>
      tx(d, 'RAPPI', 15_000_00, 'delivery'),
    )
    const r = buildRecommendations(baseInput({ transactions })).find((x) => x.id === 'delivery-volumen')
    expect(r?.impactCents).toBe(20_000_00)
  })
})

describe('orden de salida', () => {
  it('lo urgente va primero y, a igual urgencia, lo de mayor impacto', () => {
    const recos = buildRecommendations(
      baseInput({
        bills: [
          { id: 'b1', name: 'Gas', due_date: '2026-07-10', amount_cents: 20_000_00, status: 'pendiente', estimated: 0 },
        ],
        transactions: ['2026-07-05', '2026-07-12', '2026-07-19'].map((d) => tx(d, 'RAPPI', 15_000_00, 'delivery')),
      }),
    )
    const severities = recos.map((r) => r.severity)
    const rank = { critica: 0, alta: 1, media: 2, info: 3 } as const
    for (let i = 1; i < severities.length; i++) {
      expect(rank[severities[i]]).toBeGreaterThanOrEqual(rank[severities[i - 1]])
    }
  })
})
