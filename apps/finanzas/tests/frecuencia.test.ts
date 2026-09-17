/**
 * Un servicio no siempre se paga todos los meses.
 *
 * La app generaba una factura por cada servicio activo en cada período, sin
 * preguntar. Con la luz está bien; con la declaración de renta, no: aparecía
 * los doce meses e inflaba el gasto fijo en algo que nadie iba a pagar. Estos
 * tests fijan cuándo cae cada cosa, y sobre todo que lo que no declara nada
 * siga siendo mensual —que es lo que era toda la base antes de este cambio.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  describirFrecuencia,
  normalizarFrecuencia,
  normalizarMesAncla,
  venceEnPeriodo,
} from '@/lib/frecuencia'
import { monthlyOutlook } from '@/lib/monthly'

describe('venceEnPeriodo', () => {
  it('lo mensual cae siempre, sin mirar el ancla', () => {
    const luz = { frequency: 'mensual', anchor_month: 7 }
    for (let m = 1; m <= 12; m++) {
      expect(venceEnPeriodo(luz, `2026-${String(m).padStart(2, '0')}`)).toBe(true)
    }
  })

  it('lo anual cae sólo en su mes', () => {
    const renta = { frequency: 'anual', anchor_month: 9 }
    expect(venceEnPeriodo(renta, '2026-09')).toBe(true)
    expect(venceEnPeriodo(renta, '2026-10')).toBe(false)
    expect(venceEnPeriodo(renta, '2027-09')).toBe(true)
  })

  it('lo bimestral alterna a partir del ancla, y cruza el año', () => {
    const impuesto = { frequency: 'bimestral', anchor_month: 9 }
    const caen = [1, 3, 5, 7, 9, 11]
    for (let m = 1; m <= 12; m++) {
      const period = `2026-${String(m).padStart(2, '0')}`
      expect(venceEnPeriodo(impuesto, period), period).toBe(caen.includes(m))
    }
  })

  it('lo trimestral y lo semestral cuentan desde el ancla', () => {
    expect(venceEnPeriodo({ frequency: 'trimestral', anchor_month: 2 }, '2026-05')).toBe(true)
    expect(venceEnPeriodo({ frequency: 'trimestral', anchor_month: 2 }, '2026-06')).toBe(false)
    expect(venceEnPeriodo({ frequency: 'semestral', anchor_month: 3 }, '2026-09')).toBe(true)
    expect(venceEnPeriodo({ frequency: 'semestral', anchor_month: 3 }, '2026-10')).toBe(false)
  })

  it('lo que no declara nada es mensual', () => {
    expect(venceEnPeriodo({}, '2026-04')).toBe(true)
    expect(venceEnPeriodo({ frequency: '', anchor_month: 0 }, '2026-04')).toBe(true)
    expect(venceEnPeriodo({ frequency: 'cualquiera' }, '2026-04')).toBe(true)
  })

  it('un mes ancla fuera de rango no rompe nada', () => {
    expect(normalizarMesAncla(0)).toBe(1)
    expect(normalizarMesAncla(-3)).toBe(1)
    expect(normalizarMesAncla(99)).toBe(12)
    expect(normalizarFrecuencia(null)).toBe('mensual')
  })

  it('describe en castellano cuándo cae', () => {
    expect(describirFrecuencia({ frequency: 'mensual' })).toBe('Todos los meses')
    expect(describirFrecuencia({ frequency: 'anual', anchor_month: 9 })).toBe('Cada septiembre')
    expect(describirFrecuencia({ frequency: 'bimestral', anchor_month: 1 })).toBe(
      'Cada 2 meses, desde enero',
    )
  })
})

describe('la proyección de un mes sin facturas generadas', () => {
  const base = {
    bills: [],
    loans: [],
    installments: [],
    cardDues: [],
    incomeMonthlyCents: 0,
    dailyBurnCents: 0,
    today: '2026-09-17',
  }

  it('no arrastra la renta anual a los meses que no le tocan', () => {
    const meses = monthlyOutlook({
      ...base,
      months: ['2026-09', '2026-10'],
      serviceEstimates: [
        { name: 'Luz', cents: 1_037_190, frequency: 'mensual', anchor_month: 1 },
        { name: 'Renta', cents: 650_000, frequency: 'anual', anchor_month: 9 },
      ],
    })
    expect(meses[0].serviciosCents).toBe(1_687_190)
    expect(meses[0].detalle.servicios.map((s) => s.label)).toContain('Renta')
    // En octubre queda sólo la luz: la renta no se paga.
    expect(meses[1].serviciosCents).toBe(1_037_190)
    expect(meses[1].detalle.servicios.map((s) => s.label)).not.toContain('Renta')
  })

  it('sin frecuencia declarada se comporta igual que antes', () => {
    const meses = monthlyOutlook({
      ...base,
      months: ['2026-10'],
      serviceEstimates: [{ name: 'Agua', cents: 1_274_635 }],
    })
    expect(meses[0].serviciosCents).toBe(1_274_635)
  })
})

describe('ensureBillsForPeriod', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'finanzas-frec-'))
    process.env.SQLITE_PATH = join(dir, 'test.db')
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.SQLITE_PATH
    rmSync(dir, { recursive: true, force: true })
  })

  it('sólo crea la factura en los meses que corresponde', async () => {
    const { getDb } = await import('@/db/client')
    const { ensureBillsForPeriod } = await import('@/lib/queries')
    const db = getDb()

    const alta = db.prepare(
      `INSERT INTO services (id, name, expected_amount_cents, due_day, frequency, anchor_month, created_at)
       VALUES (?, ?, ?, 10, ?, ?, '2026-01-01T00:00:00Z')`,
    )
    alta.run('s-luz', 'Luz', 1_037_190, 'mensual', 1)
    alta.run('s-renta', 'Renta', 650_000, 'anual', 9)

    ensureBillsForPeriod('2026-09')
    ensureBillsForPeriod('2026-10')

    const nombres = (period: string) =>
      (
        db
          .prepare(
            `SELECT s.name FROM bills b JOIN services s ON s.id = b.service_id
             WHERE b.period = ? ORDER BY s.name`,
          )
          .all(period) as Array<{ name: string }>
      ).map((r) => r.name)

    expect(nombres('2026-09')).toEqual(['Luz', 'Renta'])
    expect(nombres('2026-10')).toEqual(['Luz'])
  })

  it('una base vieja, sin las columnas, sigue generando todo como antes', async () => {
    const { getDb } = await import('@/db/client')
    const { ensureBillsForPeriod } = await import('@/lib/queries')
    const db = getDb()
    // La migración ya corrió: lo que simula una fila vieja es el default.
    db.prepare(
      `INSERT INTO services (id, name, expected_amount_cents, due_day, created_at)
       VALUES ('s-agua', 'Agua', 1274635, 16, '2026-01-01T00:00:00Z')`,
    ).run()

    ensureBillsForPeriod('2026-10')
    const n = db.prepare(`SELECT COUNT(*) AS n FROM bills WHERE period = '2026-10'`).get() as {
      n: number
    }
    expect(n.n).toBe(1)
  })
})
