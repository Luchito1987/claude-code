import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

let db: Database.Database | null = null

export function dbPath(): string {
  return process.env.SQLITE_PATH ?? resolve(process.cwd(), 'data', 'finanzas.db')
}

export function getDb(): Database.Database {
  if (db) return db
  const path = dbPath()
  mkdirSync(dirname(path), { recursive: true })
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(readFileSync(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'))
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
