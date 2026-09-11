/**
 * Reprocesa los movimientos ya cargados con las reglas de categorización
 * actuales, y vuelve a cruzar los compromisos del mes contra ellos.
 *
 * Hace falta porque las reglas viven en el código: cuando se agregan reglas
 * nuevas —las de Bancolombia, por ejemplo— solo mejoran las importaciones que
 * vengan después. Todo lo que ya estaba en la base sigue con la categoría que
 * le tocó el día que entró, y en un tablero eso se ve como un "Otros" gigante.
 *
 *   npm run recategorize -- --dry            # muestra qué cambiaría, no toca nada
 *   npm run recategorize                     # aplica
 *   npm run recategorize -- --db /ruta.db    # sobre otra base (una copia)
 *
 * No toca lo que se cargó a mano: solo los movimientos importados
 * (`source = 'import'`), que son los que salieron de una regla.
 */

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const dbIndex = args.indexOf('--db')
if (dbIndex >= 0 && args[dbIndex + 1]) process.env.SQLITE_PATH = args[dbIndex + 1]

// Estos imports no abren la base: `getDb()` la abre recién cuando se lo llama,
// así que alcanza con haber fijado SQLITE_PATH antes de la primera llamada.
import { getDb, id, now } from '../src/db/client'
import { categorize, CATEGORY_LABELS, NON_VARIABLE_CATEGORIES } from '../src/lib/categories'
import { formatMoney } from '../src/lib/money'
import { financialMonth, monthRange } from '../src/lib/dates'
import {
  settleBillsFromStatement,
  settleCardsFromStatement,
  settleLoansFromStatement,
  type PendingBill,
  type Settleable,
} from '../src/lib/reconcile'

interface Row {
  id: string
  date: string
  description: string
  amount_cents: number
  category: string
  commitment: string
  method: string
}

const db = getDb()

const userRules = db
  .prepare('SELECT pattern, category, priority FROM category_rules ORDER BY priority')
  .all() as Array<{ pattern: string; category: string; priority: number }>

const rows = db
  .prepare(
    `SELECT id, date, description, amount_cents, category, commitment, method
     FROM transactions WHERE source = 'import' ORDER BY date`,
  )
  .all() as Row[]

const etiqueta = (c: string): string => CATEGORY_LABELS[c] ?? c

console.log(`${rows.length} movimiento(s) importados en la base.\n`)

// --------------------------------------------------------------- categorías

/*
 * Dos movimientos no se tocan nunca:
 *
 *  - Los de la planilla propia (`method = 'otro'`), donde la categoría la puso
 *    el usuario en su columna. "Comida para Juli" es Supermercado porque él lo
 *    dijo, y ninguna regla va a deducir eso de la descripción.
 *  - Los que las reglas no saben clasificar. Que una regla nueva no enganche no
 *    es motivo para degradar a "Otros" algo que ya estaba mejor clasificado.
 */
const cambios: Array<{ row: Row; antes: string; ahora: string }> = []
let intocables = 0
for (const row of rows) {
  if (row.method === 'otro') {
    intocables++
    continue
  }
  const ahora = categorize(row.description, userRules)
  if (ahora === row.category || ahora === 'otros') continue
  cambios.push({ row, antes: row.category, ahora })
}

const porPar = new Map<string, { n: number; cents: number; ejemplo: string }>()
for (const c of cambios) {
  const clave = `${c.antes}\t${c.ahora}`
  const e = porPar.get(clave) ?? { n: 0, cents: 0, ejemplo: c.row.description }
  e.n++
  e.cents += Math.abs(c.row.amount_cents)
  porPar.set(clave, e)
}

console.log(
  `== Categorías: ${cambios.length} movimiento(s) cambian ` +
    `(${intocables} de tu planilla quedan como están) ==`,
)
for (const [clave, e] of [...porPar].sort((a, b) => b[1].cents - a[1].cents)) {
  const [antes, ahora] = clave.split('\t')
  console.log(
    `  ${etiqueta(antes).padEnd(17)} → ${etiqueta(ahora).padEnd(17)} ${String(e.n).padStart(4)} mov ` +
      `${formatMoney(e.cents).padStart(16)}   ej: ${e.ejemplo}`,
  )
}

// ------------------------------------------------------------- compromisos

/*
 * El mismo cruce que hace el importador, pero contra lo que ya está en la
 * base: qué movimiento paga qué factura, qué resumen y qué cuota. Marcarlo es
 * lo que lo saca de "gastos variables", donde estaba contándose por segunda vez.
 */
const statementRows = rows.map((r) => ({
  date: r.date,
  description: r.description,
  amountCents: r.amount_cents,
}))

const facturas = db
  .prepare(
    `SELECT b.id, b.period, s.name AS serviceName, s.match_pattern AS pattern, b.amount_cents AS amountCents
     FROM bills b JOIN services s ON s.id = b.service_id
     WHERE s.match_pattern <> ''`,
  )
  .all() as PendingBill[]

const tarjetas = db
  .prepare(
    `SELECT id, name AS label, match_pattern AS pattern, 0 AS amountCents
     FROM cards WHERE match_pattern <> ''`,
  )
  .all() as Settleable[]

const prestamos = db
  .prepare(
    `SELECT id, name AS label, match_pattern AS pattern, installment_cents AS amountCents
     FROM loans WHERE active = 1`,
  )
  .all() as Settleable[]

const pagosFactura = settleBillsFromStatement(facturas, statementRows)
const pagosTarjeta = settleCardsFromStatement(tarjetas, statementRows)
const pagosPrestamo = settleLoansFromStatement(prestamos, statementRows)

const marcas = new Map<string, string>()
const detalle: string[] = []
for (const s of pagosFactura) {
  marcas.set(rows[s.rowIndex].id, `factura:${s.target.id}`)
  detalle.push(`  factura   ${s.target.label.padEnd(30)} ${s.period}  ${formatMoney(s.paidCents).padStart(15)}`)
}
for (const s of pagosTarjeta) {
  marcas.set(rows[s.rowIndex].id, `tarjeta:${s.target.id}`)
  detalle.push(`  tarjeta   ${s.target.label.padEnd(30)} ${s.period}  ${formatMoney(s.paidCents).padStart(15)}`)
}
for (const s of pagosPrestamo) {
  marcas.set(rows[s.rowIndex].id, `prestamo:${s.target.id}`)
  detalle.push(`  préstamo  ${s.target.label.padEnd(30)} ${s.period}  ${formatMoney(s.paidCents).padStart(15)}`)
}

const yaMarcados = rows.filter((r) => r.commitment).length
console.log(`\n== Compromisos: ${marcas.size} pago(s) identificados (${yaMarcados} ya estaban marcados) ==`)
for (const linea of detalle.sort()) console.log(linea)

// ------------------------------------------------------------------ aplicar

const updateCat = db.prepare('UPDATE transactions SET category = ? WHERE id = ?')
const updateCom = db.prepare('UPDATE transactions SET commitment = ? WHERE id = ?')
const markBill = db.prepare("UPDATE bills SET status = 'pagado', amount_cents = ? WHERE id = ?")
const markMonth = db.prepare(
  `INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at)
   VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
)

/**
 * Corta la transacción para deshacerla. En `--dry` se escribe igual y se
 * revierte al final: es la única forma de mostrar el resultado de verdad en
 * lugar de una estimación de lo que pasaría.
 */
class Rollback extends Error {}

try {
  db.transaction(() => {
    for (const c of cambios) updateCat.run(c.ahora, c.row.id)
    for (const [txId, commitment] of marcas) updateCom.run(commitment, txId)
    for (const s of pagosFactura) markBill.run(s.paidCents, s.target.id)
    for (const s of pagosTarjeta) markMonth.run(id(), 'tarjeta', s.target.id, s.period, s.paidCents, now())
    for (const s of pagosPrestamo) markMonth.run(id(), 'prestamo', s.target.id, s.period, s.paidCents, now())

    // --------------------------------------------------------------- efecto
    const period = financialMonth()
    const { start, end } = monthRange(period)
    const excluidas = NON_VARIABLE_CATEGORIES.map(() => '?').join(', ')
    const variable = db
      .prepare(
        `SELECT category, SUM(-amount_cents) AS cents FROM transactions
         WHERE date BETWEEN ? AND ? AND amount_cents < 0 AND card_id IS NULL AND commitment = ''
           AND category NOT IN (${excluidas})
         GROUP BY category HAVING cents > 0 ORDER BY cents DESC`,
      )
      .all(start, end, ...NON_VARIABLE_CATEGORIES) as Array<{ category: string; cents: number }>

    console.log(`\n== Gastos variables de ${period}${dry ? ', como quedarían' : ''} ==`)
    for (const v of variable) console.log(`  ${etiqueta(v.category).padEnd(17)} ${formatMoney(v.cents).padStart(16)}`)
    console.log(`  ${'TOTAL'.padEnd(17)} ${formatMoney(variable.reduce((a, v) => a + v.cents, 0)).padStart(16)}`)

    if (dry) throw new Rollback()
  })()
  console.log(`\nListo: ${cambios.length} categoría(s) y ${marcas.size} compromiso(s) actualizados.`)
} catch (e) {
  if (!(e instanceof Rollback)) throw e
  console.log('\n--dry: se revirtió todo, la base quedó igual que antes.')
}
