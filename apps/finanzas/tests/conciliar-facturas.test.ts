/**
 * Dos pagos con el mismo texto en el mismo mes: cada uno a su factura.
 *
 * La PILA se paga por el operador SOI, y en octubre la cuenta de la empresa
 * tenía dos débitos "PAGO PSE SOI ACH": $431.000 (la PILA de Luciano) y
 * $798.800 (la de la empresa). Tomando el primero del mes, la PILA esperada en
 * $760.500 quedaba pagada con $431.000 y encima corregida a ese importe.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settleBillsFromStatement } from '@/lib/reconcile'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const SOI = [
  { date: '2026-10-08', description: 'PAGO PSE SOI ACH', amountCents: -43_100_000 },
  { date: '2026-10-09', description: 'PAGO PSE SOI ACH', amountCents: -79_880_000 },
]

describe('elegir el pago de cada factura', () => {
  it('entre dos que coinciden, gana el más cercano a lo esperado', () => {
    const [r] = settleBillsFromStatement(
      [{ id: 'pila', serviceName: 'Pago PILA', pattern: 'SOI ACH', amountCents: 76_050_000, period: '2026-10' }],
      SOI,
    )
    expect(r.paidCents).toBe(79_880_000)
    expect(r.rowIndex).toBe(1)
  })

  it('dos facturas con el mismo texto se reparten los pagos, sin importar el orden', () => {
    const pilas = [
      { id: 'luc', serviceName: 'PILA Luciano', pattern: 'SOI ACH', amountCents: 43_100_000, period: '2026-10' },
      { id: 'emp', serviceName: 'Pago PILA', pattern: 'SOI ACH', amountCents: 76_050_000, period: '2026-10' },
    ]
    for (const orden of [pilas, [...pilas].reverse()]) {
      const r = settleBillsFromStatement(orden, SOI)
      expect(Object.fromEntries(r.map((x) => [x.bill.id, x.paidCents]))).toEqual({ luc: 43_100_000, emp: 79_880_000 })
    }
  })

  it('un pago de otro mes no paga la factura de este', () => {
    expect(
      settleBillsFromStatement([{ id: 'p', serviceName: 'PILA', pattern: 'SOI ACH', amountCents: 79_880_000, period: '2026-09' }], SOI),
    ).toEqual([])
  })

  it('acepta varias formas de pago separadas por "|"', () => {
    const agua = { id: 'agua', serviceName: 'Agua', pattern: 'TRIPLE A DOMICILIACIO | FIDUCIARIA BANCOLOMBI', amountCents: 50_000_000 }
    const filas = [
      { date: '2026-09-16', description: 'PAGO SV TRIPLE A DOMICILIACIO', amountCents: -45_000_000 },
      { date: '2026-10-12', description: 'PAGO PSE FIDUCIARIA BANCOLOMBI', amountCents: -51_000_000 },
    ]
    expect(settleBillsFromStatement([{ ...agua, period: '2026-09' }], filas)[0].paidCents).toBe(45_000_000)
    expect(settleBillsFromStatement([{ ...agua, period: '2026-10' }], filas)[0].paidCents).toBe(51_000_000)
  })
})

describe('reconciliar facturas ya cargadas', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'finanzas-facturas-'))
    process.env.SQLITE_PATH = join(dir, 'test.db')
    process.env.FINANZAS_API_TOKEN = 'f'.repeat(48)
    vi.resetModules()
  })
  afterEach(() => {
    delete process.env.SQLITE_PATH
    delete process.env.FINANZAS_API_TOKEN
    rmSync(dir, { recursive: true, force: true })
  })

  async function preparar() {
    const { getDb } = await import('@/db/client')
    const q = await import('@/lib/queries')
    const db = getDb()
    db.prepare(`INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES ('emp', 'Empresa', 'ahorro', 'COP', 0, 'x')`).run()
    db.prepare(
      `INSERT INTO services (id, name, category, expected_amount_cents, due_day, match_pattern, created_at)
       VALUES ('s-pila', 'Pago PILA', 'servicios', 76050000, 10, '', 'x')`,
    ).run()
    db.prepare(
      `INSERT INTO bills (id, service_id, period, amount_cents, due_date, status, estimated, source, created_at)
       VALUES ('b-pila', 's-pila', '2026-10', 76050000, '2026-10-10', 'pendiente', 1, 'auto', 'x')`,
    ).run()
    SOI.forEach((m, i) =>
      db.prepare(
        `INSERT INTO transactions (id, date, description, amount_cents, category, account_id, created_at)
         VALUES (?, ?, ?, ?, 'otros', 'emp', 'x')`,
      ).run(`t${i}`, m.date, m.description, m.amountCents),
    )
    const factura = () => db.prepare('SELECT status, amount_cents FROM bills WHERE id = ?').get('b-pila')
    const enlace = (id: string) => (db.prepare('SELECT commitment FROM transactions WHERE id = ?').get(id) as { commitment: string }).commitment
    return { db, q, factura, enlace }
  }

  it('con el patrón cargado, la PILA queda pagada con su pago y el importe corregido', async () => {
    const { db, q, factura, enlace } = await preparar()
    expect(q.reconcileBills()).toEqual([]) // sin patrón no hay nada que cruzar
    db.prepare(`UPDATE services SET match_pattern = 'SOI ACH' WHERE id = 's-pila'`).run()

    expect(q.reconcileBills()).toEqual([
      { servicio: 'Pago PILA', periodo: '2026-10', pagadoCents: 79_880_000, antesCents: 76_050_000, fecha: '2026-10-09' },
    ])
    expect(factura()).toEqual({ status: 'pagado', amount_cents: 79_880_000 })
    expect(enlace('t1')).toBe('factura:b-pila')
    expect(enlace('t0')).toBe('') // la otra PILA queda libre para su propio servicio
    expect(q.reconcileBills()).toEqual([])
  })

  it('por la API: patrón, alta de la segunda PILA y conciliación', async () => {
    const { db, enlace } = await preparar()
    const post = (url: string, body: unknown) =>
      new Request(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${'f'.repeat(48)}` } })
    const { POST: servicios } = await import('@/app/api/servicios/route')
    const { POST: conciliar } = await import('@/app/api/conciliar/route')

    expect((await servicios(post('/api/servicios', { servicio: 'pago pila', patronPago: 'SOI ACH' }))).status).toBe(200)
    const alta = await servicios(post('/api/servicios', { crear: { nombre: 'PILA Luciano', esperadoCents: 43_100_000, dia: 10 }, patronPago: 'SOI ACH' }))
    expect(alta.status).toBe(200)
    const { id } = await alta.json()
    db.prepare(
      `INSERT INTO bills (id, service_id, period, amount_cents, due_date, status, estimated, source, created_at)
       VALUES ('b-luc', ?, '2026-10', 43100000, '2026-10-10', 'pendiente', 1, 'auto', 'x')`,
    ).run(id)

    const { facturas } = await (await conciliar(post('/api/conciliar', {}))).json()
    expect(Object.fromEntries(facturas.map((f: { servicio: string; pagadoCents: number }) => [f.servicio, f.pagadoCents]))).toEqual({
      'Pago PILA': 79_880_000,
      'PILA Luciano': 43_100_000,
    })
    expect([enlace('t0'), enlace('t1')]).toEqual(['factura:b-luc', 'factura:b-pila'])
  })

  it('no crea un servicio duplicado ni uno sin importe', async () => {
    await preparar()
    const post = (body: unknown) =>
      new Request('http://localhost/api/servicios', { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${'f'.repeat(48)}` } })
    const { POST } = await import('@/app/api/servicios/route')
    expect((await POST(post({ crear: { nombre: 'pago pila', esperadoCents: 1, dia: 10 } }))).status).toBe(409)
    expect((await POST(post({ crear: { nombre: 'Otro', esperadoCents: 0, dia: 10 } }))).status).toBe(400)
  })
})
