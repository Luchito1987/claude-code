import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOY = '2026-08-10'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-grp-'))
  path = join(dir, 'test.db')
  process.env.SQLITE_PATH = path
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

/** Un servicio medido (luz) y uno de importe fijo (expensas). */
function seedServices(db: Database.Database): void {
  const insert = db.prepare(
    `INSERT INTO services (id, name, provider, category, expected_amount_cents, due_day, active, autodebit, notes, created_at)
     VALUES (?, ?, '', ?, ?, ?, 1, 0, '', '2026-01-01T00:00:00Z')`,
  )
  insert.run('s-luz', 'Luz', 'servicios', 4200000, 9)
  insert.run('s-exp', 'Expensas', 'hogar', 9500000, 10)
}

describe('agrupación de los pagos del mes', () => {
  it('manda los servicios medidos a "servicio" y el resto a "fijo"', async () => {
    const { q, db } = await load()
    seedServices(db)
    q.ensureBillsForPeriod('2026-08')

    const items = q.monthItems('2026-08', HOY)
    const porNombre = Object.fromEntries(items.map((i) => [i.label, i.group]))
    expect(porNombre['Luz']).toBe('servicio')
    expect(porNombre['Expensas']).toBe('fijo')
  })

  it('las facturas se pueden editar y los resúmenes y cuotas no', async () => {
    const { q, db } = await load()
    seedServices(db)
    q.ensureBillsForPeriod('2026-08')
    db.prepare(
      `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
       installments_paid, first_due_date, rate_annual, active, created_at)
       VALUES ('l1', 'Préstamo', '', 0, 18500000, 24, 5, '2026-03-11', 0, 1, '2026-01-01T00:00:00Z')`,
    ).run()

    const items = q.monthItems('2026-08', HOY)
    expect(items.filter((i) => i.kind === 'factura').every((i) => i.editable)).toBe(true)
    const cuota = items.find((i) => i.kind === 'prestamo')
    expect(cuota?.group).toBe('prestamo')
    expect(cuota?.editable).toBe(false)
  })
})

describe('gasto variable del mes', () => {
  const tx = (over: Record<string, unknown>) => ({
    id: Math.random().toString(36).slice(2),
    date: '2026-08-05',
    description: 'x',
    merchant: '',
    amount_cents: -1000,
    currency: 'ARS',
    category: 'otros',
    method: 'debito',
    account_id: null,
    card_id: null,
    statement_id: null,
    source: 'manual',
    installment: '',
    billing_period: '',
    receipt_path: '',
    fingerprint: '',
    created_at: '2026-08-05T00:00:00Z',
    ...over,
  })

  async function insertTxs(db: Database.Database, rows: Array<Record<string, unknown>>) {
    const stmt = db.prepare(
      `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
       account_id, card_id, statement_id, source, installment, billing_period, receipt_path, fingerprint, created_at)
       VALUES (@id, @date, @description, @merchant, @amount_cents, @currency, @category, @method,
       @account_id, @card_id, @statement_id, @source, @installment, @billing_period, @receipt_path, @fingerprint, @created_at)`,
    )
    for (const r of rows) stmt.run(tx(r))
  }

  it('no cuenta lo pagado con tarjeta, que ya viaja en el resumen', async () => {
    const { q, db } = await load()
    db.prepare(
      `INSERT INTO cards (id, name, issuer, closing_day, due_day, limit_cents, currency)
       VALUES ('c1', 'Visa', '', 25, 5, 0, 'ARS')`,
    ).run()
    await insertTxs(db, [
      { category: 'supermercado', amount_cents: -50000, card_id: null },
      { category: 'supermercado', amount_cents: -70000, card_id: 'c1' },
    ])

    const variable = q.variableSpend('2026-08')
    expect(variable).toEqual([{ category: 'supermercado', cents: 50000 }])
  })

  it('deja afuera los rubros que ya tienen su propia línea', async () => {
    const { q, db } = await load()
    await insertTxs(db, [
      { category: 'delivery', amount_cents: -30000 },
      { category: 'servicios', amount_cents: -80000 },
      { category: 'prestamos', amount_cents: -90000 },
      { category: 'pago_tarjeta', amount_cents: -400000 },
      { category: 'transferencias', amount_cents: -10000 },
    ])

    expect(q.variableSpend('2026-08')).toEqual([{ category: 'delivery', cents: 30000 }])
  })

  it('no cuenta ingresos ni lo que cae fuera del mes financiero', async () => {
    const { q, db } = await load()
    await insertTxs(db, [
      { category: 'supermercado', amount_cents: -20000, date: '2026-08-05' },
      { category: 'ingresos', amount_cents: 500000, date: '2026-08-05' },
      // El mes financiero de agosto va del 28/07 al 27/08.
      { category: 'supermercado', amount_cents: -99999, date: '2026-08-28' },
    ])

    expect(q.variableSpend('2026-08')).toEqual([{ category: 'supermercado', cents: 20000 }])
  })
})

describe('categorías que se ofrecen al cargar un gasto a mano', () => {
  it('no ofrece ningún rubro que después quede fuera del bloque de variables', async () => {
    const { CATEGORIES, MANUAL_EXPENSE_CATEGORIES, NON_VARIABLE_CATEGORIES } = await import('@/lib/categories')
    for (const c of MANUAL_EXPENSE_CATEGORIES) expect(NON_VARIABLE_CATEGORIES).not.toContain(c)
    // Y no se pierde ninguna por el camino: las dos listas parten CATEGORIES.
    expect(MANUAL_EXPENSE_CATEGORIES.length + NON_VARIABLE_CATEGORIES.length).toBe(CATEGORIES.length)
  })

  it('un gasto cargado con cualquiera de ellas aparece en el bloque', async () => {
    const { q, db } = await load()
    const { MANUAL_EXPENSE_CATEGORIES } = await import('@/lib/categories')
    const stmt = db.prepare(
      `INSERT INTO transactions (id, date, description, amount_cents, category, method, created_at)
       VALUES (?, '2026-08-05', 'x', -1000, ?, 'debito', '2026-08-05T00:00:00Z')`,
    )
    for (const c of MANUAL_EXPENSE_CATEGORIES) stmt.run(`t-${c}`, c)

    const vistas = q.variableSpend('2026-08').map((v) => v.category).sort()
    expect(vistas).toEqual([...MANUAL_EXPENSE_CATEGORIES].sort())
  })
})

describe('categorías que se ofrecen al dar de alta un servicio', () => {
  it('no ofrece rubros que ya se manejan en otra pantalla', async () => {
    const { BILLABLE_CATEGORIES } = await import('@/lib/categories')
    for (const c of ['prestamos', 'pago_tarjeta', 'transferencias', 'ingresos']) {
      expect(BILLABLE_CATEGORIES).not.toContain(c)
    }
  })

  it('todas caen en alguno de los dos bloques de facturas', async () => {
    const { q } = await load()
    const { BILLABLE_CATEGORIES } = await import('@/lib/categories')
    for (const c of BILLABLE_CATEGORIES) {
      expect(['servicio', 'fijo']).toContain(q.billGroup(c))
    }
    // Y el reparto no es trivial: los medidos van a un lado y el resto al otro.
    expect(q.billGroup('servicios')).toBe('servicio')
    expect(q.billGroup('hogar')).toBe('fijo')
  })
})

describe('alta de un gasto fijo desde el tablero', () => {
  const alta = (q: typeof import('@/lib/queries'), over: Record<string, unknown> = {}) =>
    q.addFixedExpense({ name: 'Gimnasio', category: 'salud', amountCents: 3500000, date: '2026-08-05', ...over })

  it('queda como compromiso del mes, ya pagado y confirmado', async () => {
    const { q, db } = await load()
    alta(q)

    const items = q.monthItems('2026-08', HOY)
    const gym = items.find((i) => i.label === 'Gimnasio')
    expect(gym).toMatchObject({ group: 'fijo', cents: 3500000, paid: true, estimated: false })
    expect(db.prepare("SELECT COUNT(*) n FROM services WHERE name = 'Gimnasio'").get()).toEqual({ n: 1 })
  })

  it('vuelve solo el mes siguiente, con el mismo importe', async () => {
    const { q } = await load()
    alta(q)
    q.ensureBillsForPeriod('2026-09')

    const sep = q.monthItems('2026-09', HOY).find((i) => i.label === 'Gimnasio')
    expect(sep).toMatchObject({ group: 'fijo', cents: 3500000, paid: false })
  })

  it('no se cuenta también como gasto variable', async () => {
    const { q } = await load()
    alta(q)
    // Si además hubiera dejado una transacción, el mismo gasto sumaría dos veces.
    expect(q.variableSpend('2026-08')).toEqual([])
  })

  it('cargarlo dos veces no crea un segundo gasto fijo', async () => {
    const { q, db } = await load()
    alta(q)
    alta(q, { amountCents: 4000000, date: '2026-08-20' })

    expect(db.prepare("SELECT COUNT(*) n FROM services WHERE name = 'Gimnasio'").get()).toEqual({ n: 1 })
    const gym = q.monthItems('2026-08', HOY).filter((i) => i.label === 'Gimnasio')
    expect(gym).toHaveLength(1)
    expect(gym[0].cents).toBe(4000000)
  })

  it('el rubro decide el bloque: uno medido va a Servicios', async () => {
    const { q } = await load()
    q.addFixedExpense({ name: 'Luz', category: 'servicios', amountCents: 4200000, date: '2026-08-05' })
    expect(q.monthItems('2026-08', HOY).find((i) => i.label === 'Luz')?.group).toBe('servicio')
  })
})

describe('editar el importe de una factura', () => {
  async function seedTresMeses() {
    const { q, db } = await load()
    seedServices(db)
    for (const p of ['2026-08', '2026-09', '2026-10']) q.ensureBillsForPeriod(p)
    return { q, db }
  }

  const billOf = (db: Database.Database, service: string, period: string) =>
    db.prepare('SELECT id, amount_cents, estimated FROM bills WHERE service_id = ? AND period = ?').get(service, period) as {
      id: string
      amount_cents: number
      estimated: number
    }

  it('en un gasto fijo el importe nuevo rige de ese mes en adelante', async () => {
    const { q, db } = await seedTresMeses()
    q.updateBillAmount(billOf(db, 's-exp', '2026-08').id, 11000000)

    expect(billOf(db, 's-exp', '2026-08').amount_cents).toBe(11000000)
    expect(billOf(db, 's-exp', '2026-09').amount_cents).toBe(11000000)
    expect(billOf(db, 's-exp', '2026-10').amount_cents).toBe(11000000)
    // Y los meses que todavía no existen lo heredan.
    const servicio = db.prepare("SELECT expected_amount_cents FROM services WHERE id = 's-exp'").get() as {
      expected_amount_cents: number
    }
    expect(servicio.expected_amount_cents).toBe(11000000)
  })

  it('en un servicio medido el importe vale solo para su mes', async () => {
    const { q, db } = await seedTresMeses()
    q.updateBillAmount(billOf(db, 's-luz', '2026-08').id, 6100000)

    expect(billOf(db, 's-luz', '2026-08').amount_cents).toBe(6100000)
    expect(billOf(db, 's-luz', '2026-09').amount_cents).toBe(4200000)
    const servicio = db.prepare("SELECT expected_amount_cents FROM services WHERE id = 's-luz'").get() as {
      expected_amount_cents: number
    }
    expect(servicio.expected_amount_cents).toBe(4200000)
  })

  it('el importe editado queda confirmado, no estimado', async () => {
    const { q, db } = await seedTresMeses()
    expect(billOf(db, 's-luz', '2026-08').estimated).toBe(1)
    q.updateBillAmount(billOf(db, 's-luz', '2026-08').id, 6100000)
    expect(billOf(db, 's-luz', '2026-08').estimated).toBe(0)
  })

  it('propagar hacia adelante no pisa un mes ya confirmado a mano', async () => {
    const { q, db } = await seedTresMeses()
    // Octubre ya tiene el importe real cargado.
    q.updateBillAmount(billOf(db, 's-exp', '2026-10').id, 12500000)
    // Y ahora se corrige agosto.
    q.updateBillAmount(billOf(db, 's-exp', '2026-08').id, 11000000)

    expect(billOf(db, 's-exp', '2026-09').amount_cents).toBe(11000000)
    expect(billOf(db, 's-exp', '2026-10').amount_cents).toBe(12500000)
  })
})
