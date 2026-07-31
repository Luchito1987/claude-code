import { describe, expect, it } from 'vitest'
import { analyzeRappi, parseRappiCsv, parseRappiReceipts, rappiFingerprint } from '@/lib/parsers/rappi'
import { categorize, isRappi } from '@/lib/categories'

const MAILS = `Pedido #98765432
Fecha: 12/07/2026
Restaurante: Mostaza Cabildo
Productos $ 14.300,00
Costo de envío $ 1.900,00
Tarifa de servicio $ 850,00
Propina $ 1.000,00
Total $ 18.050,00

Pedido #98765499
Fecha: 19/07/2026
Restaurante: Farmacity Turbo
Productos $ 8.000,00
Costo de envío $ 1.200,00
Total $ 9.200,00`

describe('parseRappiReceipts', () => {
  const res = parseRappiReceipts(MAILS, 2026)

  it('separa los pedidos por número', () => {
    expect(res.orders).toHaveLength(2)
  })

  it('extrae el desglose completo', () => {
    expect(res.orders[0]).toMatchObject({
      date: '2026-07-12',
      store: 'Mostaza Cabildo',
      totalCents: 1805000,
      productsCents: 1430000,
      deliveryCents: 190000,
      serviceCents: 85000,
      tipCents: 100000,
    })
  })

  it('deduce la vertical', () => {
    expect(res.orders[0].vertical).toBe('restaurante')
    expect(res.orders[1].vertical).toBe('farmacia')
  })

  it('avisa cuando no reconoce nada', () => {
    const vacio = parseRappiReceipts('hola qué tal, nada de esto es un pedido', 2026)
    expect(vacio.orders).toHaveLength(0)
    expect(vacio.warnings.length).toBeGreaterThan(0)
  })
})

describe('parseRappiCsv', () => {
  it('mapea las columnas por nombre', () => {
    const csv = `fecha,tienda,total,envio,propina
12/07/2026,Mostaza,18050.00,1900.00,1000.00
19/07/2026,Farmacity,9200.00,1200.00,0`
    const res = parseRappiCsv(csv, 2026)
    expect(res.orders).toHaveLength(2)
    expect(res.orders[0].totalCents).toBe(1805000)
    expect(res.orders[0].deliveryCents).toBe(190000)
  })

  it('pide fecha y total como mínimo', () => {
    const res = parseRappiCsv('a,b\n1,2', 2026)
    expect(res.orders).toHaveLength(0)
    expect(res.warnings[0]).toMatch(/fecha y total/)
  })
})

describe('analyzeRappi', () => {
  const orders = parseRappiReceipts(MAILS, 2026).orders
  const a = analyzeRappi(orders)

  it('calcula total, ticket promedio y overhead', () => {
    expect(a.orders).toBe(2)
    expect(a.totalCents).toBe(2725000)
    expect(a.avgTicketCents).toBe(1362500)
    // envío + servicio + propina de los dos pedidos
    expect(a.overheadCents).toBe(190000 + 85000 + 100000 + 120000)
  })

  it('agrupa por mes y por día de la semana', () => {
    expect(a.perMonth).toEqual([{ period: '2026-07', orders: 2, totalCents: 2725000 }])
    const domingo = a.byWeekday.find((d) => d.day === 'domingo')
    expect(domingo?.orders).toBe(2) // 12 y 19 de julio de 2026 son domingos
  })

  it('no explota sin pedidos', () => {
    const vacio = analyzeRappi([])
    expect(vacio.avgTicketCents).toBe(0)
    expect(vacio.overheadPct).toBe(0)
  })
})

describe('fingerprint de pedidos', () => {
  it('reimportar el mismo pedido da la misma huella', () => {
    const [a, b] = parseRappiReceipts(MAILS, 2026).orders
    expect(rappiFingerprint(a)).toBe(rappiFingerprint({ ...a, raw: 'otro texto' }))
    expect(rappiFingerprint(a)).not.toBe(rappiFingerprint(b))
  })
})

describe('detección en el resumen de tarjeta', () => {
  it('reconoce las variantes que escriben los bancos', () => {
    expect(isRappi('COMPRA 1234 RAPPI*BURGER KING')).toBe(true)
    expect(isRappi('RAPPIPRO SUSCRIPCION')).toBe(true)
    expect(isRappi('COTO CICSA')).toBe(false)
  })

  it('las manda a delivery', () => {
    expect(categorize('RAPPI*MOSTAZA')).toBe('delivery')
    expect(categorize('PEDIDOSYA')).toBe('delivery')
  })

  it('las reglas del usuario ganan sobre las de fábrica', () => {
    expect(categorize('RAPPI*FARMACIA', [{ pattern: 'RAPPI*FARMACIA', category: 'farmacia', priority: 1 }])).toBe(
      'farmacia',
    )
  })
})
