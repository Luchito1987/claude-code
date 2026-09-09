'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb, id, now } from '@/db/client'
import { currentUser } from '@/lib/auth'
import { fingerprint, parseStatement, type ParsedRow } from '@/lib/parsers/statement'
import {
  findAlreadyLoaded,
  settleBillsFromStatement,
  settleCardsFromStatement,
  settleLoansFromStatement,
  type PendingBill,
  type Reconcilable,
  type Settleable,
  type Settlement,
} from '@/lib/reconcile'
import { decodeText, parseUploadedFile, type FileParseResult } from '@/lib/parsers/input'
import { isSpreadsheet, readWorkbook } from '@/lib/parsers/xlsx'
import { parseRappiCsv, parseRappiReceipts, rappiFingerprint, type RappiOrder } from '@/lib/parsers/rappi'
import { listUserRules, markBillPaid, markMonthItemPaid, updateBillAmount } from '@/lib/queries'
import { formatMoney } from '@/lib/money'
import { financialMonth, todayISO, parseISO } from '@/lib/dates'
import { dueDateFor } from '@/lib/cashflow'

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
       account_id, card_id, statement_id, source, installment, billing_period, commitment, fingerprint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
  )

  /*
   * Mes de resumen. Es el ancla de las cuotas: una línea "3/6" en el resumen que
   * vence en agosto deja las cuotas 4, 5 y 6 en septiembre, octubre y noviembre.
   * Se deduce del último consumo del archivo, que siempre cae en el ciclo que
   * está cerrando.
   */
  let billingPeriod = ''
  // Si el extracto declara su vencimiento, ese manda: es el único dato que
  // ubica en el ciclo correcto a las compras viejas que siguen en cuotas.
  const statementDue = parsed.statementDueDate ?? ''
  if (kind === 'card' && statementDue) {
    billingPeriod = financialMonth(statementDue)
  } else if (kind === 'card') {
    const card = db.prepare('SELECT id, name, closing_day, due_day FROM cards WHERE id = ?').get(targetId) as
      | { id: string; name: string; closing_day: number; due_day: number }
      | undefined
    if (card) {
      const ultima = parsed.rows.reduce((max, r) => (r.date > max ? r.date : max), parsed.rows[0].date)
      billingPeriod = financialMonth(dueDateFor(card, ultima))
    }
  }

  /*
   * Qué compromisos del mes viene a confirmar este extracto. Se resuelve antes
   * de insertar nada porque el resultado decide con qué `commitment` entra cada
   * línea: una vez marcada, esa plata deja de contar como gasto variable —ya la
   * cuenta el bloque de la factura, la tarjeta o el préstamo.
   *
   * Solo aplica a extractos de cuenta: en un resumen de tarjeta los movimientos
   * son consumos, no pagos de compromisos.
   */
  const facturasPendientes =
    kind === 'account'
      ? (db
          .prepare(
            `SELECT b.id, b.period, s.name AS serviceName, s.match_pattern AS pattern, b.amount_cents AS amountCents
             FROM bills b JOIN services s ON s.id = b.service_id
             WHERE b.status <> 'pagado' AND s.match_pattern <> ''`,
          )
          .all() as PendingBill[])
      : []

  const tarjetas: Settleable[] =
    kind === 'account'
      ? (db
          .prepare(
            `SELECT id, name AS label, match_pattern AS pattern, 0 AS amountCents
             FROM cards WHERE match_pattern <> ''`,
          )
          .all() as Settleable[])
      : []

  const prestamos: Settleable[] =
    kind === 'account'
      ? (db
          .prepare(
            `SELECT id, name AS label, match_pattern AS pattern, installment_cents AS amountCents
             FROM loans WHERE active = 1`,
          )
          .all() as Settleable[])
      : []

  const conciliadas = settleBillsFromStatement(facturasPendientes, parsed.rows)
  const tarjetasPagas = settleCardsFromStatement(tarjetas, parsed.rows)
  const prestamosPagos = settleLoansFromStatement(prestamos, parsed.rows)

  /** Qué línea del extracto paga qué compromiso, por posición en el archivo. */
  const compromisoDeFila = new Map<number, string>()
  for (const c of conciliadas) compromisoDeFila.set(c.rowIndex, `factura:${c.target.id}`)
  for (const c of tarjetasPagas) compromisoDeFila.set(c.rowIndex, `tarjeta:${c.target.id}`)
  for (const c of prestamosPagos) compromisoDeFila.set(c.rowIndex, `prestamo:${c.target.id}`)

  /*
   * Lo que ya se cargó a mano (foto de ticket o alta rápida) y todavía no está
   * respaldado por ningún extracto. Si una línea del archivo coincide con
   * alguno de estos, es el mismo gasto llegando por el otro camino: se enlaza
   * en vez de insertarlo de nuevo.
   */
  const yaCargados = db
    .prepare(
      `SELECT id, date, amount_cents AS amountCents FROM transactions
       WHERE statement_id IS NULL AND source IN ('ticket', 'manual') AND amount_cents < 0`,
    )
    .all() as Reconcilable[]

  const conciliar = db.prepare('UPDATE transactions SET statement_id = ? WHERE id = ?')
  const yaApareados = new Set<string>()

  /*
   * Cuántas veces vimos un movimiento idéntico en este archivo. Un extracto
   * real trae seis cobros iguales el mismo día —uno por cada pago hecho— y sin
   * numerarlos comparten huella y solo entra el primero.
   */
  const repeticiones = new Map<string, number>()

  let inserted = 0
  let duplicates = 0
  let conciliados = 0
  let total = 0

  const run = db.transaction((rows: ParsedRow[]) => {
    db.prepare(
      `INSERT INTO statements (id, kind, card_id, account_id, file_name, period, due_date, total_cents, rows_count, imported_by, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
    ).run(
      statementId,
      kind,
      kind === 'card' ? targetId : null,
      kind === 'card' ? null : targetId,
      fileName,
      billingPeriod || (rows[0]?.date.slice(0, 7) ?? ''),
      statementDue,
      user.id,
      now(),
    )

    for (const [indice, row] of rows.entries()) {
      const compromiso = compromisoDeFila.get(indice) ?? ''

      // Antes de insertar: ¿este gasto ya se había cargado por foto o a mano?
      // Un pago de compromiso nunca se aparea contra un ticket suelto.
      const previo = compromiso ? null : findAlreadyLoaded(yaCargados, row, { used: yaApareados })
      if (previo) {
        conciliar.run(statementId, previo.id)
        yaApareados.add(previo.id)
        conciliados++
        continue
      }

      const clave = `${row.date}|${row.description.toLowerCase()}|${row.amountCents}`
      const ocurrencia = repeticiones.get(clave) ?? 0
      repeticiones.set(clave, ocurrencia + 1)

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
        billingPeriod,
        compromiso,
        fingerprint(row, sourceKey, ocurrencia),
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
    if (inserted === 0 && conciliados === 0) db.prepare('DELETE FROM statements WHERE id = ?').run(statementId)
  })

  run(parsed.rows)

  /*
   * Los compromisos que el extracto acaba de confirmar. Una cosa es el
   * compromiso (la factura, el resumen, la cuota) y otra la plata saliendo: sin
   * esto el tablero seguía diciendo "falta pagar" aunque el pago ya estuviera
   * importado.
   */
  for (const c of conciliadas) {
    // El banco tiene el importe real; la factura solía tener un estimado.
    if (c.amountChanged) updateBillAmount(c.bill.id, c.paidCents)
    markBillPaid(c.bill.id, true)
  }

  /*
   * En tarjetas y préstamos manda el extracto. El resumen decía $977.117 y
   * salieron $2.731.870 porque se pagó más que el mínimo: lo que movió la caja
   * es lo segundo, así que el mes se marca con ese número. Si quedó mal, se
   * corrige a mano desde el tablero.
   */
  for (const c of tarjetasPagas) markMonthItemPaid('tarjeta', c.target.id, c.period, c.paidCents, true)
  for (const c of prestamosPagos) markMonthItemPaid('prestamo', c.target.id, c.period, c.paidCents, true)

  /*
   * El saldo de la cuenta lo manda el banco, no la suma de lo que cargamos a
   * mano: los movimientos manuales lo van corrigiendo de a poco y siempre queda
   * corrido. Si el extracto trae la columna de saldo, el del movimiento más
   * nuevo pasa a ser el saldo de la cuenta.
   */
  let saldo: { antes: number; ahora: number; via: 'informado' | 'sumado' } | null = null
  let saldoViejo = false

  if (kind === 'account') {
    const cuenta = db.prepare('SELECT balance_cents FROM accounts WHERE id = ?').get(targetId) as
      | { balance_cents: number }
      | undefined

    if (cuenta) {
      let nuevo: number | null = null

      if (parsed.finalBalanceCents !== undefined) {
        /*
         * El archivo informa el saldo, pero a la fecha en que cierra: el
         * consolidado dice cuánto había el 31 de julio, no hoy. Así que se
         * arranca de ahí y se le suma todo lo posterior que ya esté cargado
         * —los tickets de agosto, el informe del mes en curso—, sin importar en
         * qué orden se hayan importado los archivos.
         */
        const posteriores = parsed.finalBalanceDate
          ? (
              db
                .prepare(
                  `SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions
                   WHERE account_id = ? AND date > ?`,
                )
                .get(targetId, parsed.finalBalanceDate) as { s: number }
            ).s
          : 0
        nuevo = parsed.finalBalanceCents + posteriores
        saldoViejo = posteriores !== 0
      } else if (total !== 0) {
        // Sin saldo informado —el informe del mes en curso no lo trae— se
        // arrastra el que había con lo que recién entró. Solo cuenta lo
        // insertado: los duplicados ya estaban y lo conciliado ya movió el
        // saldo cuando se cargó por foto o a mano.
        nuevo = cuenta.balance_cents + total
      }

      if (nuevo !== null && nuevo !== cuenta.balance_cents) {
        db.prepare('UPDATE accounts SET balance_cents = ?, updated_at = ? WHERE id = ?').run(nuevo, now(), targetId)
        saldo = {
          antes: cuenta.balance_cents,
          ahora: nuevo,
          via: parsed.finalBalanceCents !== undefined ? 'informado' : 'sumado',
        }
      }
    }
  }

  revalidatePath('/importar')
  revalidatePath('/config')
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
  if (conciliados)
    detail.push(
      `${conciliados} movimiento(s) ya los habías cargado por foto o a mano: se enlazaron a este extracto en vez de duplicarse.`,
    )
  if (saldo)
    detail.push(
      saldo.via === 'informado'
        ? `Saldo de la cuenta actualizado con el que informa el extracto: ${formatMoney(saldo.antes)} → ${formatMoney(saldo.ahora)}.`
        : `El archivo no informa saldo, así que se le sumaron los movimientos nuevos: ${formatMoney(saldo.antes)} → ${formatMoney(saldo.ahora)}.`,
    )
  if (conciliadas.length) {
    const corregidas = conciliadas.filter((c) => c.amountChanged)
    detail.push(
      `${conciliadas.length} factura(s) quedaron pagadas porque el extracto trae su pago: ${conciliadas
        .map((c) => c.bill.serviceName)
        .join(', ')}.`,
    )
    for (const c of corregidas)
      detail.push(
        `${c.bill.serviceName}: estaba en ${formatMoney(c.bill.amountCents)} y se pagó ${formatMoney(c.paidCents)}. Se corrigió con el importe del banco.`,
      )
  }
  const describir = (c: Settlement) => `${c.target.label} (${c.period}, ${formatMoney(c.paidCents)})`
  if (tarjetasPagas.length)
    detail.push(`Tarjeta(s) marcadas como pagadas con el pago que trae el extracto: ${tarjetasPagas.map(describir).join(', ')}.`)
  if (prestamosPagos.length)
    detail.push(`Cuota(s) de préstamo marcadas como pagadas: ${prestamosPagos.map(describir).join(', ')}.`)

  /*
   * Un pago de tarjeta que no se pudo atribuir es peor que no detectarlo: el
   * tablero sigue diciendo "vencido" sin explicar por qué. Mejor decirlo.
   */
  const tarjetasSinPatron = db
    .prepare("SELECT name FROM cards WHERE match_pattern = ''")
    .all() as Array<{ name: string }>
  const hayPagoDeTarjeta = parsed.rows.some((r) => r.category === 'pago_tarjeta')
  if (kind === 'account' && hayPagoDeTarjeta && tarjetasSinPatron.length)
    detail.push(
      `El extracto trae pagos de tarjeta, y estas todavía no tienen configurado cómo se llaman en el extracto: ${tarjetasSinPatron
        .map((t) => t.name)
        .join(', ')}. Cargalo en Config → Tarjetas para que se marquen solas.`,
    )
  if (saldoViejo && saldo)
    detail.push(
      `Este extracto cierra el ${parsed.finalBalanceDate}, así que al saldo que informa se le sumaron los movimientos posteriores que ya tenías cargados.`,
    )

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
