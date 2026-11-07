/**
 * Presupuesto de gasto variable: reemplaza al promedio de 90 días en las
 * proyecciones y lleva la cuenta de lo que queda.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const HOY = '2026-11-07'
const TOKEN = 'p'.repeat(48)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-pres-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = TOKEN
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
  db.prepare(
    `INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES ('a', 'Cuenta', 'ahorro', 'COP', 0, 'x')`,
  ).run()
  db.prepare(`INSERT INTO cards (id, name, due_day) VALUES ('fal', 'Falabella', 10)`).run()
  const tx = db.prepare(
    `INSERT INTO transactions (id, date, description, amount_cents, currency, category, account_id, card_id, source, commitment, created_at)
     VALUES (?, ?, ?, ?, 'COP', ?, ?, ?, ?, '', 'x')`,
  )
  // 100.000 por día en el historial (10 días).
  for (let d = 1; d <= 10; d++) tx.run(`h${d}`, `2026-10-${String(d + 10).padStart(2, '0')}`, 'Rappi', -10000000, 'delivery', 'a', null, 'banco')
  // Antes del presupuesto, dentro del mes: 50.000.
  tx.run('m1', '2026-11-02', 'Exito', -5000000, 'supermercado', 'a', null, 'banco')
  // Dentro del presupuesto: 40.000.
  tx.run('m2', '2026-11-07', 'Exito', -4000000, 'supermercado', 'a', null, 'banco')
  // Compra provisoria con tarjeta: no es ritmo de gasto ni sale del presupuesto.
  tx.run('prov', '2026-11-05', 'Compras Falabella', -300000000, 'otros', null, 'fal', 'manual')
  return { q }
}

const h = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

describe('presupuesto de gasto variable', () => {
  it('lleva lo gastado y lo que queda por día', async () => {
    const { q } = await load()
    const { POST, GET } = await import('@/app/api/presupuesto/route')
    const r = await POST(
      new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify({ moneda: 'COP', montoCents: 134000000, desde: HOY, hasta: '2026-12-03' }) }),
    )
    expect(r.status).toBe(200)
    const e = q.estadoPresupuesto('COP', HOY)!
    expect([e.gastadoCents, e.restanteCents, e.diasRestantes]).toEqual([4000000, 130000000, 27])
    expect(e.porDiaCents).toBe(Math.floor(130000000 / 27))
    const g = (await (await GET(new Request('http://x?moneda=COP', { headers: h }))).json()) as { restanteCents: number }
    expect(g.restanteCents).toBe(130000000)
    const mal = await POST(new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify({ moneda: 'COP', montoCents: 1, desde: '2026-12-01', hasta: '2026-11-01' }) }))
    expect(mal.status).toBe(400)
  })

  it('reemplaza al promedio en la proyección mensual y se borra', async () => {
    const { q } = await load()
    const burn = q.currentBurnCents(HOY, 'COP')
    // La compra provisoria de la Falabella no infla el promedio.
    expect(burn).toBeLessThan(10000000)
    const sinPresupuesto = q.monthlyProjection(2, HOY, 'COP')
    expect(sinPresupuesto[0].variableCents).toBe(burn * 31)

    q.guardarPresupuesto('COP', { montoCents: 134000000, desde: HOY, hasta: '2026-12-03' })
    const e = q.estadoPresupuesto('COP', HOY)!
    const [nov, dic] = q.monthlyProjection(2, HOY, 'COP')
    // Nov (28/10–27/11): lo gastado antes de hoy + 21 días de presupuesto.
    expect(nov.variableCents).toBe(5000000 + e.porDiaCents * 21)
    // Dic (28/11–27/12): 6 días de presupuesto + 24 al promedio.
    expect(dic.variableCents).toBe(e.porDiaCents * 6 + burn * 24)

    q.guardarPresupuesto('COP', null)
    expect(q.estadoPresupuesto('COP', HOY)).toBeNull()
  })
})
