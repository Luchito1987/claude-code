/** Lo de Argentina: resumen Naranja X y altas en pesos argentinos por API. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isNaranjaStatement, parseNaranja } from '@/lib/parsers/naranja'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

// Estructura del texto del PDF de Naranja X, con datos inventados.
const RESUMEN = [
  '¡Hola Persona!',
  'Tu total a pagar es $120.000,00',
  'y vence el 10/11/26.',
  'Detalle de Consumos tarjeta de crédito de Persona',
  'FECHA TARJETA CUPONDETALLE CUOTA/PLAN $ U$S',
  '17/10/26 NX Virtual 3294FCASA-STREAMING 01 10.000,00',
  '27/06/25 NaranjaX 491078PLANDEPAGO ^ (F01) 18/24 100.000,00',
  '27/10/26 *COMISIONPORMANTENIMIENTO DE CUENTA 5.000,00',
  'Otros IVAOperaciones Identificadas con *',
  '(BaseImponible $5.000,00) 1.050,00',
  'ImpuestodeSellos 3.950,00',
  'Total',
  '$ 120.000,00',
  'El resumen actual cerró el 27/10.',
  'Pago del resumen anterior',
  '30/09/26 PAGOENPESOS 99.000,00',
  'Información REFERENCIAS: TN: TARJETA NARANJA S.A.U.',
].join('\n')

describe('resumen Naranja X', () => {
  it('lee consumos, plan en cuotas y otros cargos en pesos argentinos, sin el pago anterior', () => {
    expect(isNaranjaStatement(RESUMEN)).toBe(true)
    const r = parseNaranja(RESUMEN)
    expect(r.rows.map((x) => [x.date, x.description, x.amountCents, x.installment, x.currency])).toEqual([
      ['2026-10-17', 'FCASA-STREAMING', -1000000, '', 'ARS'],
      ['2025-06-27', 'PLANDEPAGO', -10000000, '18/24', 'ARS'],
      ['2026-10-27', '*COMISIONPORMANTENIMIENTO DE CUENTA', -500000, '', 'ARS'],
      ['2026-10-27', 'IVA', -105000, '', 'ARS'],
      ['2026-10-27', 'Impuesto de sellos', -395000, '', 'ARS'],
    ])
    expect([r.statementDueDate, r.statementTotalCents, r.warnings]).toEqual(['2026-11-10', 12000000, []])
  })
})

let dir: string
const CLAVE = 'a'.repeat(48)
const h = { authorization: `Bearer ${CLAVE}`, 'content-type': 'application/json' }
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-ar-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = CLAVE
  vi.resetModules()
})
afterEach(() => {
  delete process.env.SQLITE_PATH
  delete process.env.FINANZAS_API_TOKEN
  rmSync(dir, { recursive: true, force: true })
})
const req = (body: unknown) => new Request('http://x', { method: 'POST', headers: h, body: JSON.stringify(body) })

describe('altas en pesos argentinos', () => {
  it('servicio, préstamo, tarjeta e ingreso quedan en ARS', async () => {
    const serv = await import('@/app/api/servicios/route')
    const pres = await import('@/app/api/prestamos/route')
    const tarj = await import('@/app/api/tarjetas/route')
    const ing = await import('@/app/api/ingresos/route')
    expect((await serv.POST(req({ crear: { nombre: 'Viaje', esperadoCents: 29910000, dia: 10, frecuencia: 'bimestral', mesAncla: 12, moneda: 'ARS' } }))).status).toBe(200)
    expect((await pres.POST(req({ crear: { nombre: 'ICBC', capitalCents: 400000000, cuotaCents: 23909073, cuotas: 96, pagadas: 24, primeraCuota: '2024-11-14', moneda: 'ARS' } }))).status).toBe(200)
    expect((await tarj.POST(req({ crear: { nombre: 'Naranja X', moneda: 'ARS', cierre: 27, vencimiento: 10 } }))).status).toBe(200)
    expect((await ing.POST(req({ nombre: 'Sueldo', importeCents: 309866381, moneda: 'ARS', dia: 1 }))).status).toBe(200)
    const cue = await import('@/app/api/cuentas/route')
    expect((await cue.POST(req({ nombre: 'Cuenta AR', saldoCents: 100, fecha: '2026-10-29', moneda: 'ARS' }))).status).toBe(200)
    expect((await ing.POST(req({ nombre: 'Sueldo', importeCents: 310000000, moneda: 'ARS', dia: 1 }))).status).toBe(200)

    const { getDb } = await import('@/db/client')
    const db = getDb()
    expect(db.prepare('SELECT currency, frequency, anchor_month FROM services').get()).toEqual({ currency: 'ARS', frequency: 'bimestral', anchor_month: 12 })
    expect(db.prepare('SELECT currency, installments_paid FROM loans').get()).toEqual({ currency: 'ARS', installments_paid: 24 })
    expect(db.prepare('SELECT currency FROM cards').get()).toEqual({ currency: 'ARS' })
    expect(db.prepare('SELECT currency FROM accounts').get()).toEqual({ currency: 'ARS' })
    expect(db.prepare('SELECT COUNT(*) AS n, MAX(amount_cents) AS c FROM incomes').get()).toEqual({ n: 1, c: 310000000 })

    const q = await import('@/lib/queries')
    const nov = q.monthItems('2026-11', '2026-10-29', 'ARS')
    expect(nov.find((i) => i.kind === 'prestamo')?.label).toBe('ICBC · cuota 25/96')
  })
})

describe('cada vista ve lo suyo', () => {
  it('movimientos, gasto por categoría e historial se filtran por moneda', async () => {
    const { getDb } = await import('@/db/client')
    const q = await import('@/lib/queries')
    const db = getDb()
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, currency, category, created_at)
       VALUES ('co', '2026-10-20', 'Mercado', -5000000, 'COP', 'supermercado', 'x'),
              ('ar', '2026-10-20', 'Kiosco', -300000, 'ARS', 'supermercado', 'x')`,
    ).run()
    expect(q.listTransactions({ currency: 'ARS' }).map((t) => t.id)).toEqual(['ar'])
    expect(q.spendByCategory('2026-10-01', '2026-10-31', 'COP')).toEqual([{ category: 'supermercado', cents: 5000000, count: 1 }])
    expect(q.monthHistory('2026-10', '2026-10-29', 'ARS').outCents).toBe(300000)
  })
})
