/**
 * El saldo de una cuenta se calcula, no se acumula.
 *
 * La forma vieja partía del saldo anterior y le sumaba cada importación. Eso
 * obliga a que todo entre una sola vez y en orden: basta reimportar un mes, o
 * cargar uno viejo después de uno nuevo, para que el número quede mal sin que
 * nada lo indique. Peor todavía cuando el banco deja de dar el saldo —
 * Bancolombia sólo lo entrega tres meses hacia atrás— y el acumulado se despega
 * para siempre.
 *
 * Ahora se guarda el último saldo confirmado con su fecha, y el de hoy sale de
 * sumarle lo posterior. Estos tests fijan lo que eso compra: que reimportar sea
 * inofensivo y que el orden deje de importar.
 */

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOY = '2026-09-17'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-ancla-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(dir, { recursive: true, force: true })
})

async function load() {
  const { getDb } = await import('@/db/client')
  const q = await import('@/lib/queries')
  return { db: getDb(), q }
}

function cuenta(db: Database.Database, anchorCents: number, anchorDate: string, balance = 0): void {
  db.prepare(
    `INSERT INTO accounts (id, name, kind, currency, balance_cents, anchor_cents, anchor_date, updated_at)
     VALUES ('a1', 'Bancolombia', 'caja_ahorro', 'COP', ?, ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(balance, anchorCents, anchorDate)
}

let n = 0
function movimiento(db: Database.Database, date: string, cents: number): void {
  db.prepare(
    `INSERT INTO transactions (id, date, description, amount_cents, currency, category, method,
       account_id, source, created_at)
     VALUES (?, ?, 'mov', ?, 'COP', 'otros', 'debito', 'a1', 'import', '2026-01-01T00:00:00Z')`,
  ).run(`t${n++}`, date, cents)
}

describe('el saldo sale del último punto firme', () => {
  it('suma al ancla sólo lo posterior a su fecha', async () => {
    const { db, q } = await load()
    // El banco dijo: al 30 de junio había 5.000.000.
    cuenta(db, 500000000, '2026-06-30')
    movimiento(db, '2026-06-15', -100000000) // anterior: ya está dentro del ancla
    movimiento(db, '2026-07-10', -50000000)
    movimiento(db, '2026-08-05', 20000000)

    expect(q.accountBalanceCents('a1', HOY)).toBe(470000000)
  })

  it('reimportar el mismo mes no mueve el número', async () => {
    const { db, q } = await load()
    cuenta(db, 500000000, '2026-06-30')
    movimiento(db, '2026-07-10', -50000000)
    const primera = q.accountBalanceCents('a1', HOY)

    // La deduplicación evita insertar de nuevo; lo que se prueba acá es que
    // aunque el saldo se recalcule, no se acumula una segunda vez.
    expect(q.accountBalanceCents('a1', HOY)).toBe(primera)
    expect(primera).toBe(450000000)
  })

  it('cargar un mes viejo después de uno nuevo da el mismo resultado', async () => {
    const { db, q } = await load()
    cuenta(db, 500000000, '2026-06-30')
    // Primero agosto, después julio: el orden en que se importan no cambia nada
    // porque no se va acumulando sobre el saldo anterior.
    movimiento(db, '2026-08-05', -30000000)
    movimiento(db, '2026-07-10', -20000000)

    expect(q.accountBalanceCents('a1', HOY)).toBe(450000000)
  })

  it('no cuenta movimientos futuros', async () => {
    const { db, q } = await load()
    cuenta(db, 500000000, '2026-06-30')
    movimiento(db, '2026-12-01', -100000000)

    // Una cuota programada para diciembre no descuenta del saldo de hoy.
    expect(q.accountBalanceCents('a1', HOY)).toBe(500000000)
  })

  it('los gastos de tarjeta no tocan el saldo de la cuenta', async () => {
    const { db, q } = await load()
    cuenta(db, 500000000, '2026-06-30')
    db.prepare(
      `INSERT INTO cards (id, name, issuer, closing_day, due_day, limit_cents, currency)
       VALUES ('c1', 'Tuya', '', 9, 5, 0, 'COP')`,
    ).run()
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, currency, category, method,
         account_id, card_id, source, created_at)
       VALUES ('tc', '2026-07-10', 'compra', -40000000, 'COP', 'otros', 'credito', 'a1', 'c1', 'import', '2026-01-01T00:00:00Z')`,
    ).run()

    // Se paga al vencer el resumen, no en el momento de la compra.
    expect(q.accountBalanceCents('a1', HOY)).toBe(500000000)
  })
})

describe('cuando todavía no hay un punto firme', () => {
  it('sin ancla cae en el saldo guardado, como antes', async () => {
    const { db, q } = await load()
    cuenta(db, 0, '', 123456789)
    movimiento(db, '2026-07-10', -50000000)

    expect(q.accountBalanceCents('a1', HOY)).toBe(123456789)
  })
})

describe('el total disponible', () => {
  it('suma el saldo calculado de cada cuenta de esa moneda', async () => {
    const { db, q } = await load()
    cuenta(db, 500000000, '2026-06-30')
    db.prepare(
      `INSERT INTO accounts (id, name, kind, currency, balance_cents, anchor_cents, anchor_date, updated_at)
       VALUES ('a2', 'Galicia', 'caja_ahorro', 'ARS', 0, 90000000, '2026-06-30', '2026-01-01T00:00:00Z')`,
    ).run()
    movimiento(db, '2026-07-10', -50000000)

    expect(q.totalCashCents('COP', HOY)).toBe(450000000)
    expect(q.totalCashCents('ARS', HOY)).toBe(90000000)
  })
})
