import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SCHEMA = resolve(__dirname, '../src/db/schema.sql')

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-mig-'))
  path = join(dir, 'test.db')
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(dir, { recursive: true, force: true })
})

/** Base como la dejó una versión vieja del esquema: sin billing_period. */
function createLegacyDb(): void {
  const sql = readFileSync(SCHEMA, 'utf8').replace(/^\s*billing_period.*$/m, '')
  const legacy = new Database(path)
  legacy.exec(sql)
  legacy.close()
}

function columnsOf(table: string): string[] {
  const conn = new Database(path, { readonly: true })
  const cols = (conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
  conn.close()
  return cols
}

async function openViaClient() {
  process.env.SQLITE_PATH = path
  // El módulo cachea la conexión, así que cada caso necesita una copia fresca.
  vi.resetModules()
  const { getDb } = await import('@/db/client')
  return getDb()
}

describe('migración de bases ya creadas', () => {
  it('la base vieja efectivamente no trae la columna', () => {
    createLegacyDb()
    expect(columnsOf('transactions')).not.toContain('billing_period')
  })

  it('agrega billing_period a una base que ya existía', async () => {
    createLegacyDb()
    const db = await openViaClient()
    expect(columnsOf('transactions')).toContain('billing_period')
    // La consulta que rompía /proyeccion y /deudas.
    expect(() => db.prepare('SELECT billing_period FROM transactions').all()).not.toThrow()
    db.close()
  })

  it('conserva las filas que ya estaban', async () => {
    createLegacyDb()
    const seed = new Database(path)
    seed
      .prepare(
        `INSERT INTO transactions (id, date, description, amount_cents, created_at)
         VALUES ('t1', '2026-08-01', 'compra vieja', -1000, '2026-08-01T00:00:00Z')`,
      )
      .run()
    seed.close()

    const db = await openViaClient()
    const row = db.prepare('SELECT description, billing_period FROM transactions WHERE id = ?').get('t1')
    expect(row).toEqual({ description: 'compra vieja', billing_period: '' })
    db.close()
  })

  it('no falla si se corre sobre una base que ya está al día', async () => {
    const db = await openViaClient()
    db.close()
    const again = await openViaClient()
    expect(columnsOf('transactions')).toContain('billing_period')
    again.close()
  })
})
