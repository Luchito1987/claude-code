/**
 * El número de contrato de cada servicio, a mano en el tablero.
 *
 * Para consultar o pagar la luz, el agua o el gas en la página de cada
 * empresa hace falta el número de contrato, y no estaba en ningún lado de la
 * app. Ahora vive en el servicio y viaja con cada factura hasta el tablero.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-contrato-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = 'k'.repeat(48)
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
  for (const [id, nombre, contrato] of [['luz', 'luz', '7979089'], ['agua', 'Agua', ''], ['rosa', 'Rosa', '']]) {
    db.prepare(
      `INSERT INTO services (id, name, category, expected_amount_cents, due_day, contract_number, created_at)
       VALUES (?, ?, 'servicios', 100000, 10, ?, 'x')`,
    ).run(id, nombre, contrato)
    db.prepare(
      `INSERT INTO bills (id, service_id, period, amount_cents, due_date, status, estimated, source, created_at)
       VALUES (?, ?, '2026-10', 100000, '2026-10-10', 'pendiente', 1, 'auto', 'x')`,
    ).run(`b-${id}`, id)
  }
  return { db, q }
}

describe('número de contrato', () => {
  it('cada factura del tablero lleva el contrato de su servicio, si lo tiene', async () => {
    const { q } = await preparar()
    const facturas = q.monthItems('2026-10', '2026-10-12').filter((i) => i.kind === 'factura')
    expect(Object.fromEntries(facturas.map((f) => [f.label, f.contract]))).toEqual({
      luz: '7979089',
      Agua: undefined,
      Rosa: undefined,
    })
  })

  it('se carga por la API sin tocar el patrón de pago', async () => {
    const { db } = await preparar()
    const { POST } = await import('@/app/api/servicios/route')
    const r = await POST(
      new Request('http://localhost/api/servicios', {
        method: 'POST',
        body: JSON.stringify({ servicio: 'agua', numeroContrato: '988138' }),
        headers: { authorization: `Bearer ${'k'.repeat(48)}` },
      }),
    )
    expect(r.status).toBe(200)
    expect(db.prepare(`SELECT contract_number, match_pattern FROM services WHERE id = 'agua'`).get()).toEqual({
      contract_number: '988138',
      match_pattern: '',
    })
  })
})
