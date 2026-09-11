import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

let db: Database.Database | null = null

export function dbPath(): string {
  return process.env.SQLITE_PATH ?? resolve(process.cwd(), 'data', 'finanzas.db')
}

/**
 * Columnas agregadas a tablas que ya existían. `CREATE TABLE IF NOT EXISTS` no
 * toca una tabla ya creada, así que una base vieja se queda sin ellas y falla
 * recién al consultarlas.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: 'transactions', column: 'billing_period', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'services', column: 'match_pattern', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'statements', column: 'due_date', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'transactions', column: 'commitment', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'cards', column: 'match_pattern', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'loans', column: 'match_pattern', definition: "TEXT NOT NULL DEFAULT ''" },
]

function migrate(conn: Database.Database): void {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.length || columns.some((c) => c.name === column)) continue
    conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export function getDb(): Database.Database {
  if (db) return db
  const path = dbPath()
  mkdirSync(dirname(path), { recursive: true })
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'))
  migrate(db)
  return db
}

/** Base de datos en memoria con el esquema aplicado. Para tests. */
export function createMemoryDb(schemaPath = resolve(process.cwd(), 'src/db/schema.sql')): Database.Database {
  const mem = new Database(':memory:')
  mem.pragma('foreign_keys = ON')
  mem.exec(readFileSync(schemaPath, 'utf8'))
  return mem
}

export function id(): string {
  return crypto.randomUUID()
}

export function now(): string {
  return new Date().toISOString()
}
