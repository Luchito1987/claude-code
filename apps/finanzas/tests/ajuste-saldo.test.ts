/**
 * Corregir el saldo de una cuenta contra el banco.
 *
 * El saldo que la app muestra es una cuenta acumulada: parte del que se cargó
 * al crear la cuenta y le suma cada movimiento importado. Cuando el extracto no
 * trae columna de saldo, ese número se despega del real — y un saldo negativo
 * en una caja de ahorro es la señal de que eso pasó.
 *
 * Lo que se prueba acá es que corregirlo deje rastro. Un saldo que cambia sin
 * que nada lo explique convierte el historial en algo que no se puede auditar,
 * y el historial es justamente lo que después se mira para entender la plata.
 */

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NON_VARIABLE_CATEGORIES } from '@/lib/categories'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-ajuste-'))
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

function cuenta(db: Database.Database, saldo: number): void {
  db.prepare(
    `INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at)
     VALUES ('a1', 'Bancolombia', 'caja_ahorro', 'COP', ?, '2026-01-01T00:00:00Z')`,
  ).run(saldo)
}

/** Lo mismo que hace la acción al guardar una cuenta con otro saldo. */
function ajustar(db: Database.Database, saldoReal: number): void {
  const actual = (db.prepare("SELECT balance_cents FROM accounts WHERE id = 'a1'").get() as {
    balance_cents: number
  }).balance_cents
  const diferencia = saldoReal - actual
  if (diferencia) {
    db.prepare(
      `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category,
         method, account_id, source, created_at)
       VALUES ('ajuste1', '2026-09-17', 'Ajuste de saldo', 'Ajuste', ?, 'COP', 'ajuste',
         'transferencia', 'a1', 'manual', '2026-09-17T00:00:00Z')`,
    ).run(diferencia)
  }
  db.prepare("UPDATE accounts SET balance_cents = ? WHERE id = 'a1'").run(saldoReal)
}

describe('la categoría del ajuste', () => {
  it('no cuenta como gasto variable', () => {
    // Si contara, corregir un saldo hacia abajo aparecería como un gasto enorme
    // del mes, y hacia arriba como un ingreso que nadie recibió.
    expect(NON_VARIABLE_CATEGORIES).toContain('ajuste')
  })
})

describe('corregir un saldo contra el banco', () => {
  it('deja el saldo en lo que dice el banco', async () => {
    const { db, q } = await load()
    cuenta(db, -126598300) // el negativo que delata que faltan movimientos
    ajustar(db, 450000000)

    expect(q.totalCashCents('COP')).toBe(450000000)
  })

  it('anota la diferencia como un movimiento, no la corrige en silencio', async () => {
    const { db } = await load()
    cuenta(db, -126598300)
    ajustar(db, 450000000)

    const fila = db.prepare("SELECT * FROM transactions WHERE category = 'ajuste'").get() as {
      amount_cents: number
      account_id: string
    }
    expect(fila.amount_cents).toBe(576598300)
    expect(fila.account_id).toBe('a1')
  })

  it('el ajuste no se cuenta como gasto del mes', async () => {
    const { db, q } = await load()
    cuenta(db, 100000000)
    // Corregir hacia abajo: sin excluirlo, esto se leería como haber gastado
    // novecientos mil pesos en un día.
    ajustar(db, 10000000)

    const variables = q.variableSpend('2026-09', 'COP')
    expect(variables.some((v) => v.category === 'ajuste')).toBe(false)
  })

  it('un saldo que ya coincide no genera ningún movimiento', async () => {
    const { db } = await load()
    cuenta(db, 450000000)
    ajustar(db, 450000000)

    const n = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE category = 'ajuste'").get() as {
      n: number
    }
    expect(n.n).toBe(0)
  })
})
