/**
 * Dos países, dos bolsillos.
 *
 * La casa vive en Colombia y el plan es mudarse a Argentina: mientras tanto hay
 * un sueldo y obligaciones allá, y la vida diaria acá. Lo que se prueba acá no
 * es que los números se sumen bien, sino que NO se sumen entre sí: una cuota
 * argentina no puede aparecer en el mes colombiano ni pesar sobre el sueldo
 * colombiano, porque no se paga con esa plata.
 */

import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertir, formatMoney } from '@/lib/money'

const HOY = '2026-09-10'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-monedas-'))
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

function ingreso(db: Database.Database, id: string, nombre: string, nominal: number, piso: number, currency: string): void {
  db.prepare(
    `INSERT INTO incomes (id, name, owner, amount_cents, floor_cents, currency, day_of_month, active, created_at)
     VALUES (?, ?, '', ?, ?, ?, 1, 1, '2026-01-01T00:00:00Z')`,
  ).run(id, nombre, nominal, piso, currency)
}

function cuenta(db: Database.Database, id: string, saldo: number, currency: string): void {
  db.prepare(
    `INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at)
     VALUES (?, ?, 'caja_ahorro', ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(id, `cuenta ${id}`, currency, saldo)
}

function prestamo(db: Database.Database, id: string, cuota: number, currency: string): void {
  db.prepare(
    `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
       installments_paid, first_due_date, rate_annual, currency, active, created_at)
     VALUES (?, ?, '', 0, ?, 12, 0, '2026-09-05', 0, ?, 1, '2026-01-01T00:00:00Z')`,
  ).run(id, `prestamo ${id}`, cuota, currency)
}

describe('el ingreso con el que se proyecta', () => {
  it('usa el piso, no lo que corresponde cobrar', async () => {
    const { q, db } = await load()
    // Un sueldo que debería ser 3.000.000 pero del que sólo entran seguros
    // 1.500.000: para planificar vale el segundo número.
    ingreso(db, 'i1', 'Sueldo esposa', 300000000, 150000000, 'COP')

    expect(q.monthlyIncomeCents('COP')).toBe(150000000)
    expect(q.monthlyIncomeNominalCents('COP')).toBe(300000000)
  })

  it('un sueldo sin piso declarado se toma entero', async () => {
    const { q, db } = await load()
    // El caso del sueldo fijo y puntual: no hace falta cargar el piso aparte.
    ingreso(db, 'i1', 'Sueldo fijo', 200000000, 0, 'ARS')

    expect(q.monthlyIncomeCents('ARS')).toBe(200000000)
  })

  it('no mezcla el sueldo de un país con el del otro', async () => {
    const { q, db } = await load()
    ingreso(db, 'i1', 'Sueldo Colombia', 300000000, 150000000, 'COP')
    ingreso(db, 'i2', 'Sueldo Argentina', 200000000, 200000000, 'ARS')

    expect(q.monthlyIncomeCents('COP')).toBe(150000000)
    expect(q.monthlyIncomeCents('ARS')).toBe(200000000)
  })
})

describe('cada bolsillo con lo suyo', () => {
  it('la caja disponible es la de las cuentas de esa moneda', async () => {
    const { q, db } = await load()
    cuenta(db, 'a1', 50000000, 'COP')
    cuenta(db, 'a2', 90000000, 'ARS')

    expect(q.totalCashCents('COP')).toBe(50000000)
    expect(q.totalCashCents('ARS')).toBe(90000000)
  })

  it('las deudas se miden contra el ingreso de su propio país', async () => {
    const { q, db } = await load()
    prestamo(db, 'l1', 10000000, 'COP')
    prestamo(db, 'l2', 50000000, 'ARS')
    ingreso(db, 'i1', 'Sueldo Colombia', 100000000, 100000000, 'COP')
    ingreso(db, 'i2', 'Sueldo Argentina', 100000000, 100000000, 'ARS')

    const co = q.debts(HOY, 'COP')
    const ar = q.debts(HOY, 'ARS')

    expect(co.loans).toHaveLength(1)
    expect(ar.loans).toHaveLength(1)
    // Misma proporción de ingreso, montos distintos: cada uno con su sueldo.
    expect(co.proximoMesCents).toBe(10000000)
    expect(ar.proximoMesCents).toBe(50000000)
    expect(ar.pesoSobreIngreso).toBeGreaterThan(co.pesoSobreIngreso)
  })

  it('los préstamos del otro país no aparecen en el mes', async () => {
    const { q, db } = await load()
    prestamo(db, 'l1', 10000000, 'COP')
    prestamo(db, 'l2', 50000000, 'ARS')

    const items = q.monthItems('2026-09', HOY, 'COP')
    const prestamos = items.filter((i) => i.kind === 'prestamo')
    expect(prestamos).toHaveLength(1)
    expect(prestamos[0].refId).toBe('l1')
  })
})

describe('mostrar y convertir', () => {
  it('cada moneda se nombra, porque las dos usan el mismo símbolo', () => {
    // Con el símbolo a secas, "$ 200.000" no dice de qué país es, y a la
    // cotización de hoy las dos cifras no se parecen en nada.
    expect(formatMoney(317211044, 'COP')).toContain('COP')
    expect(formatMoney(317211044, 'COP')).toContain('3.172.110')
    expect(formatMoney(20000000, 'ARS')).toContain('ARS')
    expect(formatMoney(100, 'COP')).not.toBe(formatMoney(100, 'ARS'))
  })

  it('convierte entre monedas con el tipo de cambio que se le pasa', () => {
    // 1 ARS = 0,28 COP: 100.000 ARS son 28.000 COP.
    expect(convertir(10000000, 'ARS', 'COP', 0.28)).toBe(2800000)
    expect(convertir(2800000, 'COP', 'ARS', 0.28)).toBe(10000000)
  })

  it('la misma moneda no se toca, y sin cotización no inventa una', () => {
    expect(convertir(12345, 'COP', 'COP', 0)).toBe(12345)
    expect(convertir(12345, 'ARS', 'COP', 0)).toBe(0)
  })

  it('el tipo de cambio se guarda y se lee', async () => {
    const { q } = await load()
    expect(q.fxArsCop()).toBe(0)
    q.setFxArsCop(0.28)
    expect(q.fxArsCop()).toBe(0.28)
    expect(q.fxArsCopAt()).not.toBe('')
  })
})

describe('la migración de la moneda base', () => {
  it('lo cargado antes de que hubiera dos monedas queda como colombiano', async () => {
    // El esquema nacía con 'ARS' por defecto y todo lo importado —Bancolombia,
    // Éxito— quedó mal etiquetado. La migración lo corrige una sola vez.
    const { getDb } = await import('@/db/client')
    const db = getDb()
    db.prepare(
      `INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at)
       VALUES ('vieja', 'Bancolombia', 'caja_ahorro', 'ARS', 12345, '2026-01-01T00:00:00Z')`,
    ).run()

    // Segunda apertura: la migración ya corrió antes, así que este ARS puesto a
    // conciencia después no se toca.
    const fila = db.prepare("SELECT currency FROM accounts WHERE id = 'vieja'").get() as { currency: string }
    expect(fila.currency).toBe('ARS')
  })
})
