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
  { table: 'loans', column: 'currency', definition: "TEXT NOT NULL DEFAULT 'COP'" },
  { table: 'incomes', column: 'currency', definition: "TEXT NOT NULL DEFAULT 'COP'" },
  { table: 'incomes', column: 'floor_cents', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'services', column: 'currency', definition: "TEXT NOT NULL DEFAULT 'COP'" },
  { table: 'users', column: 'totp_secret', definition: "TEXT NOT NULL DEFAULT ''" },
  { table: 'users', column: 'totp_enabled', definition: 'INTEGER NOT NULL DEFAULT 0' },
]

/**
 * Corrige la moneda de los datos que entraron antes de que la app supiera que
 * existía más de una.
 *
 * El esquema nacía con 'ARS' por defecto, así que todo lo cargado hasta acá
 * —cuentas de Bancolombia, la tarjeta de Éxito, cada movimiento de esos
 * extractos— quedó marcado como pesos argentinos siendo colombiano. El importe
 * nunca estuvo mal; la etiqueta sí, y eso deja de ser cosmético en cuanto
 * convivan las dos monedas.
 *
 * Corre una sola vez y deja constancia: un ARS cargado a conciencia después de
 * esto es un ARS de verdad y no hay que tocarlo.
 */
function migrarMonedaBase(conn: Database.Database): void {
  const hecha = conn.prepare("SELECT value FROM settings WHERE key = 'moneda_base_migrada'").get() as
    | { value: string }
    | undefined
  if (hecha) return

  for (const tabla of ['accounts', 'cards', 'transactions']) {
    const columnas = conn.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>
    if (!columnas.some((c) => c.name === 'currency')) continue
    conn.prepare(`UPDATE ${tabla} SET currency = 'COP' WHERE currency = 'ARS'`).run()
  }
  // Un ingreso sin piso declarado se toma por entero: es el caso del sueldo que
  // se cobra completo y puntual.
  conn.prepare('UPDATE incomes SET floor_cents = amount_cents WHERE floor_cents = 0').run()

  conn.prepare("INSERT INTO settings (key, value) VALUES ('moneda_base_migrada', ?)").run(new Date().toISOString())
}

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
  migrarMonedaBase(db)
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
