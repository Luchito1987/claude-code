/**
 * Un resumen por tarjeta y por ciclo.
 *
 * El caso real que motivó esto: el mismo resumen de agosto entró dos veces, en
 * texto y en PDF. No se vio ningún duplicado en la lista de movimientos —las
 * descripciones que escribe cada parser difieren, así que las huellas no
 * chocan— pero cada plan de cuotas quedó contado dos veces y la deuda
 * proyectada apareció inflada en más de dos millones.
 */

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-guard-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
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

function tarjeta(db: Database.Database, id = 'c1'): void {
  db.prepare(
    "INSERT INTO cards (id, name, issuer, closing_day, due_day, limit_cents, currency) VALUES (?, 'Tuya Éxito', 'Tuya', 9, 3, 0, 'COP')",
  ).run(id)
}

function resumen(db: Database.Database, id: string, cardId: string, period: string, fileName: string, filas = 3): void {
  db.prepare(
    `INSERT INTO statements (id, kind, card_id, file_name, period, due_date, total_cents, rows_count, imported_at)
     VALUES (?, 'card', ?, ?, ?, '2026-09-03', -100000, ?, '2026-08-15T10:00:00.000Z')`,
  ).run(id, cardId, fileName, period, filas)
  for (let i = 0; i < filas; i++) {
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, category, method, card_id, statement_id,
         installment, billing_period, created_at)
       VALUES (?, '2026-08-01', ?, -50000, 'supermercado', 'credito', ?, ?, '2/6', ?, '2026-08-15T10:00:00.000Z')`,
    ).run(`${id}-t${i}`, `COMPRA ${i}`, cardId, id, period)
  }
}

describe('encontrar el resumen del mismo ciclo', () => {
  it('lo encuentra por tarjeta y período', async () => {
    const { q, db } = await load()
    tarjeta(db)
    resumen(db, 's1', 'c1', '2026-09', 'tuya-ago2026.txt')

    const previo = q.cardStatementFor('c1', '2026-09')
    expect(previo?.fileName).toBe('tuya-ago2026.txt')
    expect(previo?.rows).toBe(3)
  })

  it('otro ciclo de la misma tarjeta no es conflicto', async () => {
    const { q, db } = await load()
    tarjeta(db)
    resumen(db, 's1', 'c1', '2026-09', 'tuya-ago2026.txt')

    expect(q.cardStatementFor('c1', '2026-10')).toBeUndefined()
  })

  it('el mismo ciclo de otra tarjeta tampoco', async () => {
    const { q, db } = await load()
    tarjeta(db, 'c1')
    tarjeta(db, 'c2')
    resumen(db, 's1', 'c1', '2026-09', 'tuya-ago2026.txt')

    expect(q.cardStatementFor('c2', '2026-09')).toBeUndefined()
  })

  it('un extracto de cuenta no cuenta como resumen de tarjeta', async () => {
    const { q, db } = await load()
    tarjeta(db)
    db.prepare(
      `INSERT INTO statements (id, kind, account_id, file_name, period, total_cents, rows_count, imported_at)
       VALUES ('s9', 'account', NULL, 'banco.csv', '2026-09', 0, 5, '2026-08-15T10:00:00.000Z')`,
    ).run()

    expect(q.cardStatementFor('c1', '2026-09')).toBeUndefined()
  })
})

describe('reemplazar el resumen anterior', () => {
  it('borrarlo se lleva sus movimientos, así las cuotas no se cuentan dos veces', async () => {
    const { q, db } = await load()
    tarjeta(db)
    resumen(db, 's1', 'c1', '2026-09', 'tuya-ago2026.txt')

    const antes = db.prepare("SELECT COUNT(*) n FROM transactions WHERE installment <> ''").get() as { n: number }
    expect(antes.n).toBe(3)

    q.deleteStatement('s1')

    const despues = db.prepare("SELECT COUNT(*) n FROM transactions WHERE installment <> ''").get() as { n: number }
    expect(despues.n).toBe(0)
    expect(q.cardStatementFor('c1', '2026-09')).toBeUndefined()
  })

  it('borrar un resumen no toca los movimientos cargados a mano', async () => {
    const { q, db } = await load()
    tarjeta(db)
    resumen(db, 's1', 'c1', '2026-09', 'tuya-ago2026.txt')
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, category, method, card_id, source, created_at)
       VALUES ('manual1', '2026-08-02', 'A MANO', -12345, 'otros', 'credito', 'c1', 'manual', '2026-08-15T10:00:00.000Z')`,
    ).run()

    q.deleteStatement('s1')

    const queda = db.prepare("SELECT id FROM transactions").all() as Array<{ id: string }>
    expect(queda).toHaveLength(1)
    expect(queda[0].id).toBe('manual1')
  })
})
