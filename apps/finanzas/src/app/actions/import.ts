'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb, id, now } from '@/db/client'
import { currentUser } from '@/lib/auth'
import { importarExtracto, type ImportState } from '@/lib/importar'
import { decodeText } from '@/lib/parsers/input'
import { isSpreadsheet, readWorkbook } from '@/lib/parsers/xlsx'
import { parseRappiCsv, parseRappiReceipts, rappiFingerprint, type RappiOrder } from '@/lib/parsers/rappi'
import { formatMoney } from '@/lib/money'
import { todayISO, parseISO } from '@/lib/dates'

export type { ImportState } from '@/lib/importar'

export async function importStatementAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const user = currentUser()
  if (!user) redirect('/login')
  return importarExtracto(form, user)
}

export async function importRappiAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const user = currentUser()
  if (!user) redirect('/login')

  const pasted = String(form.get('text') ?? '').trim()
  const file = form.get('file')
  let text = pasted
  let fileName = 'texto pegado'
  if (file instanceof File && file.size > 0) {
    fileName = file.name
    const buf = await file.arrayBuffer()
    if (isSpreadsheet(fileName)) {
      // Una planilla se aplana a CSV para reusar el mismo parser de pedidos.
      const hojas = await readWorkbook(buf)
      text = hojas
        .map((h) => h.rows.map((r) => r.join(',')).join('\n'))
        .find((t) => t.trim()) ?? ''
    } else {
      text = decodeText(buf)
    }
  }
  if (!text.trim()) return { error: 'Pegá los mails de los pedidos o subí el CSV.' }

  const year = parseISO(todayISO()).y
  const looksCsv = /(^|\n)[^\n]*(fecha|date)[^\n]*[;,\t][^\n]*(total|importe)/i.test(text)
  const parsed = looksCsv ? parseRappiCsv(text, year) : parseRappiReceipts(text, year)

  if (!parsed.orders.length) {
    return { error: 'No se reconoció ningún pedido.', detail: parsed.warnings }
  }

  const db = getDb()
  const statementId = id()
  let inserted = 0
  let duplicates = 0
  let total = 0

  const insertOrder = db.prepare(
    `INSERT INTO rappi_orders (id, date, store, total_cents, products_cents, delivery_cents, service_cents,
       tip_cents, items_count, vertical, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )

  const run = db.transaction((orders: RappiOrder[]) => {
    db.prepare(
      `INSERT INTO statements (id, kind, file_name, period, total_cents, rows_count, imported_by, imported_at)
       VALUES (?, 'rappi', ?, ?, 0, 0, ?, ?)`,
    ).run(statementId, fileName, orders[0]?.date.slice(0, 7) ?? '', user.id, now())

    for (const o of orders) {
      const res = insertOrder.run(
        id(),
        o.date,
        o.store,
        o.totalCents,
        o.productsCents,
        o.deliveryCents,
        o.serviceCents,
        o.tipCents,
        o.itemsCount,
        o.vertical,
        rappiFingerprint(o),
        now(),
      )
      if (res.changes) {
        inserted++
        total += o.totalCents
      } else {
        duplicates++
      }
    }
    db.prepare('UPDATE statements SET total_cents = ?, rows_count = ? WHERE id = ?').run(-total, inserted, statementId)
    if (inserted === 0) db.prepare('DELETE FROM statements WHERE id = ?').run(statementId)
  })

  run(parsed.orders)

  revalidatePath('/rappi')
  revalidatePath('/')

  const detail = [...parsed.warnings]
  if (parsed.skipped) detail.push(`${parsed.skipped} bloque(s) sin fecha o total se ignoraron.`)
  if (duplicates) detail.push(`${duplicates} pedido(s) ya estaban cargados.`)
  detail.push(
    'Los pedidos quedan como detalle de análisis. El impacto en la caja lo sigue dando el resumen de la tarjeta, ' +
      'así que no se duplica el gasto.',
  )

  return { ok: `${inserted} pedido(s) importados por ${formatMoney(total)}.`, detail }
}
