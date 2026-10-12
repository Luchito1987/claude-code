/**
 * La plata que se mueve entre cuentas del hogar no es ingreso ni gasto.
 *
 * Cada transferencia entre dos cuentas propias aparece dos veces: salida en
 * una, entrada en la otra. La salida ya se tomaba como transferencia, pero la
 * entrada caía en "ingresos" como cualquier plata positiva. Con la cuenta de la
 * empresa y las dos personales cargadas, eso inventaba $27 millones de ingresos
 * en un mes y medio. Estos tests fijan cuándo dos movimientos son la misma
 * plata, y sobre todo cuándo no.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-internas-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(dir, { recursive: true, force: true })
})

async function preparar() {
  const { getDb } = await import('@/db/client')
  const q = await import('@/lib/queries')
  const db = getDb()
  for (const [id, name] of [['emp', 'Empresa'], ['luc', 'Luciano'], ['ine', 'Inés']])
    db.prepare(`INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES (?, ?, 'ahorro', 'COP', 0, 'x')`).run(id, name)
  let n = 0
  const mov = (cuenta: string, date: string, description: string, cents: number) => {
    const id = `t${++n}`
    db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, category, account_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'x')`,
    ).run(id, date, description, cents, cents > 0 ? 'ingresos' : 'transferencias', cuenta)
    return id
  }
  const leer = (id: string) =>
    db.prepare('SELECT category, commitment FROM transactions WHERE id = ?').get(id) as { category: string; commitment: string }
  return { db, q, mov, leer }
}

describe('emparejar transferencias entre cuentas propias', () => {
  it('la empresa pagándole a Luciano deja de ser un ingreso', async () => {
    const { q, mov, leer } = await preparar()
    const sale = mov('emp', '2026-09-04', 'PAGO A PROVE Luciano Blanco', -375_000_000)
    const entra = mov('luc', '2026-09-04', 'PAGO DE PROV DRA. INES PETRO', 375_000_000)

    expect(q.markInternalTransfers()).toBe(1)
    expect(leer(entra)).toEqual({ category: 'transferencias', commitment: `interna:${sale}` })
    expect(leer(sale)).toEqual({ category: 'transferencias', commitment: `interna:${entra}` })
  })

  it('acepta que el banco acredite al día siguiente, pero no más', async () => {
    const { q, mov } = await preparar()
    mov('luc', '2026-10-05', 'TRANSFERENCIA CTA SUC VIRTUAL', -240_000_000)
    mov('ine', '2026-10-06', 'TRANSFERENCIA CTA SUC VIRTUAL', 240_000_000)
    mov('luc', '2026-10-01', 'TRANSFERENCIA CTA SUC VIRTUAL', -50_000_000)
    mov('ine', '2026-10-04', 'TRANSFERENCIA CTA SUC VIRTUAL', 50_000_000)
    expect(q.markInternalTransfers()).toBe(1)
  })

  it('no empareja un cobro de un tercero con un pago que coincidió en monto', async () => {
    const { q, mov, leer } = await preparar()
    // La clínica le paga a la empresa el mismo día que Luciano paga el colegio
    // por el mismo importe: es casualidad, no plata que va y viene.
    const cobro = mov('emp', '2026-09-08', 'PAGO INTERBANC DIAMANTI CLINIC', 400_000_000)
    mov('luc', '2026-09-08', 'PAGO PSE CONGREGACION DE LOS', -400_000_000)
    expect(q.markInternalTransfers()).toBe(0)
    expect(leer(cobro).category).toBe('ingresos')
  })

  it('no empareja dos movimientos de la misma cuenta', async () => {
    const { q, mov } = await preparar()
    mov('luc', '2026-09-10', 'TRANSFERENCIA CTA SUC VIRTUAL', -10_000_000)
    mov('luc', '2026-09-10', 'TRANSFERENCIA CTA SUC VIRTUAL', 10_000_000)
    expect(q.markInternalTransfers()).toBe(0)
  })

  it('dos pagos iguales el mismo día se emparejan uno con uno', async () => {
    const { q, mov } = await preparar()
    mov('emp', '2026-10-09', 'PAGO A PROVE Luciano Blanco', -120_000_000)
    mov('emp', '2026-10-09', 'PAGO A PROVE Ines Onisa Petr', -120_000_000)
    mov('luc', '2026-10-09', 'PAGO DE PROV DRA. INES PETRO', 120_000_000)
    mov('ine', '2026-10-09', 'PAGO DE PROV DRA. INES PETRO', 120_000_000)
    expect(q.markInternalTransfers()).toBe(2)
  })

  it('correrlo de nuevo no cambia nada, y la segunda cuenta que llega completa el par', async () => {
    const { q, mov } = await preparar()
    mov('emp', '2026-09-30', 'PAGO A PROVE Luciano Blanco', -450_000_000)
    // Todavía no se cargó la cuenta de Luciano: no hay par.
    expect(q.markInternalTransfers()).toBe(0)
    mov('luc', '2026-09-30', 'PAGO DE PROV DRA. INES PETRO', 450_000_000)
    expect(q.markInternalTransfers()).toBe(1)
    expect(q.markInternalTransfers()).toBe(0)
  })

  it('lo que entró y salió del hogar en el mes ya no las cuenta', async () => {
    const { q, mov } = await preparar()
    mov('emp', '2026-09-08', 'PAGO INTERBANC DIAMANTI CLINIC', 400_000_000)
    mov('emp', '2026-09-10', 'PAGO A PROVE Ines Onisa Petr', -300_000_000)
    mov('ine', '2026-09-10', 'PAGO DE PROV DRA. INES PETRO', 300_000_000)
    mov('ine', '2026-09-12', 'COMPRA EN ALMACEN', -50_000_000)

    expect(q.monthCashFlow('2026-09')).toEqual({ inCents: 700_000_000, outCents: 350_000_000 })
    q.markInternalTransfers()
    expect(q.monthCashFlow('2026-09')).toEqual({ inCents: 400_000_000, outCents: 50_000_000 })
  })
})

describe('deshacer una importación', () => {
  it('libera la otra pata del par para que se vuelva a emparejar al reimportar', async () => {
    const { db, q, mov, leer } = await preparar()
    db.prepare(`INSERT INTO statements (id, kind, account_id, file_name, imported_at) VALUES ('st-luc', 'account', 'luc', 'viejo.xlsx', 'x')`).run()
    const sale = mov('emp', '2026-09-04', 'PAGO A PROVE Luciano Blanco', -375_000_000)
    const entra = mov('luc', '2026-09-04', 'PAGO DE PROV DRA. INES PETRO', 375_000_000)
    db.prepare(`UPDATE transactions SET statement_id = 'st-luc' WHERE id = ?`).run(entra)
    expect(q.markInternalTransfers()).toBe(1)

    // Se deshace la carga de Luciano: la salida de la empresa queda sin par.
    q.deleteStatement('st-luc')
    expect(leer(sale).commitment).toBe('')

    // Se carga el extracto que la reemplaza y el par se vuelve a formar.
    const otra = mov('luc', '2026-09-04', 'PAGO DE PROV DRA. INES PETRO', 375_000_000)
    expect(q.markInternalTransfers()).toBe(1)
    expect(leer(otra)).toEqual({ category: 'transferencias', commitment: `interna:${sale}` })
  })
})
