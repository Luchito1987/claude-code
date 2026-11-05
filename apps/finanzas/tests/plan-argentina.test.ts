/** Plan de mudanza: cuánto tiene que ganar Inés y cómo baja al terminar deudas. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toCents } from '@/lib/money'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-plan-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  vi.resetModules()
})
afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(dir, { recursive: true, force: true })
})

describe('plan Argentina', () => {
  it('los montos del formulario se leen con puntos de miles', () => {
    expect(toCents('1.200.000')).toBe(120000000)
    expect(toCents('27.500.000')).toBe(2750000000)
  })

  it('lo que necesita Inés baja cuando termina un crédito', async () => {
    const { getDb } = await import('@/db/client')
    const db = getDb()
    db.prepare(
      `INSERT INTO incomes (id, name, amount_cents, floor_cents, currency, day_of_month, active, created_at)
       VALUES ('s', 'Sueldo', 300000000, 300000000, 'ARS', 28, 1, 'x')`,
    ).run()
    db.prepare(
      `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total, installments_paid,
       first_due_date, rate_annual, currency, active, created_at)
       VALUES ('c', 'Crédito CO', '', 0, 200000000, 3, 1, '2026-10-04', 0, 'COP', 1, 'x')`,
    ).run()
    const { calcularPlan, guardarPlan } = await import('@/lib/plan-argentina')
    guardarPlan({ fxCopPorArs: 2, costoAR: { alquiler: 100000000, mercado: 100000000, colegios: 0, servicios: 0, otros: 100000000 } })
    const p = calcularPlan('2026-11-05')
    // Costo 3.000.000 + crédito 2.000.000 COP / 2 = 1.000.000 − sueldo 3.000.000 = 1.000.000 ARS.
    expect(p.necesitaInes[0]).toEqual({ periodo: '2026-11', ars: 100000000, cop: 200000000 })
    // El crédito termina en diciembre: desde enero Inés no necesita aportar.
    expect(p.necesitaInes[2].ars).toBe(0)
    expect(p.deudas[0]).toMatchObject({ nombre: 'Crédito CO', cuotasQuedan: 2, terminaEn: '2026-12' })
  })
})
