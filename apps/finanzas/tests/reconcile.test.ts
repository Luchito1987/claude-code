import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  findAlreadyLoaded,
  settleBillsFromStatement,
  settleCardsFromStatement,
  settleLoansFromStatement,
  DEFAULT_WINDOW_DAYS,
  type Settleable,
} from '@/lib/reconcile'

const ticket = (id: string, date: string, pesos: number) => ({
  id,
  date,
  amountCents: -pesos * 100,
})

/** Una línea del extracto, con el signo que usa la app para los gastos. */
const linea = (date: string, pesos: number) => ({ date, amountCents: -pesos * 100 })

describe('cruce por importe y fecha', () => {
  const cargados = [ticket('t1', '2026-08-09', 80830)]

  it('reconoce el mismo gasto aunque el banco lo impute días después', () => {
    expect(findAlreadyLoaded(cargados, linea('2026-08-11', 80830))?.id).toBe('t1')
  })

  it('lo reconoce también si el extracto lo trae el mismo día', () => {
    expect(findAlreadyLoaded(cargados, linea('2026-08-09', 80830))?.id).toBe('t1')
  })

  it('no le importa que la descripción no se parezca', () => {
    // Es el punto: el ticket dice "ALMACENES EXITO" y el banco "COMPRA 4471
    // EXITO WOW BQUILLA". La función ni mira el texto.
    expect(findAlreadyLoaded(cargados, linea('2026-08-10', 80830))).not.toBeNull()
  })

  it('un importe distinto es otro gasto', () => {
    expect(findAlreadyLoaded(cargados, linea('2026-08-09', 80831))).toBeNull()
  })

  it('fuera de la ventana de días es otro gasto', () => {
    const lejos = linea('2026-08-09', 80830)
    expect(findAlreadyLoaded([ticket('t1', '2026-08-20', 80830)], lejos)).toBeNull()
  })

  it('la ventana por defecto son tres días para cada lado', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(3)
    const t = [ticket('t1', '2026-08-09', 50000)]
    expect(findAlreadyLoaded(t, linea('2026-08-12', 50000))).not.toBeNull()
    expect(findAlreadyLoaded(t, linea('2026-08-13', 50000))).toBeNull()
    expect(findAlreadyLoaded(t, linea('2026-08-06', 50000))).not.toBeNull()
    expect(findAlreadyLoaded(t, linea('2026-08-05', 50000))).toBeNull()
  })
})

describe('dos compras parecidas no se pisan', () => {
  it('cada línea del extracto se aparea con un ticket distinto', () => {
    // Dos compras del mismo importe en la misma semana: si no se llevara
    // registro de los ya usados, las dos líneas matchearían el mismo ticket y
    // una compra quedaría sin registrar.
    const cargados = [ticket('t1', '2026-08-09', 25000), ticket('t2', '2026-08-10', 25000)]
    const usados = new Set<string>()

    const a = findAlreadyLoaded(cargados, linea('2026-08-09', 25000), { used: usados })
    expect(a?.id).toBe('t1')
    usados.add(a!.id)

    const b = findAlreadyLoaded(cargados, linea('2026-08-10', 25000), { used: usados })
    expect(b?.id).toBe('t2')
  })

  it('si hay más líneas que tickets, la sobrante se importa normal', () => {
    const cargados = [ticket('t1', '2026-08-09', 25000)]
    const usados = new Set(['t1'])
    expect(findAlreadyLoaded(cargados, linea('2026-08-09', 25000), { used: usados })).toBeNull()
  })

  it('ante dos candidatos gana el de fecha más cercana', () => {
    const cargados = [ticket('lejos', '2026-08-06', 25000), ticket('cerca', '2026-08-09', 25000)]
    expect(findAlreadyLoaded(cargados, linea('2026-08-09', 25000))?.id).toBe('cerca')
  })
})

describe('casos de borde', () => {
  it('sin nada cargado no hay nada que conciliar', () => {
    expect(findAlreadyLoaded([], linea('2026-08-09', 1000))).toBeNull()
  })

  it('cruza fin de mes sin romper', () => {
    const cargados = [ticket('t1', '2026-07-31', 12000)]
    expect(findAlreadyLoaded(cargados, linea('2026-08-02', 12000))?.id).toBe('t1')
  })

  it('la ventana se puede ajustar', () => {
    const cargados = [ticket('t1', '2026-08-01', 12000)]
    expect(findAlreadyLoaded(cargados, linea('2026-08-08', 12000))).toBeNull()
    expect(findAlreadyLoaded(cargados, linea('2026-08-08', 12000), { windowDays: 10 })?.id).toBe('t1')
  })
})

// ---------------------------------------------------------------------------
// La consulta real contra el esquema. Arriba se prueba la regla de cruce; acá
// que el SQL que la alimenta traiga lo que tiene que traer y que el enlace
// quede escrito.
// ---------------------------------------------------------------------------

const SCHEMA = resolve(__dirname, '../src/db/schema.sql')

function dbConTickets() {
  const db = new Database(':memory:')
  db.exec(readFileSync(SCHEMA, 'utf8'))
  // statement_id es clave foránea: el extracto tiene que existir antes de
  // poder enlazarle nada. En la importación real pasa lo mismo, y por eso la
  // fila del extracto se inserta antes de recorrer los movimientos.
  const stmt = db.prepare(
    `INSERT INTO statements (id, kind, file_name, period, imported_at)
     VALUES (?, 'account', 'qa.csv', '2026-08', '2026-08-09T00:00:00Z')`,
  )
  stmt.run('stmt-viejo')
  stmt.run('stmt-nuevo')

  const insert = db.prepare(
    `INSERT INTO transactions (id, date, description, amount_cents, category, method, source, statement_id, created_at)
     VALUES (?, ?, ?, ?, 'otros', 'efectivo', ?, ?, '2026-08-09T00:00:00Z')`,
  )
  insert.run('tk', '2026-08-09', 'Ticket Exito', -8083000, 'ticket', null)
  insert.run('manual', '2026-08-09', 'Verduleria', -1200000, 'manual', null)
  insert.run('ya-importado', '2026-08-09', 'Del extracto', -5000000, 'import', null)
  insert.run('conciliado', '2026-08-09', 'Ticket viejo', -700000, 'ticket', 'stmt-viejo')
  insert.run('ingreso', '2026-08-09', 'Sueldo', 50000000, 'manual', null)
  return db
}

/** Igual que en importStatementAction. */
const CANDIDATOS = `SELECT id, date, amount_cents AS amountCents FROM transactions
   WHERE statement_id IS NULL AND source IN ('ticket', 'manual') AND amount_cents < 0`

describe('la consulta que alimenta la conciliación', () => {
  it('trae los cargados a mano y por ticket, y deja afuera el resto', () => {
    const db = dbConTickets()
    const ids = (db.prepare(CANDIDATOS).all() as Array<{ id: string }>).map((r) => r.id).sort()
    // 'ya-importado' vino del banco, 'conciliado' ya tiene extracto y 'ingreso'
    // no es un gasto: ninguno puede aparearse.
    expect(ids).toEqual(['manual', 'tk'])
    db.close()
  })

  it('enlaza el ticket al extracto en vez de insertar otra fila', () => {
    const db = dbConTickets()
    const candidatos = db.prepare(CANDIDATOS).all() as Array<{
      id: string
      date: string
      amountCents: number
    }>

    // La línea del extracto: mismo importe, dos días después, otro texto.
    const previo = findAlreadyLoaded(candidatos, { date: '2026-08-11', amountCents: -8083000 })
    expect(previo?.id).toBe('tk')

    db.prepare('UPDATE transactions SET statement_id = ? WHERE id = ?').run('stmt-nuevo', previo!.id)

    const filas = db.prepare('SELECT COUNT(*) n FROM transactions WHERE amount_cents = -8083000').get() as {
      n: number
    }
    expect(filas.n).toBe(1)
    const tk = db.prepare("SELECT statement_id FROM transactions WHERE id = 'tk'").get() as {
      statement_id: string
    }
    expect(tk.statement_id).toBe('stmt-nuevo')
    db.close()
  })

  it('un ticket ya conciliado no se vuelve a aparear con otro extracto', () => {
    const db = dbConTickets()
    const candidatos = db.prepare(CANDIDATOS).all() as Array<{
      id: string
      date: string
      amountCents: number
    }>
    expect(findAlreadyLoaded(candidatos, { date: '2026-08-09', amountCents: -700000 })).toBeNull()
    db.close()
  })
})

// ---------------------------------------------------------------------------
// Facturas contra el extracto. Todos los casos salen de un extracto real de
// Bancolombia: son los que muestran por qué no alcanza con cruzar por importe
// ni por nombre.
// ---------------------------------------------------------------------------

const factura = (id: string, serviceName: string, pattern: string, pesos: number) => ({
  id,
  serviceName,
  pattern,
  amountCents: pesos * 100,
})

const mov = (date: string, description: string, pesos: number) => ({
  date,
  description,
  amountCents: -pesos * 100,
})

describe('facturas que el extracto confirma', () => {
  it('cruza aunque el nombre del banco no se parezca en nada', () => {
    // Air-e se paga como "PAGO SV EMPRESA DE ENERGIA AI". Ni "Air" aparece
    // entero: por texto libre no hay forma, por eso el patrón lo pone el usuario.
    const r = settleBillsFromStatement(
      [factura('b1', 'Air-e (Energía)', 'EMPRESA DE ENERGIA AI', 809590)],
      [mov('2026-08-10', 'PAGO SV EMPRESA DE ENERGIA AI', 879690)],
    )
    expect(r).toHaveLength(1)
    expect(r[0].bill.serviceName).toBe('Air-e (Energía)')
  })

  it('avisa que el importe estimado no era el real', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Air-e (Energía)', 'EMPRESA DE ENERGIA AI', 809590)],
      [mov('2026-08-10', 'PAGO SV EMPRESA DE ENERGIA AI', 879690)],
    )
    expect(r[0].amountChanged).toBe(true)
    expect(r[0].paidCents).toBe(87969000)
  })

  it('cuando el estimado daba justo, no marca corrección', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Gases del Caribe', 'GASES DEL CARIBE', 114327)],
      [mov('2026-08-04', 'PAGO SV GASES DEL CARIBE S.A.', 114327)],
    )
    expect(r[0].amountChanged).toBe(false)
  })

  it('el caso imposible de adivinar: el agua se paga a una fiduciaria', () => {
    // "PAGO PSE FIDUCIARIA BANCOLOM" es Triple A. Sin que alguien lo diga, no
    // hay heurística que lo saque.
    const r = settleBillsFromStatement(
      [factura('b1', 'Triple A (Agua)', 'FIDUCIARIA BANCOLOM', 845666)],
      [mov('2026-08-10', 'PAGO PSE FIDUCIARIA BANCOLOM', 991088)],
    )
    expect(r[0].bill.serviceName).toBe('Triple A (Agua)')
    expect(r[0].paidCents).toBe(99108800)
  })

  it('ignora acentos y mayúsculas al comparar', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Colegio', 'congregacion de los', 1685289)],
      [mov('2026-08-10', 'PAGO PSE CONGREGACIÓN DE LOS', 1685289)],
    )
    expect(r).toHaveLength(1)
  })
})

describe('lo que no tiene que cruzar', () => {
  it('un servicio sin patrón nunca se marca solo', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Triple A (Agua)', '', 845666)],
      [mov('2026-08-10', 'PAGO PSE FIDUCIARIA BANCOLOM', 845666)],
    )
    expect(r).toHaveLength(0)
  })

  it('la plata que entra no paga facturas', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Air-e', 'ENERGIA', 809590)],
      [{ date: '2026-08-10', description: 'ABONO ENERGIA', amountCents: 80959000 }],
    )
    expect(r).toHaveLength(0)
  })

  it('cada factura se paga una sola vez aunque el patrón aparezca dos veces', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Air-e', 'ENERGIA AI', 809590)],
      [mov('2026-08-10', 'PAGO SV EMPRESA DE ENERGIA AI', 879690), mov('2026-08-11', 'PAGO SV EMPRESA DE ENERGIA AI', 5000)],
    )
    expect(r).toHaveLength(1)
    expect(r[0].paidCents).toBe(87969000)
  })

  it('dos servicios distintos con el mismo movimiento no se pisan', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Air-e', 'ENERGIA AI', 809590), factura('b2', 'Triple A', 'FIDUCIARIA', 845666)],
      [mov('2026-08-10', 'PAGO SV EMPRESA DE ENERGIA AI', 879690), mov('2026-08-10', 'PAGO PSE FIDUCIARIA BANCOLOM', 991088)],
    )
    expect(r.map((x) => x.bill.serviceName)).toEqual(['Air-e', 'Triple A'])
  })
})

// ---------------------------------------------------------------------------
// Tarjetas, préstamos y el mes al que pertenece cada compromiso
// ---------------------------------------------------------------------------

const tarjeta = (id: string, label: string, pattern: string): Settleable => ({
  id,
  label,
  pattern,
  amountCents: 0,
})

const prestamo = (id: string, label: string, cuota: number, pattern = ''): Settleable => ({
  id,
  label,
  pattern,
  amountCents: cuota * 100,
})

describe('el resumen de tarjeta que el extracto confirma', () => {
  it('marca la tarjeta pagada aunque el pago no coincida con el resumen', () => {
    // El caso real: el resumen decía $977.117 y se pagaron $2.731.870.
    const r = settleCardsFromStatement(
      [tarjeta('c1', 'Visa Bancolombia', 'PAGO SUC VIRT TC VISA')],
      [mov('2026-08-04', 'PAGO SUC VIRT TC VISA', 2731870)],
    )
    expect(r).toHaveLength(1)
    expect(r[0].target.label).toBe('Visa Bancolombia')
    expect(r[0].paidCents).toBe(273187000)
  })

  it('el mes que salda es el del pago, no el de hoy', () => {
    const r = settleCardsFromStatement(
      [tarjeta('c1', 'Visa Bancolombia', 'PAGO SUC VIRT TC VISA')],
      [mov('2026-07-04', 'PAGO SUC VIRT TC VISA', 2826621)],
    )
    expect(r[0].period).toBe('2026-07')
  })

  it('un extracto de varios meses salda un mes por pago', () => {
    const r = settleCardsFromStatement(
      [tarjeta('c1', 'Visa Bancolombia', 'PAGO SUC VIRT TC VISA')],
      [
        mov('2026-08-04', 'PAGO SUC VIRT TC VISA', 2731870),
        mov('2026-07-04', 'PAGO SUC VIRT TC VISA', 2826621),
      ],
    )
    expect(r.map((x) => x.period)).toEqual(['2026-08', '2026-07'])
  })

  it('no confunde el pago de la Falabella con una compra en Falabella', () => {
    const r = settleCardsFromStatement(
      [tarjeta('c1', 'Falabella CMR', 'PAGO PSE BANCO FALABELLA')],
      [mov('2026-08-08', 'COMPRA EN FALABELLA', 120000)],
    )
    expect(r).toHaveLength(0)
  })

  it('sin patrón configurado no adivina', () => {
    const r = settleCardsFromStatement(
      [tarjeta('c1', 'Tuya Éxito', '')],
      [mov('2026-08-04', 'PAGO SUC VIRT TC VISA', 2731870)],
    )
    expect(r).toHaveLength(0)
  })
})

describe('la cuota de préstamo que el extracto confirma', () => {
  it('cruza por importe exacto cuando no hay patrón', () => {
    const r = settleLoansFromStatement(
      [prestamo('l1', 'Crédito Bancolombia', 1748074)],
      [mov('2026-08-04', 'PAGO CREDITO SUC VIRTUAL', 1748074)],
    )
    expect(r).toHaveLength(1)
    expect(r[0].amountChanged).toBe(false)
  })

  it('el patrón y el importe son dos caminos, no uno u otro', () => {
    // La misma cuota sale un mes como "PAGO CREDITO SUC VIRTUAL" y otro como
    // "DEBITO POR ABONO CARTERA". El patrón cubre uno; el importe, el otro.
    const r = settleLoansFromStatement(
      [prestamo('l1', 'Crédito Bancolombia', 1748074, 'PAGO CREDITO SUC VIRTUAL')],
      [
        mov('2026-08-04', 'PAGO CREDITO SUC VIRTUAL', 1748074),
        mov('2026-06-04', 'DEBITO POR ABONO CARTERA', 1748074),
      ],
    )
    expect(r.map((x) => x.period)).toEqual(['2026-08', '2026-06'])
  })

  it('un importe parecido pero distinto no es la cuota', () => {
    const r = settleLoansFromStatement(
      [prestamo('l1', 'Crédito Bancolombia', 1748074)],
      [mov('2026-08-04', 'TRANSFERENCIA CTA SUC VIRTUAL', 1748000)],
    )
    expect(r).toHaveLength(0)
  })

  it('la tarjeta nunca cruza por importe', () => {
    const r = settleCardsFromStatement(
      [{ id: 'c1', label: 'Visa', pattern: '', amountCents: 97711700 }],
      [mov('2026-08-04', 'PAGO SUC VIRT TC VISA', 977117)],
    )
    expect(r).toHaveLength(0)
  })
})

describe('cada factura pertenece a un mes', () => {
  const conPeriodo = (id: string, name: string, pattern: string, period: string) => ({
    id,
    serviceName: name,
    pattern,
    amountCents: 11432700,
    period,
  })

  it('la factura de agosto no la paga un movimiento de 2024', () => {
    // Hay una sola factura por servicio y por mes, y el patrón matchea igual en
    // todo el historial: sin el filtro por período, el pago del gas de 2024
    // marcaba pagada —y con el importe equivocado— la factura de 2026.
    const r = settleBillsFromStatement(
      [conPeriodo('b1', 'Gases del Caribe', 'GASES DEL CARIBE', '2026-08')],
      [mov('2024-05-04', 'PAGO SV GASES DEL CARIBE S.A.', 133762)],
    )
    expect(r).toHaveLength(0)
  })

  it('la paga el movimiento de su propio mes', () => {
    const r = settleBillsFromStatement(
      [conPeriodo('b1', 'Gases del Caribe', 'GASES DEL CARIBE', '2026-08')],
      [
        mov('2024-05-04', 'PAGO SV GASES DEL CARIBE S.A.', 133762),
        mov('2026-08-04', 'PAGO SV GASES DEL CARIBE S.A.', 114327),
      ],
    )
    expect(r).toHaveLength(1)
    expect(r[0].paidCents).toBe(11432700)
  })

  it('sin período declarado sigue cruzando con cualquier mes', () => {
    const r = settleBillsFromStatement(
      [factura('b1', 'Air-e', 'ENERGIA AI', 809590)],
      [mov('2024-05-10', 'PAGO SV EMPRESA DE ENERGIA AI', 700000)],
    )
    expect(r).toHaveLength(1)
  })
})
