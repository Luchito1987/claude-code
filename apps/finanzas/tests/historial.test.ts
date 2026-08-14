/**
 * El historial de meses cerrados. Lo delicado no es sumar: es que consultar un
 * mes viejo no lo modifique ni lo mida contra la caja de hoy.
 */

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOY = '2026-08-10'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-hist-'))
  path = join(dir, 'test.db')
  process.env.SQLITE_PATH = path
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(dir, { recursive: true, force: true })
})

async function load() {
  const q = await import('@/lib/queries')
  const { getDb } = await import('@/db/client')
  return { q, db: getDb() }
}

function movimiento(db: Database.Database, date: string, cents: number, category = 'supermercado'): void {
  db.prepare(
    `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
       source, fingerprint, created_at)
     VALUES (?, ?, ?, '', ?, 'ARS', ?, 'debito', 'import', ?, '2026-01-01T00:00:00Z')`,
  ).run(`t-${date}-${cents}`, date, `mov ${date}`, cents, category, `fp-${date}-${cents}`)
}

describe('meses con movimientos', () => {
  it('los enumera del más nuevo al más viejo, sin saltearse los vacíos del medio', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-05-10', -100000)
    movimiento(db, '2026-08-10', -200000)

    // Mayo, junio, julio y agosto: julio no tiene movimientos y aparece igual.
    expect(q.monthsWithActivity()).toEqual(['2026-08', '2026-07', '2026-06', '2026-05'])
  })

  it('sin movimientos no hay historial', async () => {
    const { q } = await load()
    expect(q.monthsWithActivity()).toEqual([])
  })

  it('el día 28 ya cuenta para el mes siguiente', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-07-28', -100000)
    expect(q.monthsWithActivity()).toEqual(['2026-08'])
  })
})

describe('plata que se movió en el mes', () => {
  it('separa lo que entró de lo que salió', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-08-05', -150000)
    movimiento(db, '2026-08-06', -50000)
    movimiento(db, '2026-08-07', 300000, 'ingresos')

    expect(q.monthCashFlow('2026-08')).toEqual({ inCents: 300000, outCents: 200000 })
  })

  it('no cuenta los consumos con tarjeta: esos salen al pagar el resumen', async () => {
    const { q, db } = await load()
    db.prepare(`INSERT INTO cards (id, name) VALUES ('c1', 'Visa')`).run()
    movimiento(db, '2026-08-05', -150000)
    db.prepare(
      `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
         card_id, source, fingerprint, created_at)
       VALUES ('t-card', '2026-08-06', 'compra', '', -900000, 'ARS', 'supermercado', 'credito',
               'c1', 'import', 'fp-card', '2026-01-01T00:00:00Z')`,
    ).run()

    expect(q.monthCashFlow('2026-08').outCents).toBe(150000)
  })
})

describe('consultar un mes cerrado', () => {
  /*
   * La razón de que `monthHistory` exista aparte de `monthSummary`: el resumen
   * del mes en curso genera las facturas del período si faltan. Sobre un mes
   * viejo eso inventaría compromisos que nunca existieron.
   */
  it('no genera facturas del mes que se consulta', async () => {
    const { q, db } = await load()
    db.prepare(
      `INSERT INTO services (id, name, provider, category, expected_amount_cents, due_day, active, autodebit, notes, created_at)
       VALUES ('s1', 'Luz', '', 'servicios', 4200000, 9, 1, 0, '', '2026-01-01T00:00:00Z')`,
    ).run()
    movimiento(db, '2026-03-10', -100000)

    q.monthHistory('2026-03', HOY)

    const facturas = db.prepare('SELECT COUNT(*) AS n FROM bills').get() as { n: number }
    expect(facturas.n).toBe(0)
  })

  /*
   * Histórico es haber cerrado, no ser dudoso. El mes en el que cae hoy sigue
   * sumando movimientos hasta el 27, así que no puede mostrarse como cerrado
   * aunque ya tenga casi todo pago.
   */
  it('el mes en el que cae hoy está en curso, no es histórico', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-08-05', -100000)

    const agosto = q.monthHistory('2026-08', HOY)
    expect(agosto.current).toBe(true)
    expect(agosto.historical).toBe(false)
  })

  it('pasado el 27 el mes ya cerró y pasa a histórico', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-08-05', -100000)

    // El 28 arranca septiembre: recién ahí agosto queda cerrado.
    expect(q.monthHistory('2026-08', '2026-08-27').current).toBe(true)
    expect(q.monthHistory('2026-08', '2026-08-28').historical).toBe(true)
    expect(q.monthHistory('2026-08', '2026-08-28').current).toBe(false)
  })

  it('un mes ya cerrado es histórico y uno futuro no', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-07-10', -100000)

    expect(q.monthHistory('2026-07', HOY).historical).toBe(true)
    expect(q.monthHistory('2026-09', HOY).historical).toBe(false)
    expect(q.monthHistory('2026-09', HOY).current).toBe(false)
  })

  it('la carga doble es independiente de que el mes haya cerrado', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-07-10', -100000)
    q.setSetting('baseline_period', '2026-08')

    // Julio cerró y además arrastra carga doble.
    expect(q.monthHistory('2026-07', HOY)).toMatchObject({ historical: true, preBaseline: true })
    // Agosto es el mes 0: en curso y ya con datos limpios.
    expect(q.monthHistory('2026-08', HOY)).toMatchObject({ current: true, preBaseline: false })
  })

  it('sin mes 0 definido, ningún mes arrastra carga doble', async () => {
    const { q, db } = await load()
    movimiento(db, '2024-01-10', -100000)
    expect(q.monthHistory('2024-01', HOY).preBaseline).toBe(false)
    // Pero sigue siendo histórico: cerró hace rato.
    expect(q.monthHistory('2024-01', HOY).historical).toBe(true)
  })

  it('trae el gasto variable del mes consultado, no el del mes en curso', async () => {
    const { q, db } = await load()
    movimiento(db, '2026-06-10', -700000)
    movimiento(db, '2026-08-10', -250000)

    const junio = q.monthHistory('2026-06', HOY)
    expect(junio.variableCents).toBe(700000)
    expect(junio.netCents).toBe(-700000)
  })
})
