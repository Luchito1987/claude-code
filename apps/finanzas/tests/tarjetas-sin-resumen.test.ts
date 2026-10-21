/**
 * Tarjetas sin resumen cargado (Visa, Rappi) y préstamos dados de baja en el
 * tablero del mes.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const HOY = '2026-10-13'
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-tsr-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = 'p'.repeat(48)
  vi.resetModules()
})
afterEach(() => {
  delete process.env.SQLITE_PATH
  delete process.env.FINANZAS_API_TOKEN
  rmSync(dir, { recursive: true, force: true })
})

async function load() {
  const q = await import('@/lib/queries')
  const { getDb } = await import('@/db/client')
  const db = getDb()
  db.prepare(`INSERT INTO cards (id, name, due_day) VALUES ('visa', 'Visa', 6), ('rappi', 'Rappi', 15), ('nueva', 'Nueva', 5)`).run()
  const pago = db.prepare(`INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at) VALUES (?, 'tarjeta', ?, ?, ?, 'x')`)
  pago.run('p1', 'visa', '2026-10', 120000000)
  pago.run('p2', 'rappi', '2026-09', 80000000)
  return { q, db }
}

describe('tarjetas sin resumen', () => {
  it('se ven con lo pagado este mes o, si falta, con el último pago estimado', async () => {
    const { q } = await load()
    const t = q.monthItems('2026-10', HOY).filter((i) => i.kind === 'tarjeta')
    const visa = t.find((i) => i.refId === 'visa')!
    const rappi = t.find((i) => i.refId === 'rappi')!
    expect([visa.cents, visa.paid, visa.estimated, visa.dueDate]).toEqual([120000000, true, false, '2026-10-06'])
    expect([rappi.cents, rappi.paid, rappi.estimated, rappi.dueDate]).toEqual([80000000, false, true, '2026-10-15'])
    expect(t.some((i) => i.refId === 'nueva')).toBe(false)
  })
})

describe('préstamos dados de baja', () => {
  it('desaparecen del tablero, aunque tengan una cuota pagada en el mes', async () => {
    const { q, db } = await load()
    db.prepare(
      `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
       installments_paid, first_due_date, rate_annual, active, created_at)
       VALUES ('car', 'Carro', '', 0, 90000000, 10, 10, '2026-01-10', 0, 1, 'x')`,
    ).run()
    expect(q.monthItems('2026-10', HOY).some((i) => i.refId === 'car')).toBe(true)

    const { POST, GET } = await import('@/app/api/prestamos/route')
    const h = { authorization: `Bearer ${'p'.repeat(48)}`, 'content-type': 'application/json' }
    const r = await POST(new Request('http://x/api/prestamos', { method: 'POST', headers: h, body: JSON.stringify({ prestamo: 'carro', activo: false }) }))
    expect(r.status).toBe(200)
    expect(q.monthItems('2026-10', HOY).some((i) => i.refId === 'car')).toBe(false)
    const lista = (await (await GET(new Request('http://x/api/prestamos', { headers: h }))).json()) as Array<{ activo: boolean }>
    expect(lista[0].activo).toBe(false)
  })
})

describe('pago de tarjeta marcado a mano', () => {
  it('marca pagado el resumen del mes pedido', async () => {
    const { q, db } = await load()
    db.prepare(`INSERT INTO cards (id, name, due_day) VALUES ('tuya', 'Tuya', 4)`).run()
    const { POST } = await import('@/app/api/tarjetas/route')
    const h = { authorization: `Bearer ${'p'.repeat(48)}`, 'content-type': 'application/json' }
    const r = await POST(
      new Request('http://x/api/tarjetas', { method: 'POST', headers: h, body: JSON.stringify({ tarjeta: 'Tuya', pagado: { periodo: '2026-11', importeCents: 366498800 } }) }),
    )
    expect(r.status).toBe(200)
    const t = q.monthItems('2026-11', HOY).find((i) => i.refId === 'tuya')!
    expect([t.paid, t.cents]).toEqual([true, 366498800])
    const mal = await POST(new Request('http://x/api/tarjetas', { method: 'POST', headers: h, body: JSON.stringify({ tarjeta: 'Tuya', pagado: { periodo: 'nov' } }) }))
    expect(mal.status).toBe(400)
  })
})

describe('alta de préstamo por API', () => {
  it('crea el préstamo y su primera cuota aparece en el mes', async () => {
    const { q } = await load()
    const { POST } = await import('@/app/api/prestamos/route')
    const h = { authorization: `Bearer ${'p'.repeat(48)}`, 'content-type': 'application/json' }
    const body = { crear: { nombre: 'Préstamo Rappi', capitalCents: 1050000000, cuotaCents: 98811242, cuotas: 12, primeraCuota: '2026-11-20', tasaAnual: 19.79 } }
    const r = await POST(new Request('http://x/api/prestamos', { method: 'POST', headers: h, body: JSON.stringify(body) }))
    expect(r.status).toBe(200)
    const cuota = q.monthItems('2026-11', HOY).find((i) => i.kind === 'prestamo')!
    expect([cuota.label, cuota.cents, cuota.dueDate]).toEqual(['Préstamo Rappi · cuota 1/12', 98811242, '2026-11-20'])
    const repetido = await POST(new Request('http://x/api/prestamos', { method: 'POST', headers: h, body: JSON.stringify(body) }))
    expect(repetido.status).toBe(409)
  })
})

describe('resumen pagado completo y categoría de los pagos', () => {
  it('las cuotas de un resumen saldado dejan de ser deuda y el pago no cuenta como gasto', async () => {
    const { q, db } = await load()
    db.prepare(`INSERT INTO cards (id, name) VALUES ('fal', 'Falabella')`).run()
    db.prepare(`INSERT INTO statements (id, kind, card_id, due_date, imported_at) VALUES ('s1', 'card', 'fal', '2026-10-10', 'x')`).run()
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, card_id, statement_id, installment, billing_period, created_at)
       VALUES ('c1', '2026-09-05', 'WOMPI', -6900157, 'fal', 's1', '1/4', '2026-10', 'x')`,
    ).run()
    expect(q.cardInstallments(HOY).length).toBe(3)

    const { POST } = await import('@/app/api/tarjetas/route')
    const h = { authorization: `Bearer ${'p'.repeat(48)}`, 'content-type': 'application/json' }
    const r = await POST(new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify({ tarjeta: 'Falabella', saldada: { hasta: '2026-11-30' } }) }))
    expect(r.status).toBe(200)
    expect(q.cardInstallments(HOY).length).toBe(0)

    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, category, account_id, commitment, created_at)
       VALUES ('p1', '2026-10-12', 'COMPRA EN RAPPIPAY', -5000000, 'delivery', NULL, 'tarjeta:rappi', 'x')`,
    ).run()
    expect(q.spendByCategory('2026-10-01', '2026-10-31').some((c) => c.category === 'delivery')).toBe(false)
    q.normalizarCategoriasDeCompromisos()
    expect(db.prepare(`SELECT category FROM transactions WHERE id = 'p1'`).get()).toEqual({ category: 'pago_tarjeta' })
  })
})
