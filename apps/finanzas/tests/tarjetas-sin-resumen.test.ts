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
    const m = await POST(new Request('http://x/api/prestamos', { method: 'POST', headers: h, body: JSON.stringify({ prestamo: 'carro', pagado: { periodo: '2026-11' } }) }))
    expect(m.status).toBe(200)
    expect(db.prepare(`SELECT amount_cents FROM month_payments WHERE kind = 'prestamo' AND period = '2026-11'`).get()).toEqual({ amount_cents: 90000000 })
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

describe('lo pagado de verdad a una tarjeta', () => {
  it('el ítem lleva lo pagado en el mes aunque supere al resumen', async () => {
    const { q, db } = await load()
    db.prepare(`INSERT INTO statements (id, kind, card_id, due_date, minimum_cents, imported_at) VALUES ('st', 'card', 'nueva', '2026-10-05', 100000, 'x')`).run()
    db.prepare(`INSERT INTO transactions (id, date, description, amount_cents, card_id, statement_id, created_at) VALUES ('t', '2026-09-20', 'x', -100000, 'nueva', 'st', 'x')`).run()
    db.prepare(`INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at) VALUES ('mp', 'tarjeta', 'nueva', '2026-10', 900000, 'x')`).run()
    const item = q.monthItems('2026-10', HOY).find((i) => i.refId === 'nueva')!
    expect([item.cents, item.paid, item.paidCents]).toEqual([100000, true, 900000])
    expect(q.pagadoDe(item)).toBe(900000)
  })
})

describe('tarjeta saldada', () => {
  it('con pago 0 el mes figura sin deuda y los siguientes no estiman', async () => {
    const { q, db } = await load()
    db.prepare(`INSERT INTO statements (id, kind, card_id, due_date, minimum_cents, imported_at) VALUES ('st', 'card', 'nueva', '2026-11-04', 366498800, 'x')`).run()
    db.prepare(`INSERT INTO transactions (id, date, description, amount_cents, card_id, statement_id, created_at) VALUES ('t', '2026-10-01', 'x', -100000, 'nueva', 'st', 'x')`).run()
    db.prepare(`INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at) VALUES ('m1', 'tarjeta', 'nueva', '2026-11', 0, 'x'), ('m2', 'tarjeta', 'rappi', '2026-11', 0, 'x')`).run()
    const nov = q.monthItems('2026-11', HOY)
    const tuya = nov.find((i) => i.refId === 'nueva')!
    expect([tuya.cents, tuya.paid]).toEqual([0, true])
    expect(nov.find((i) => i.refId === 'rappi')?.cents).toBe(0)
    const dic = q.monthItems('2026-12', HOY)
    expect(dic.some((i) => i.refId === 'rappi' || i.refId === 'nueva')).toBe(false)
  })
})

describe('cuotas de préstamo pagadas mes a mes', () => {
  it('la cuota pagada en octubre no reaparece vencida en noviembre', async () => {
    const { q, db } = await load()
    db.prepare(
      `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
       installments_paid, first_due_date, rate_annual, active, created_at)
       VALUES ('bc', 'Crédito Bancolombia', '', 0, 174807400, 60, 49, '2022-09-04', 0, 1, 'x')`,
    ).run()
    // Pagos de meses que el contador ya incluye: no se cuentan dos veces.
    db.prepare(`INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at) VALUES ('s', 'prestamo', 'bc', '2026-09', 174807400, 'x')`).run()
    db.prepare(`INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at) VALUES ('o', 'prestamo', 'bc', '2026-10', 174807400, 'x')`).run()
    const nov = q.monthItems('2026-11', '2026-10-29').filter((i) => i.kind === 'prestamo')
    expect(nov.map((i) => [i.label, i.dueDate, i.paid])).toEqual([['Crédito Bancolombia · cuota 51/60', '2026-11-04', false]])
    const oct = q.monthItems('2026-10', '2026-10-29').filter((i) => i.kind === 'prestamo')
    expect(oct.map((i) => [i.label, i.paid])).toEqual([['Crédito Bancolombia · cuota 50/60', true]])
  })
})

describe('proyección mensual con tarjetas sin resumen', () => {
  it('suma la Visa y la Rappi con su último pago, y no las saldadas', async () => {
    const { q } = await load()
    const meses = q.monthlyProjection(2, '2026-10-29')
    const tarjetas = meses[0].detalle.tarjetas.map((t) => [t.label, t.cents])
    expect(tarjetas).toEqual([
      ['Rappi (estimado con el último pago)', 80000000],
      ['Visa (estimado con el último pago)', 120000000],
    ])
  })
})
