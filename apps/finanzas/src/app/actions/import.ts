'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb, id, now } from '@/db/client'
import { currentUser } from '@/lib/auth'
import { fingerprint, parseStatement, type ParsedRow } from '@/lib/parsers/statement'
import { decodeText, parseUploadedFile, type FileParseResult } from '@/lib/parsers/input'
import { isSpreadsheet, readWorkbook } from '@/lib/parsers/xlsx'
import { parseRappiCsv, parseRappiReceipts, rappiFingerprint, type RappiOrder } from '@/lib/parsers/rappi'
import { listUserRules } from '@/lib/queries'
import { formatMoney } from '@/lib/money'
import { todayISO, parseISO } from '@/lib/dates'

export interface ImportState {
  error?: string
  ok?: string
  detail?: string[]
}


export async function importStatementAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  const user = currentUser()
  if (!user) redirect('/login')

  const kind = String(form.get('kind') ?? 'account') as 'card' | 'account' | 'gastos'
  const targetId = String(form.get('target') ?? '')
  const pasted = String(form.get('text') ?? '').trim()
  const file = form.get('file')

  const opts = { kind, userRules: listUserRules(), fallbackYear: parseISO(todayISO()).y }

  let fileName = 'texto pegado'
  let parsed: FileParseResult
  if (file instanceof File && file.size > 0) {
    if (file.size > 8 * 1024 * 1024) return { error: 'El archivo supera los 8 MB.' }
    fileName = file.name
    parsed = await parseUploadedFile(fileName, await file.arrayBuffer(), opts)
  } else {
    if (!pasted) return { error: 'Subí un archivo o pegá el texto del extracto.' }
    parsed = parseStatement(pasted, opts)
  }
  if (!targetId) return { error: kind === 'card' ? 'Elegí la tarjeta.' : 'Elegí la cuenta.' }
  if (!parsed.rows.length) {
    return {
      error: 'No se reconoció ningún movimiento.',
      detail: parsed.warnings.length
        ? parsed.warnings
        : ['Probá exportando en CSV desde el home banking, o pegá el texto con una línea por movimiento.'],
    }
  }

  const db = getDb()
  const statementId = id()
  const sourceKey = `${kind}:${targetId}`

  const insertTx = db.prepare(
    `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
       account_id, card_id, statement_id, source, installment, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )

  let inserted = 0
  let duplicates = 0
  let total = 0

  const run = db.transaction((rows: ParsedRow[]) => {
    db.prepare(
      `INSERT INTO statements (id, kind, card_id, account_id, file_name, period, total_cents, rows_count, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    ).run(
      statementId,
      kind,
      kind === 'card' ? targetId : null,
      kind === 'card' ? null : targetId,
      fileName,
      rows[0]?.date.slice(0, 7) ?? '',
      user.id,
      now(),
    )

    for (const row of rows) {
      const res = insertTx.run(
        id(),
        row.date,
        row.description,
        row.merchant,
        row.amountCents,
        row.currency,
        row.category,
        kind === 'card' ? 'credito' : kind === 'gastos' ? 'otro' : 'debito',
        kind === 'card' ? null : targetId,
        kind === 'card' ? targetId : null,
        statementId,
        row.installment,
        fingerprint(row, sourceKey),
        now(),
      )
      if (res.changes) {
        inserted++
        total += row.amountCents
      } else {
        duplicates++
      }
    }

    db.prepare('UPDATE statements SET total_cents = ?, rows_count = ? WHERE id = ?').run(total, inserted, statementId)
    if (inserted === 0) db.prepare('DELETE FROM statements WHERE id = ?').run(statementId)
  })

  run(parsed.rows)

  revalidatePath('/importar')
  revalidatePath('/gastos')
  revalidatePath('/')

  const detail = [
    parsed.sheetName
      ? `Planilla leída, hoja "${parsed.sheetName}".`
      : `Formato detectado: ${parsed.strategy === 'csv' ? 'CSV con encabezados' : 'texto por líneas'}.`,
    `${parsed.skipped} línea(s) sin fecha o importe se ignoraron.`,
    ...parsed.warnings,
  ]
  if (duplicates) detail.push(`${duplicates} movimiento(s) ya estaban importados y no se duplicaron.`)

  return {
    ok: `${inserted} movimiento(s) importados por ${formatMoney(Math.abs(total))}.`,
    detail,
  }
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
