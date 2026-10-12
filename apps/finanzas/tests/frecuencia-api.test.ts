/**
 * Corregir la frecuencia de un servicio arregla también el mes en curso.
 *
 * Las facturas del mes se generan solas al mirar el tablero. Los dos conceptos
 * de la DIAN estaban como mensuales, así que en octubre ya había facturas de
 * renta e impuesto que no se pagan. Cambiar la frecuencia evitaba las de los
 * meses siguientes pero dejaba las ya creadas.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-frecapi-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = 'z'.repeat(48)
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
  db.prepare(`INSERT INTO services (id, name, category, expected_amount_cents, due_day, created_at) VALUES ('imp', 'Impuesto', 'impuestos', 75000000, 10, 'x')`).run()
  const factura = (id: string, period: string, status = 'pendiente', source = 'auto') =>
    db.prepare(
      `INSERT INTO bills (id, service_id, period, amount_cents, due_date, status, estimated, source, created_at)
       VALUES (?, 'imp', ?, 75000000, ?, ?, 1, ?, 'x')`,
    ).run(id, period, `${period}-10`, status, source)
  const periodos = () => (db.prepare(`SELECT period FROM bills ORDER BY period`).all() as Array<{ period: string }>).map((b) => b.period)
  return { db, q, factura, periodos }
}

describe('cambiar la frecuencia de un servicio', () => {
  it('cada 2 meses desde septiembre: se va octubre, queda noviembre', async () => {
    const { db, q, factura, periodos } = await preparar()
    factura('sep', '2026-09', 'pagado')
    factura('oct', '2026-10')
    factura('nov', '2026-11')
    db.prepare(`UPDATE services SET frequency = 'bimestral', anchor_month = 9 WHERE id = 'imp'`).run()
    expect(q.dropBillsOutsideFrequency('imp', '2026-10')).toEqual(['2026-10'])
    expect(periodos()).toEqual(['2026-09', '2026-11'])
  })

  it('no borra una factura pagada ni una con importe confirmado a mano', async () => {
    const { db, q, factura, periodos } = await preparar()
    factura('oct', '2026-10', 'pagado')
    factura('dic', '2026-12', 'pendiente', 'manual')
    db.prepare(`UPDATE services SET frequency = 'anual', anchor_month = 9 WHERE id = 'imp'`).run()
    expect(q.dropBillsOutsideFrequency('imp', '2026-10')).toEqual([])
    expect(periodos()).toEqual(['2026-10', '2026-12'])
  })

  it('no toca meses anteriores al indicado', async () => {
    const { db, q, factura, periodos } = await preparar()
    factura('ago', '2026-08')
    db.prepare(`UPDATE services SET frequency = 'anual', anchor_month = 9 WHERE id = 'imp'`).run()
    q.dropBillsOutsideFrequency('imp', '2026-10')
    expect(periodos()).toEqual(['2026-08'])
  })

  it('por la API, con la respuesta en castellano', async () => {
    const { factura, periodos } = await preparar()
    factura('oct', '2026-10')
    vi.setSystemTime(new Date('2026-10-12T15:00:00Z'))
    const { POST } = await import('@/app/api/servicios/route')
    const r = await POST(
      new Request('http://localhost/api/servicios', {
        method: 'POST',
        body: JSON.stringify({ servicio: 'impuesto', frecuencia: 'bimestral', mesAncla: 9 }),
        headers: { authorization: `Bearer ${'z'.repeat(48)}` },
      }),
    )
    vi.useRealTimers()
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toMatch(/cada 2 meses, desde septiembre.*2026-10/)
    expect(periodos()).toEqual([])
  })
})
