/**
 * Importador por línea de comandos. Hace exactamente lo mismo que la pantalla
 * "Importar" de la web, pero sirve para probar un archivo sin abrir el navegador
 * y para cargar varios de una.
 *
 *   npm run import -- --tipo cuenta   --destino "Caja de ahorro" --archivo extracto.csv
 *   npm run import -- --tipo tarjeta  --destino "Visa"           --archivo resumen.csv
 *   npm run import -- --tipo rappi    --archivo pedidos.txt
 *
 * Con --dry muestra qué reconocería, sin escribir nada en la base.
 */

import { readFileSync } from 'node:fs'
import { getDb, id, now } from '../src/db/client'
import { fingerprint, parseStatement } from '../src/lib/parsers/statement'
import { parseRappiCsv, parseRappiReceipts, rappiFingerprint } from '../src/lib/parsers/rappi'
import { formatMoney } from '../src/lib/money'
import { parseISO, todayISO } from '../src/lib/dates'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}
const dry = args.includes('--dry')

const tipo = (flag('tipo') ?? '').toLowerCase()
const destino = flag('destino') ?? ''
const archivo = flag('archivo')

if (!archivo || !['cuenta', 'tarjeta', 'rappi'].includes(tipo)) {
  console.error(`Uso:
  npm run import -- --tipo cuenta|tarjeta|rappi --archivo <ruta> [--destino "<nombre>"] [--dry]

  --tipo      cuenta  = extracto de caja de ahorro / cuenta corriente
              tarjeta = resumen de tarjeta de crédito
              rappi   = mails de pedido o CSV de pedidos
  --destino   Nombre de la cuenta o tarjeta ya cargada (no hace falta para rappi)
  --dry       Muestra el resultado sin escribir en la base`)
  process.exit(1)
}

/** Los home banking exportan tanto UTF-8 como Windows-1252. */
function leer(ruta: string): string {
  const buf = readFileSync(ruta)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf)
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

const db = getDb()
const texto = leer(archivo)
const anio = parseISO(todayISO()).y
const nombreArchivo = archivo.split('/').pop() ?? archivo

function resolverDestino(tabla: 'accounts' | 'cards'): { id: string; name: string } {
  const row = db
    .prepare(`SELECT id, name FROM ${tabla} WHERE lower(name) = lower(?) OR id = ?`)
    .get(destino, destino) as { id: string; name: string } | undefined
  if (row) return row

  const todas = db.prepare(`SELECT name FROM ${tabla}`).all() as Array<{ name: string }>
  console.error(
    `No encontré "${destino}" en ${tabla === 'cards' ? 'tarjetas' : 'cuentas'}.` +
      (todas.length ? ` Disponibles: ${todas.map((t) => t.name).join(', ')}` : ' Todavía no hay ninguna cargada.'),
  )
  process.exit(1)
}

if (tipo === 'rappi') {
  const pareceCsv = /(^|\n)[^\n]*(fecha|date)[^\n]*[;,\t][^\n]*(total|importe)/i.test(texto)
  const parsed = pareceCsv ? parseRappiCsv(texto, anio) : parseRappiReceipts(texto, anio)

  console.log(`\nPedidos reconocidos: ${parsed.orders.length}${parsed.skipped ? ` (${parsed.skipped} bloques ignorados)` : ''}`)
  for (const o of parsed.orders.slice(0, 15)) {
    console.log(
      `  ${o.date}  ${o.store.padEnd(24).slice(0, 24)}  ${formatMoney(o.totalCents).padStart(12)}` +
        `  envío ${formatMoney(o.deliveryCents)}  propina ${formatMoney(o.tipCents)}`,
    )
  }
  if (parsed.orders.length > 15) console.log(`  … y ${parsed.orders.length - 15} más`)
  for (const w of parsed.warnings) console.log(`  aviso: ${w}`)

  if (dry || !parsed.orders.length) process.exit(parsed.orders.length ? 0 : 1)

  const insert = db.prepare(
    `INSERT INTO rappi_orders (id, date, store, total_cents, products_cents, delivery_cents, service_cents,
       tip_cents, items_count, vertical, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  )
  let nuevos = 0
  let repetidos = 0
  db.transaction(() => {
    for (const o of parsed.orders) {
      const res = insert.run(
        id(), o.date, o.store, o.totalCents, o.productsCents, o.deliveryCents,
        o.serviceCents, o.tipCents, o.itemsCount, o.vertical, rappiFingerprint(o), now(),
      )
      res.changes ? nuevos++ : repetidos++
    }
  })()
  console.log(`\nGuardados ${nuevos} pedidos${repetidos ? `, ${repetidos} ya estaban` : ''}.`)
  process.exit(0)
}

const kind = tipo === 'tarjeta' ? 'card' : 'account'
const target = resolverDestino(kind === 'card' ? 'cards' : 'accounts')
const reglas = db.prepare('SELECT pattern, category, priority FROM category_rules').all() as Array<{
  pattern: string
  category: string
  priority: number
}>

const parsed = parseStatement(texto, { kind, userRules: reglas, fallbackYear: anio })

console.log(`\nArchivo: ${nombreArchivo}`)
console.log(`Formato: ${parsed.strategy === 'csv' ? 'CSV con encabezados' : 'texto por líneas'}`)
console.log(`Destino: ${target.name}`)
console.log(`Movimientos reconocidos: ${parsed.rows.length}${parsed.skipped ? ` (${parsed.skipped} líneas ignoradas)` : ''}\n`)

for (const r of parsed.rows.slice(0, 20)) {
  console.log(
    `  ${r.date}  ${r.merchant.padEnd(30).slice(0, 30)}  ${formatMoney(r.amountCents).padStart(13)}  ${r.category}` +
      (r.installment ? `  cuota ${r.installment}` : ''),
  )
}
if (parsed.rows.length > 20) console.log(`  … y ${parsed.rows.length - 20} más`)
for (const w of parsed.warnings) console.log(`  aviso: ${w}`)

const total = parsed.rows.reduce((a, r) => a + r.amountCents, 0)
console.log(`\nTotal neto: ${formatMoney(total)}`)

if (dry) {
  console.log('\n(--dry: no se escribió nada)')
  process.exit(parsed.rows.length ? 0 : 1)
}
if (!parsed.rows.length) process.exit(1)

const statementId = id()
const sourceKey = `${kind}:${target.id}`
const insertTx = db.prepare(
  `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
     account_id, card_id, statement_id, source, installment, fingerprint, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?) ON CONFLICT DO NOTHING`,
)

let nuevos = 0
let repetidos = 0
let neto = 0

db.transaction(() => {
  db.prepare(
    `INSERT INTO statements (id, kind, card_id, account_id, file_name, period, total_cents, rows_count, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(
    statementId, kind,
    kind === 'card' ? target.id : null,
    kind === 'account' ? target.id : null,
    nombreArchivo, parsed.rows[0].date.slice(0, 7), now(),
  )

  for (const r of parsed.rows) {
    const res = insertTx.run(
      id(), r.date, r.description, r.merchant, r.amountCents, r.currency, r.category,
      kind === 'card' ? 'credito' : 'debito',
      kind === 'account' ? target.id : null,
      kind === 'card' ? target.id : null,
      statementId, r.installment, fingerprint(r, sourceKey), now(),
    )
    if (res.changes) {
      nuevos++
      neto += r.amountCents
    } else {
      repetidos++
    }
  }

  db.prepare('UPDATE statements SET total_cents = ?, rows_count = ? WHERE id = ?').run(neto, nuevos, statementId)
  if (!nuevos) db.prepare('DELETE FROM statements WHERE id = ?').run(statementId)
})()

console.log(`\nGuardados ${nuevos} movimientos${repetidos ? `, ${repetidos} ya estaban importados` : ''}.`)
