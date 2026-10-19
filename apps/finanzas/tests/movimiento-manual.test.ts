/** Cargar y borrar a mano un movimiento de cuenta por API. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const CLAVE = 'm'.repeat(48)
let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-mov-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = CLAVE
  vi.resetModules()
})
afterEach(() => {
  delete process.env.SQLITE_PATH
  delete process.env.FINANZAS_API_TOKEN
  rmSync(dir, { recursive: true, force: true })
})

const h = { authorization: `Bearer ${CLAVE}`, 'content-type': 'application/json' }

describe('/api/movimientos manual', () => {
  it('baja el saldo anclado y se puede borrar', async () => {
    const { getDb } = await import('@/db/client')
    const q = await import('@/lib/queries')
    const db = getDb()
    db.prepare(
      `INSERT INTO accounts (id, name, kind, balance_cents, anchor_cents, anchor_date, updated_at) VALUES ('emp', 'Empresa', 'banco', 0, 700000000, '2026-10-01', 'x')`,
    ).run()
    const { POST, DELETE } = await import('@/app/api/movimientos/route')
    const r = await POST(
      new Request('http://x/api/movimientos', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ cuenta: 'empresa', fecha: '2026-10-13', descripcion: 'Pago Tuya', importeCents: -366498800, categoria: 'pago_tarjeta', compromiso: 'tarjeta:tuya' }),
      }),
    )
    const { id } = (await r.json()) as { id: string }
    expect(q.accountBalanceCents('emp', '2026-10-13')).toBe(333501200)
    expect(db.prepare('SELECT commitment FROM transactions WHERE id = ?').get(id)).toEqual({ commitment: 'tarjeta:tuya' })

    const d = await DELETE(new Request(`http://x/api/movimientos?id=${id}`, { method: 'DELETE', headers: h }))
    expect(d.status).toBe(200)
    expect(q.accountBalanceCents('emp', '2026-10-13')).toBe(700000000)
  })

  it('valida y no borra importados', async () => {
    const { POST, DELETE } = await import('@/app/api/movimientos/route')
    const mal = await POST(new Request('http://x/api/movimientos', { method: 'POST', headers: h, body: JSON.stringify({ cuenta: 'x', fecha: 'hoy' }) }))
    expect(mal.status).toBe(400)
    const { getDb } = await import('@/db/client')
    getDb().prepare(`INSERT INTO transactions (id, date, description, amount_cents, source, created_at) VALUES ('imp', '2026-10-01', 'x', -1, 'import', 'x')`).run()
    expect((await DELETE(new Request('http://x/api/movimientos?id=imp', { method: 'DELETE', headers: h }))).status).toBe(404)
  })
})

describe('billetera y pagos de tarjeta a mano', () => {
  it('crea la cuenta anclada y el pago suma a lo pagado a la tarjeta en su mes', async () => {
    const { getDb } = await import('@/db/client')
    const q = await import('@/lib/queries')
    const db = getDb()
    db.prepare(`INSERT INTO cards (id, name) VALUES ('tuya', 'Tuya')`).run()
    const cuentas = await import('@/app/api/cuentas/route')
    const c = await cuentas.POST(
      new Request('http://x/api/cuentas', { method: 'POST', headers: h, body: JSON.stringify({ nombre: 'RappiCuenta', saldoCents: 69790182, fecha: '2026-10-19' }) }),
    )
    expect(c.status).toBe(200)
    const { POST, DELETE } = await import('@/app/api/movimientos/route')
    const r = await POST(
      new Request('http://x/api/movimientos', {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ cuenta: 'RappiCuenta', fecha: '2026-10-19', descripcion: 'Pago Tuya', importeCents: -816256300, categoria: 'pago_tarjeta', compromiso: 'tarjeta:tuya' }),
      }),
    )
    const { id } = (await r.json()) as { id: string }
    const pagado = () => db.prepare(`SELECT amount_cents AS c FROM month_payments WHERE ref_id = 'tuya' AND period = '2026-10'`).get()
    expect(pagado()).toEqual({ c: 816256300 })
    const acc = db.prepare(`SELECT id FROM accounts WHERE name = 'RappiCuenta'`).get() as { id: string }
    expect(q.accountBalanceCents(acc.id, '2026-10-19')).toBe(69790182)

    await DELETE(new Request(`http://x/api/movimientos?id=${id}`, { method: 'DELETE', headers: h }))
    expect(pagado()).toBeUndefined()
  })
})
