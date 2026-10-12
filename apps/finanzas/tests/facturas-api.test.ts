/** Marcar pagada por API una factura que se pagó fuera de los extractos. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let dir: string
const CLAVE = 'f'.repeat(48)
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-factapi-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = CLAVE
  vi.resetModules()
})
afterEach(() => {
  delete process.env.SQLITE_PATH
  delete process.env.FINANZAS_API_TOKEN
  rmSync(dir, { recursive: true, force: true })
})

async function llamar(body: unknown, clave = CLAVE) {
  const { POST } = await import('@/app/api/facturas/route')
  const r = await POST(
    new Request('http://localhost/api/facturas', {
      method: 'POST',
      headers: { authorization: `Bearer ${clave}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: r.status, json: (await r.json()) as Record<string, unknown> }
}

describe('/api/facturas', () => {
  it('marca pagada con el importe del mes sin tocar los meses siguientes', async () => {
    const { getDb } = await import('@/db/client')
    const db = getDb()
    db.prepare(`INSERT INTO services (id, name, category, expected_amount_cents, due_day, created_at) VALUES ('ro', 'Empleada', 'hogar', 200000000, 1, 'x')`).run()
    for (const p of ['2026-10', '2026-11']) {
      db.prepare(
        `INSERT INTO bills (id, service_id, period, amount_cents, due_date, status, estimated, source, created_at)
         VALUES (?, 'ro', ?, 200000000, ?, 'pendiente', 1, 'auto', 'x')`,
      ).run(p, p, `${p}-01`)
    }
    const r = await llamar({ servicio: 'empleada', periodo: '2026-10', importeCents: 180000000 })
    expect(r.status).toBe(200)
    const filas = db.prepare(`SELECT period, amount_cents, status FROM bills ORDER BY period`).all()
    expect(filas).toEqual([
      { period: '2026-10', amount_cents: 180000000, status: 'pagado' },
      { period: '2026-11', amount_cents: 200000000, status: 'pendiente' },
    ])
    expect(db.prepare(`SELECT expected_amount_cents AS e FROM services`).get()).toEqual({ e: 200000000 })
  })

  it('rechaza sin clave y valida los datos', async () => {
    expect((await llamar({ servicio: 'x', periodo: '2026-10' }, 'otra'.repeat(12))).status).toBe(401)
    expect((await llamar({ servicio: 'x', periodo: 'octubre' })).status).toBe(400)
    expect((await llamar({ servicio: 'x', periodo: '2026-10', importeCents: -5 })).status).toBe(400)
    expect((await llamar({ servicio: 'nadie', periodo: '2026-10' })).status).toBe(404)
  })
})
