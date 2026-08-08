import { getDb, id, now } from '@/db/client'
import {
  addDays,
  addMonths,
  compare,
  currentWindow,
  financialMonth,
  formatMonthShort,
  iso,
  monthRange,
  nextMonths,
  nextPeriod,
  parseISO,
  todayISO,
  type ISODate,
} from './dates'
import {
  debtSummary,
  monthlyOutlook,
  pendingInstallments,
  pendingLoanInstallments,
  type DebtSummary,
  type FutureInstallment,
  type MonthOutlook,
} from './monthly'
import {
  cardDues as computeCardDues,
  dailyBurn,
  project,
  type CardDue,
  type Projection,
} from './cashflow'
import type { UserRule } from './categories'

export interface Account {
  id: string
  name: string
  kind: string
  currency: string
  balance_cents: number
  updated_at: string
}

export interface Card {
  id: string
  name: string
  issuer: string
  closing_day: number
  due_day: number
  limit_cents: number
  currency: string
}

export interface Service {
  id: string
  name: string
  provider: string
  category: string
  expected_amount_cents: number
  due_day: number
  active: number
  autodebit: number
  notes: string
  created_at: string
}

export interface Bill {
  id: string
  service_id: string
  name: string
  period: string
  amount_cents: number
  due_date: ISODate
  status: string
  paid_at: string | null
  estimated: number
  source: string
}

export interface Loan {
  id: string
  name: string
  lender: string
  principal_cents: number
  installment_cents: number
  installments_total: number
  installments_paid: number
  first_due_date: ISODate
  rate_annual: number
  active: number
}

export interface Income {
  id: string
  name: string
  owner: string
  amount_cents: number
  day_of_month: number
  active: number
}

export interface Transaction {
  id: string
  date: ISODate
  description: string
  merchant: string
  amount_cents: number
  currency: string
  category: string
  method: string
  account_id: string | null
  card_id: string | null
  statement_id: string | null
  source: string
  installment: string
  receipt_path: string
}

export interface RappiOrderRow {
  id: string
  date: ISODate
  store: string
  total_cents: number
  products_cents: number
  delivery_cents: number
  service_cents: number
  tip_cents: number
  items_count: number
  vertical: string
}

// ---------------------------------------------------------------- lecturas

export const listAccounts = (): Account[] =>
  getDb().prepare('SELECT * FROM accounts ORDER BY name').all() as Account[]

export const listCards = (): Card[] =>
  getDb().prepare('SELECT * FROM cards ORDER BY name').all() as Card[]

export const listServices = (onlyActive = false): Service[] =>
  getDb()
    .prepare(`SELECT * FROM services ${onlyActive ? 'WHERE active = 1' : ''} ORDER BY due_day, name`)
    .all() as Service[]

export const listLoans = (): Loan[] =>
  getDb().prepare('SELECT * FROM loans ORDER BY active DESC, name').all() as Loan[]

export const listIncomes = (): Income[] =>
  getDb().prepare('SELECT * FROM incomes ORDER BY day_of_month').all() as Income[]

export const listUserRules = (): UserRule[] =>
  getDb().prepare('SELECT pattern, category, priority FROM category_rules ORDER BY priority').all() as UserRule[]

export function listBills(period?: string): Bill[] {
  const sql = `
    SELECT b.*, s.name AS name
    FROM bills b JOIN services s ON s.id = b.service_id
    ${period ? 'WHERE b.period = ?' : ''}
    ORDER BY b.due_date, s.name`
  const stmt = getDb().prepare(sql)
  return (period ? stmt.all(period) : stmt.all()) as Bill[]
}

export function listBillsBetween(from: ISODate, to: ISODate): Bill[] {
  return getDb()
    .prepare(
      `SELECT b.*, s.name AS name
       FROM bills b JOIN services s ON s.id = b.service_id
       WHERE b.due_date BETWEEN ? AND ?
       ORDER BY b.due_date`,
    )
    .all(from, to) as Bill[]
}

export function listPendingBills(): Bill[] {
  return getDb()
    .prepare(
      `SELECT b.*, s.name AS name
       FROM bills b JOIN services s ON s.id = b.service_id
       WHERE b.status <> 'pagado'
       ORDER BY b.due_date`,
    )
    .all() as Bill[]
}

export function listTransactions(opts: { from?: ISODate; to?: ISODate; category?: string; limit?: number } = {}): Transaction[] {
  const where: string[] = []
  const args: unknown[] = []
  if (opts.from) {
    where.push('date >= ?')
    args.push(opts.from)
  }
  if (opts.to) {
    where.push('date <= ?')
    args.push(opts.to)
  }
  if (opts.category) {
    where.push('category = ?')
    args.push(opts.category)
  }
  const sql = `SELECT * FROM transactions ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY date DESC, created_at DESC ${opts.limit ? `LIMIT ${Number(opts.limit)}` : ''}`
  return getDb().prepare(sql).all(...args) as Transaction[]
}

export const listRappiOrders = (): RappiOrderRow[] =>
  getDb().prepare('SELECT * FROM rappi_orders ORDER BY date DESC').all() as RappiOrderRow[]

export function getSetting(key: string, fallback: string): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? fallback
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export const minBufferCents = (): number => Number(getSetting('min_buffer_cents', '0'))
export const horizonWeeks = (): number => Number(getSetting('horizon_weeks', '8'))

// ---------------------------------------------------------------- derivadas

export function totalCashCents(): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(balance_cents), 0) AS total FROM accounts WHERE currency = 'ARS'")
    .get() as { total: number }
  return row.total
}

export function monthlyIncomeCents(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM incomes WHERE active = 1')
    .get() as { total: number }
  return row.total
}

export function allCardDues(today: ISODate = todayISO(), since: ISODate = today): CardDue[] {
  const txs = getDb()
    .prepare('SELECT date, amount_cents, category, method, card_id FROM transactions WHERE card_id IS NOT NULL')
    .all() as Array<{ date: ISODate; amount_cents: number; category: string; method: string; card_id: string }>
  return listCards().flatMap((card) => computeCardDues(card, txs, today, since))
}

/** Resúmenes de tarjeta ya tildados como pagados, por mes financiero. */
function paidCardDues(): Set<string> {
  const rows = getDb()
    .prepare("SELECT ref_id, period FROM month_payments WHERE kind = 'tarjeta'")
    .all() as Array<{ ref_id: string; period: string }>
  return new Set(rows.map((r) => `${r.ref_id}:${r.period}`))
}

/**
 * Resúmenes que siguen debiéndose: los que no vencieron, más los del mes en
 * curso que vencieron y todavía no se tildaron como pagados.
 */
export function unpaidCardDues(today: ISODate = todayISO()): CardDue[] {
  const pagados = paidCardDues()
  const desde = monthRange(financialMonth(today)).start
  return allCardDues(today, desde).filter(
    (d) => !pagados.has(`${d.cardId}:${financialMonth(d.due_date)}`),
  )
}

export function currentBurnCents(today: ISODate = todayISO()): number {
  const txs = getDb()
    .prepare('SELECT date, amount_cents, category, method, card_id FROM transactions WHERE date >= ?')
    .all(addDays(today, -90)) as Array<{
    date: ISODate
    amount_cents: number
    category: string
    method: string
    card_id: string | null
  }>
  return dailyBurn(txs, today)
}

export function buildProjection(today: ISODate = todayISO(), weeks = horizonWeeks()): Projection {
  return project({
    today,
    weeks,
    openingCents: totalCashCents(),
    bills: listPendingBills().map((b) => ({
      id: b.id,
      name: b.name,
      due_date: b.due_date,
      amount_cents: b.amount_cents,
      status: b.status,
    })),
    loans: listLoans(),
    incomes: listIncomes(),
    cardDues: unpaidCardDues(today),
    dailyBurnCents: currentBurnCents(today),
    minBufferCents: minBufferCents(),
  })
}

// ---------------------------------------------------------------- escrituras

/**
 * Genera las facturas del período a partir de los servicios activos. Se crea una
 * fila estimada por servicio; después se confirma el importe real. Es idempotente:
 * no pisa lo que ya existe.
 */
export function ensureBillsForPeriod(period: string): { created: number } {
  const db = getDb()
  const [y, m] = period.split('-').map(Number)
  let created = 0

  const insert = db.prepare(
    `INSERT INTO bills (id, service_id, period, amount_cents, due_date, status, estimated, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'pendiente', 1, 'auto', ?)
     ON CONFLICT(service_id, period) DO NOTHING`,
  )

  const tx = db.transaction((services: Service[]) => {
    for (const s of services) {
      const amount = estimateServiceAmount(s, period)
      const res = insert.run(id(), s.id, period, amount, iso(y, m, s.due_day), now())
      created += res.changes
    }
  })
  tx(listServices(true))
  return { created }
}

/** Importe esperado: el fijo cargado, o el promedio de las últimas 3 facturas. */
function estimateServiceAmount(s: Service, period: string): number {
  if (s.expected_amount_cents > 0) return s.expected_amount_cents
  const rows = getDb()
    .prepare(
      `SELECT amount_cents FROM bills
       WHERE service_id = ? AND period < ? AND amount_cents > 0
       ORDER BY period DESC LIMIT 3`,
    )
    .all(s.id, period) as Array<{ amount_cents: number }>
  if (!rows.length) return 0
  return Math.round(rows.reduce((a, r) => a + r.amount_cents, 0) / rows.length)
}

/** Ventana vigente (28→15) con sus facturas, generándolas si faltan. */
export function billingWindowView(today: ISODate = todayISO()) {
  const window = currentWindow(today)
  ensureBillsForPeriod(window.period)
  const bills = listBills(window.period)
  return {
    window,
    bills,
    totalCents: bills.reduce((a, b) => a + b.amount_cents, 0),
    pendingCents: bills.filter((b) => b.status !== 'pagado').reduce((a, b) => a + b.amount_cents, 0),
    estimatedCount: bills.filter((b) => b.estimated === 1).length,
    nextPeriod: nextPeriod(window.period),
  }
}

export function markBillPaid(billId: string, paid: boolean): void {
  getDb()
    .prepare('UPDATE bills SET status = ?, paid_at = ? WHERE id = ?')
    .run(paid ? 'pagado' : 'pendiente', paid ? now() : null, billId)
}

export function updateBillAmount(billId: string, amountCents: number, dueDate?: ISODate): void {
  const db = getDb()
  if (dueDate) {
    db.prepare('UPDATE bills SET amount_cents = ?, due_date = ?, estimated = 0, source = ? WHERE id = ?').run(
      amountCents,
      dueDate,
      'manual',
      billId,
    )
  } else {
    db.prepare('UPDATE bills SET amount_cents = ?, estimated = 0, source = ? WHERE id = ?').run(
      amountCents,
      'manual',
      billId,
    )
  }
}

/** Próximas cuotas de cada préstamo, para mostrar en la pantalla de préstamos. */
export function loanProgress(loan: Loan) {
  const remaining = loan.installments_total - loan.installments_paid
  const nextDue = remaining > 0 ? addMonths(loan.first_due_date, loan.installments_paid) : null
  return {
    remaining,
    nextDue,
    outstandingCents: remaining * loan.installment_cents,
    paidCents: loan.installments_paid * loan.installment_cents,
    progress: loan.installments_total ? loan.installments_paid / loan.installments_total : 0,
  }
}

export function spendByCategory(from: ISODate, to: ISODate): Array<{ category: string; cents: number; count: number }> {
  return getDb()
    .prepare(
      `SELECT category, SUM(-amount_cents) AS cents, COUNT(*) AS count
       FROM transactions
       WHERE amount_cents < 0 AND date BETWEEN ? AND ?
         AND category <> 'pago_tarjeta'
       GROUP BY category ORDER BY cents DESC`,
    )
    .all(from, to) as Array<{ category: string; cents: number; count: number }>
}

export function monthlySpend(months = 6, today: ISODate = todayISO()): Array<{ period: string; cents: number }> {
  const { y, m } = parseISO(today)
  const from = iso(y, m, 1)
  const start = addMonths(from, -(months - 1))
  const rows = getDb()
    .prepare(
      `SELECT substr(date, 1, 7) AS period, SUM(-amount_cents) AS cents
       FROM transactions
       WHERE amount_cents < 0 AND date >= ? AND category NOT IN ('transferencias', 'pago_tarjeta')
       GROUP BY period ORDER BY period`,
    )
    .all(start) as Array<{ period: string; cents: number }>
  return rows
}

export function recentStatements(limit = 20) {
  return getDb()
    .prepare(
      `SELECT s.*, c.name AS card_name, a.name AS account_name, u.name AS user_name
       FROM statements s
       LEFT JOIN cards c ON c.id = s.card_id
       LEFT JOIN accounts a ON a.id = s.account_id
       LEFT JOIN users u ON u.id = s.imported_by
       ORDER BY s.imported_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string
    kind: string
    file_name: string
    period: string
    total_cents: number
    rows_count: number
    imported_at: string
    card_name: string | null
    account_name: string | null
    user_name: string | null
  }>
}

export function deleteStatement(statementId: string): void {
  getDb().prepare('DELETE FROM statements WHERE id = ?').run(statementId)
}

export function upcomingDues(days = 30, today: ISODate = todayISO()) {
  const to = addDays(today, days)
  const bills = listPendingBills()
    .filter((b) => compare(b.due_date, to) <= 0)
    .map((b) => ({ date: b.due_date, label: b.name, cents: b.amount_cents, kind: 'factura' as const }))
  const dues = allCardDues(today).filter((d) => compare(d.due_date, to) <= 0)
    .map((d) => ({ date: d.due_date, label: `Resumen ${d.name}`, cents: d.amount_cents, kind: 'tarjeta' as const }))
  const loans = listLoans()
    .filter((l) => l.active && l.installments_paid < l.installments_total)
    .map((l) => ({
      date: addMonths(l.first_due_date, l.installments_paid),
      label: `${l.name} · cuota ${l.installments_paid + 1}/${l.installments_total}`,
      cents: l.installment_cents,
      kind: 'prestamo' as const,
    }))
    .filter((l) => compare(l.date, to) <= 0)

  return [...bills, ...dues, ...loans].sort((a, b) => compare(a.date, b.date))
}

// ------------------------------------------------- mes financiero y deudas

export interface MonthItem {
  kind: 'factura' | 'tarjeta' | 'prestamo'
  refId: string
  label: string
  detail: string
  dueDate: ISODate
  cents: number
  paid: boolean
  estimated: boolean
}

/** Cuotas de tarjeta pendientes, leídas de los resúmenes ya importados. */
export function cardInstallments(today: ISODate = todayISO()): FutureInstallment[] {
  const txs = getDb()
    .prepare(
      `SELECT id, description, merchant, amount_cents, installment, card_id, billing_period, date
       FROM transactions
       WHERE card_id IS NOT NULL AND installment <> ''`,
    )
    .all() as Array<{
    id: string
    description: string
    merchant: string
    amount_cents: number
    installment: string
    card_id: string
    billing_period: string
    date: ISODate
  }>
  return pendingInstallments(txs, today)
}

function paidSet(period: string): Set<string> {
  const rows = getDb()
    .prepare('SELECT kind, ref_id FROM month_payments WHERE period = ?')
    .all(period) as Array<{ kind: string; ref_id: string }>
  return new Set(rows.map((r) => `${r.kind}:${r.ref_id}`))
}

/**
 * Todo lo que hay que pagar en un mes financiero: facturas de servicios,
 * resúmenes de tarjeta que vencen en el mes y cuotas de préstamo.
 */
export function monthItems(period: string, today: ISODate = todayISO()): MonthItem[] {
  const pagados = paidSet(period)
  const { start, end } = monthRange(period)

  const facturas: MonthItem[] = listBills(period).map((b) => ({
    kind: 'factura' as const,
    refId: b.id,
    label: b.name,
    detail: b.estimated === 1 ? 'importe estimado' : 'confirmada',
    dueDate: b.due_date,
    cents: b.amount_cents,
    paid: b.status === 'pagado',
    estimated: b.estimated === 1,
  }))

  const tarjetas: MonthItem[] = allCardDues(today, monthRange(period).start)
    .filter((d) => financialMonth(d.due_date) === period)
    .map((d) => ({
      kind: 'tarjeta' as const,
      refId: d.cardId,
      label: `Resumen ${d.name}`,
      detail: 'consumos del resumen importado',
      dueDate: d.due_date,
      cents: d.amount_cents,
      paid: pagados.has(`tarjeta:${d.cardId}`),
      estimated: false,
    }))

  const prestamos: MonthItem[] = pendingLoanInstallments(listLoans(), today)
    .filter((c) => c.period === period)
    .map((c) => {
      const loan = listLoans().find((l) => l.id === c.loanId)
      const fecha = loan ? addMonths(loan.first_due_date, c.number - 1) : end
      return {
        kind: 'prestamo' as const,
        refId: c.loanId,
        label: c.label,
        detail: 'cuota fija',
        dueDate: compare(fecha, start) < 0 ? start : fecha,
        cents: c.amountCents,
        paid: pagados.has(`prestamo:${c.loanId}`),
        estimated: false,
      }
    })

  return [...facturas, ...tarjetas, ...prestamos].sort((a, b) => compare(a.dueDate, b.dueDate))
}

export interface MonthSummary {
  period: string
  label: string
  start: ISODate
  end: ISODate
  availableCents: number
  pendingCents: number
  paidCents: number
  netCents: number
  items: MonthItem[]
  incomeCents: number
}

/** Los tres números de la primera pantalla, más el detalle del mes. */
export function monthSummary(today: ISODate = todayISO()): MonthSummary {
  const period = financialMonth(today)
  ensureBillsForPeriod(period)

  const items = monthItems(period, today)
  const pendingCents = items.filter((i) => !i.paid).reduce((a, i) => a + i.cents, 0)
  const paidCents = items.filter((i) => i.paid).reduce((a, i) => a + i.cents, 0)
  const availableCents = totalCashCents()
  const { start, end } = monthRange(period)

  return {
    period,
    label: formatMonthShort(period),
    start,
    end,
    availableCents,
    pendingCents,
    paidCents,
    netCents: availableCents - pendingCents,
    items,
    incomeCents: monthlyIncomeCents(),
  }
}

/** Estimación por servicio para los meses que todavía no tienen factura. */
function serviceEstimates(): Array<{ name: string; cents: number }> {
  const db = getDb()
  return listServices(true).map((s) => {
    if (s.expected_amount_cents > 0) return { name: s.name, cents: s.expected_amount_cents }
    const rows = db
      .prepare(
        `SELECT amount_cents FROM bills
         WHERE service_id = ? AND amount_cents > 0 AND estimated = 0
         ORDER BY period DESC LIMIT 3`,
      )
      .all(s.id) as Array<{ amount_cents: number }>
    const promedio = rows.length ? Math.round(rows.reduce((a, r) => a + r.amount_cents, 0) / rows.length) : 0
    return { name: s.name, cents: promedio }
  })
}

export function monthlyProjection(months = 6, today: ISODate = todayISO()): MonthOutlook[] {
  return monthlyOutlook({
    months: nextMonths(months, financialMonth(today)),
    bills: listBills().map((b) => ({
      name: b.name,
      period: b.period,
      amount_cents: b.amount_cents,
      estimated: b.estimated,
    })),
    serviceEstimates: serviceEstimates(),
    loans: listLoans(),
    installments: cardInstallments(today),
    cardDues: unpaidCardDues(today),
    incomeMonthlyCents: monthlyIncomeCents(),
    dailyBurnCents: currentBurnCents(today),
    today,
  })
}

export function debts(today: ISODate = todayISO()): DebtSummary {
  const resumen = debtSummary({
    cards: listCards().map((c) => ({ id: c.id, name: c.name })),
    loans: listLoans(),
    installments: cardInstallments(today),
    cardDues: unpaidCardDues(today),
    incomeMonthlyCents: monthlyIncomeCents(),
    today,
  })
  // El nombre de la entidad no viaja en el módulo de cálculo: se completa acá.
  const prestamos = listLoans()
  return {
    ...resumen,
    loans: resumen.loans.map((l) => ({
      ...l,
      lender: prestamos.find((p) => p.id === l.loanId)?.lender ?? '',
    })),
  }
}

export function markMonthItemPaid(kind: 'tarjeta' | 'prestamo', refId: string, period: string, cents: number, paid: boolean): void {
  const db = getDb()
  if (paid) {
    db.prepare(
      `INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    ).run(id(), kind, refId, period, cents, now())
  } else {
    db.prepare('DELETE FROM month_payments WHERE kind = ? AND ref_id = ? AND period = ?').run(kind, refId, period)
  }
}
