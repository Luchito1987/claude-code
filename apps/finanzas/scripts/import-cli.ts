/**
 * Importador por línea de comandos. Usa exactamente el mismo parser que la
 * pantalla "Importar" de la web; sirve para probar un archivo sin abrir el
 * navegador y para cargar varios de una.
 *
 *   npm run import -- --tipo cuenta   --destino "Caja de ahorro" --archivo extracto.csv
 *   npm run import -- --tipo tarjeta  --destino "Visa"           --archivo resumen.xlsx
 *   npm run import -- --tipo rappi    --archivo pedidos.txt
 *   npm run import -- --inspect       --archivo planilla.xlsx
 *
 * Con --dry muestra qué reconocería, sin escribir nada en la base.
 */

import { readFileSync } from 'node:fs'
import { getDb, id, now } from '../src/db/client'
import { fingerprint } from '../src/lib/parsers/statement'
import { decodeText, parseUploadedFile } from '../src/lib/parsers/input'
import { describeSheet, isSpreadsheet, readWorkbook } from '../src/lib/parsers/xlsx'
import { parseRappiCsv, parseRappiReceipts, rappiFingerprint } from '../src/lib/parsers/rappi'
import { formatMoney } from '../src/lib/money'
import { parseISO, todayISO } from '../src/lib/dates'

const args = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : undefined
}
const dry = args.includes('--dry')
const inspeccionar = args.includes('--inspect')

const tipo = (flag('tipo') ?? '').toLowerCase()
const destino = flag('destino') ?? ''
const archivo = flag('archivo')

const USO = `Uso:
  npm run import -- --tipo cuenta|tarjeta|gastos|rappi --archivo <ruta> [--destino "<nombre>"] [--dry]
  npm run import -- --inspect --archivo <ruta>

  --tipo      cuenta  = extracto de caja de ahorro / cuenta corriente
              tarjeta = resumen de tarjeta de crédito
              gastos  = planilla propia de gastos (importes positivos = gastos,
                        respeta tu columna de categoría)
              rappi   = mails de pedido o CSV/planilla de pedidos
  --destino   Nombre de la cuenta o tarjeta ya cargada (no hace falta para rappi)
  --archivo   .csv, .tsv, .txt o .xlsx
  --dry       Muestra el resultado sin escribir en la base
  --inspect   Muestra la estructura del archivo (hojas, filas, primeras celdas)
              sin interpretarlo. Para mirar una planilla desconocida.`

async function main(): Promise<number> {
  if (!archivo || (!inspeccionar && !['cuenta', 'tarjeta', 'gastos', 'rappi'].includes(tipo))) {
    console.error(USO)
    return 1
  }

  const contenido = readFileSync(archivo)
  const nombreArchivo = archivo.split('/').pop() ?? archivo
  const anio = parseISO(todayISO()).y

  if (inspeccionar) return inspect(archivo, contenido)
  if (tipo === 'rappi') return importarRappi(contenido, nombreArchivo, anio)
  return importarExtracto(contenido, nombreArchivo, anio)
}

// ------------------------------------------------------------------ inspect

async function inspect(ruta: string, contenido: Buffer): Promise<number> {
  if (isSpreadsheet(ruta)) {
    const hojas = await readWorkbook(contenido)
    console.log(`\n${ruta}: ${hojas.length} hoja(s)\n`)
    for (const hoja of hojas) console.log(`${describeSheet(hoja, 12).join('\n')}\n`)
    return 0
  }
  const lineas = decodeText(contenido).split(/\r?\n/)
  console.log(`\n${ruta}: ${lineas.length} líneas\n`)
  for (const l of lineas.slice(0, 25)) console.log(`  ${l.slice(0, 160)}`)
  if (lineas.length > 25) console.log(`  … ${lineas.length - 25} líneas más`)
  return 0
}

// -------------------------------------------------------------------- rappi

async function importarRappi(contenido: Buffer, nombreArchivo: string, anio: number): Promise<number> {
  const db = getDb()

  let texto: string
  if (isSpreadsheet(nombreArchivo)) {
    const hojas = await readWorkbook(contenido)
    texto = hojas.map((h) => h.rows.map((r) => r.join(',')).join('\n')).find((t) => t.trim()) ?? ''
  } else {
    texto = decodeText(contenido)
  }

  const pareceCsv = /(^|\n)[^\n]*(fecha|date)[^\n]*[;,\t][^\n]*(total|importe)/i.test(texto)
  const parsed = pareceCsv ? parseRappiCsv(texto, anio) : parseRappiReceipts(texto, anio)

  console.log(
    `\nPedidos reconocidos: ${parsed.orders.length}${parsed.skipped ? ` (${parsed.skipped} bloques ignorados)` : ''}`,
  )
  for (const o of parsed.orders.slice(0, 15)) {
    console.log(
      `  ${o.date}  ${o.store.padEnd(24).slice(0, 24)}  ${formatMoney(o.totalCents).padStart(12)}` +
        `  envío ${formatMoney(o.deliveryCents)}  propina ${formatMoney(o.tipCents)}`,
    )
  }
  if (parsed.orders.length > 15) console.log(`  … y ${parsed.orders.length - 15} más`)
  for (const w of parsed.warnings) console.log(`  aviso: ${w}`)

  if (!parsed.orders.length) return 1
  if (dry) {
    console.log('\n(--dry: no se escribió nada)')
    return 0
  }

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
      if (res.changes) nuevos++
      else repetidos++
    }
  })()
  console.log(`\nGuardados ${nuevos} pedidos${repetidos ? `, ${repetidos} ya estaban` : ''}.`)
  return 0
}

// ----------------------------------------------------------------- extracto

async function importarExtracto(contenido: Buffer, nombreArchivo: string, anio: number): Promise<number> {
  const db = getDb()
  const kind = tipo === 'tarjeta' ? 'card' : tipo === 'gastos' ? 'gastos' : 'account'
  const tabla = kind === 'card' ? 'cards' : 'accounts'
  const metodo = kind === 'card' ? 'credito' : kind === 'gastos' ? 'otro' : 'debito'

  const target = db
    .prepare(`SELECT id, name FROM ${tabla} WHERE lower(name) = lower(?) OR id = ?`)
    .get(destino, destino) as { id: string; name: string } | undefined

  if (!target) {
    const todas = db.prepare(`SELECT name FROM ${tabla}`).all() as Array<{ name: string }>
    console.error(
      `No encontré "${destino}" en ${kind === 'card' ? 'tarjetas' : 'cuentas'}.` +
        (todas.length ? ` Disponibles: ${todas.map((t) => t.name).join(', ')}` : ' Todavía no hay ninguna cargada.'),
    )
    return 1
  }

  const reglas = db.prepare('SELECT pattern, category, priority FROM category_rules').all() as Array<{
    pattern: string
    category: string
    priority: number
  }>

  const parsed = await parseUploadedFile(nombreArchivo, contenido, {
    kind,
    userRules: reglas,
    fallbackYear: anio,
  })

  console.log(`\nArchivo: ${nombreArchivo}`)
  console.log(
    `Formato: ${
      parsed.sheetName
        ? `planilla, hoja "${parsed.sheetName}"`
        : parsed.strategy === 'csv'
          ? 'CSV con encabezados'
          : 'texto por líneas'
    }`,
  )
  console.log(`Destino: ${target.name}`)
  console.log(
    `Movimientos reconocidos: ${parsed.rows.length}${parsed.skipped ? ` (${parsed.skipped} líneas ignoradas)` : ''}\n`,
  )

  for (const r of parsed.rows.slice(0, 20)) {
    console.log(
      `  ${r.date}  ${r.merchant.padEnd(30).slice(0, 30)}  ${formatMoney(r.amountCents).padStart(13)}  ${r.category}` +
        (r.installment ? `  cuota ${r.installment}` : ''),
    )
  }
  if (parsed.rows.length > 20) console.log(`  … y ${parsed.rows.length - 20} más`)
  for (const w of parsed.warnings) console.log(`  aviso: ${w}`)

  if (!parsed.rows.length) return 1

  const total = parsed.rows.reduce((a, r) => a + r.amountCents, 0)
  console.log(`\nTotal neto: ${formatMoney(total)}`)

  if (dry) {
    console.log('\n(--dry: no se escribió nada)')
    return 0
  }

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
      kind === 'card' ? null : target.id,
      nombreArchivo, parsed.rows[0].date.slice(0, 7), now(),
    )

    for (const r of parsed.rows) {
      const res = insertTx.run(
        id(), r.date, r.description, r.merchant, r.amountCents, r.currency, r.category,
        metodo,
        kind === 'card' ? null : target.id,
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
  return 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  },
)
