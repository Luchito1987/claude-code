/**
 * A una tarjeta se le paga más de una vez por mes, y todo eso es pago.
 *
 * La conciliación marcaba como pago de la tarjeta sólo el primer débito de
 * cada mes; los demás quedaban contados como gasto del día a día. Con la Tuya,
 * que en julio recibió $820.075 y $3.683.541 el mismo día, el mes figuraba
 * "pagado" con lo chico y lo grande aparecía como gasto. Y si el patrón de
 * pago se configuraba después de importar, nada se reparaba.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-concilia-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = 'c'.repeat(48)
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
  db.prepare(`INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES ('luc', 'Luciano', 'ahorro', 'COP', 0, 'x')`).run()
  db.prepare(`INSERT INTO cards (id, name, match_pattern) VALUES ('tuya', 'Tuya Exito', 'COMPANIA DE FINANCI'), ('visa', 'Visa', '')`).run()
  let n = 0
  const mov = (date: string, description: string, cents: number, commitment = '') => {
    const id = `t${++n}`
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, category, account_id, commitment, created_at)
       VALUES (?, ?, ?, ?, 'otros', 'luc', ?, 'x')`,
    ).run(id, date, description, cents, commitment)
    return id
  }
  const pagoDelMes = (card: string, period: string) =>
    (db.prepare(`SELECT amount_cents FROM month_payments WHERE kind = 'tarjeta' AND ref_id = ? AND period = ?`).get(card, period) as
      | { amount_cents: number }
      | undefined)?.amount_cents
  return { db, q, mov, pagoDelMes }
}

describe('conciliar pagos de tarjeta con lo ya cargado', () => {
  it('dos pagos el mismo mes: los dos son pago de la tarjeta y el mes suma ambos', async () => {
    const { db, q, mov, pagoDelMes } = await preparar()
    const chico = mov('2026-08-04', 'TRANSF A COMPANIA DE FINANCI', -10_445_600)
    const grande = mov('2026-08-04', 'TRANSF A COMPANIA DE FINANCI', -359_679_300)
    const r = q.reconcileCardPayments()
    expect(r).toEqual([{ card: 'Tuya Exito', period: '2026-08', cents: 370_124_900, nuevos: 2 }])
    expect(pagoDelMes('tuya', '2026-08')).toBe(370_124_900)
    for (const id of [chico, grande]) {
      expect(db.prepare('SELECT commitment, category FROM transactions WHERE id = ?').get(id)).toEqual({
        commitment: 'tarjeta:tuya',
        category: 'pago_tarjeta',
      })
    }
  })

  it('cada mes financiero se marca con lo suyo', async () => {
    const { q, mov, pagoDelMes } = await preparar()
    mov('2026-09-10', 'PAGO PSE Compania de Financi', -375_503_200)
    mov('2026-09-30', 'TRANSF A COMPANIA DE FINANCI', -248_902_700) // después del 27: ya es octubre
    q.reconcileCardPayments()
    expect(pagoDelMes('tuya', '2026-09')).toBe(375_503_200)
    expect(pagoDelMes('tuya', '2026-10')).toBe(248_902_700)
  })

  it('correrlo de nuevo no enlaza nada ni infla el mes', async () => {
    const { q, mov, pagoDelMes } = await preparar()
    mov('2026-09-10', 'PAGO PSE Compania de Financi', -375_503_200)
    q.reconcileCardPayments()
    expect(q.reconcileCardPayments()).toEqual([])
    expect(pagoDelMes('tuya', '2026-09')).toBe(375_503_200)
  })

  it('un pago que llega después se suma al mes ya marcado', async () => {
    const { q, mov, pagoDelMes } = await preparar()
    mov('2026-07-01', 'TRANSF A COMPANIA DE FINANCI', -82_007_500)
    q.reconcileCardPayments()
    mov('2026-07-06', 'TRANSF A COMPANIA DE FINANCI', -17_770_000)
    q.reconcileCardPayments()
    expect(pagoDelMes('tuya', '2026-07')).toBe(99_777_500)
  })

  it('no toca lo ya enlazado a otra cosa, ni la plata que entra', async () => {
    const { db, q, mov } = await preparar()
    const interna = mov('2026-09-10', 'TRANSF A COMPANIA DE FINANCI', -1_000_000, 'interna:x')
    const reintegro = mov('2026-09-11', 'REINTEGRO COMPANIA DE FINANCI', 500_000)
    expect(q.reconcileCardPayments()).toEqual([])
    expect((db.prepare('SELECT commitment FROM transactions WHERE id = ?').get(interna) as { commitment: string }).commitment).toBe('interna:x')
    expect((db.prepare('SELECT commitment FROM transactions WHERE id = ?').get(reintegro) as { commitment: string }).commitment).toBe('')
  })

  it('una tarjeta sin patrón no se lleva nada', async () => {
    const { q, mov } = await preparar()
    mov('2026-09-10', 'PAGO SUC VIRT TC VISA', -250_440_100)
    expect(q.reconcileCardPayments()).toEqual([])
  })
})

describe('la API', () => {
  const pedido = (url: string, body: unknown, clave = 'c'.repeat(48)) =>
    new Request(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { authorization: `Bearer ${clave}` } })

  it('carga el patrón de pago y concilia', async () => {
    const { mov } = await preparar()
    mov('2026-09-10', 'PAGO SUC VIRT TC VISA', -250_440_100)
    const { POST: patron } = await import('@/app/api/tarjetas/route')
    const { POST: conciliar } = await import('@/app/api/conciliar/route')
    expect((await patron(pedido('/api/tarjetas', { tarjeta: 'Visa', patronPago: 'PAGO SUC VIRT TC VISA' }))).status).toBe(200)
    const { conciliados } = await (await conciliar(pedido('/api/conciliar', {}))).json()
    expect(conciliados).toEqual([{ card: 'Visa', period: '2026-09', cents: 250_440_100, nuevos: 1 }])
  })

  it('sin clave no cambia nada', async () => {
    await preparar()
    const { POST } = await import('@/app/api/tarjetas/route')
    expect((await POST(pedido('/api/tarjetas', { tarjeta: 'Visa', patronPago: 'X X X X' }, 'mala'.repeat(12)))).status).toBe(401)
  })

  it('rechaza un patrón demasiado corto, que agarraría cualquier cosa', async () => {
    await preparar()
    const { POST } = await import('@/app/api/tarjetas/route')
    expect((await POST(pedido('/api/tarjetas', { tarjeta: 'Visa', patronPago: 'PA' }))).status).toBe(400)
  })
})
