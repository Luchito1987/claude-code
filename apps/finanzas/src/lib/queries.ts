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
import { NON_VARIABLE_CATEGORIES, type UserRule } from './categories'

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
  /** Cómo se llama el pago de esta tarjeta en el extracto de la cuenta. */
  match_pattern: string
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
  /** Cómo nombra el banco a este servicio en el extracto. */
  match_pattern: string
  created_at: string
}

export interface Bill {
  id: string
  service_id: string
  name: string
  /** Categoría del servicio que la origina. Separa "Servicios" de "Gastos fijos". */
  category: string
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
  /** Cómo se llama la cuota en el extracto. Vacío = se cruza por importe. */
  match_pattern: string
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
    SELECT b.*, s.name AS name, s.category AS category
    FROM bills b JOIN services s ON s.id = b.service_id
    ${period ? 'WHERE b.period = ?' : ''}
    ORDER BY b.due_date, s.name`
  const stmt = getDb().prepare(sql)
  return (period ? stmt.all(period) : stmt.all()) as Bill[]
}

export function listBillsBetween(from: ISODate, to: ISODate): Bill[] {
  return getDb()
    .prepare(
      `SELECT b.*, s.name AS name, s.category AS category
       FROM bills b JOIN services s ON s.id = b.service_id
       WHERE b.due_date BETWEEN ? AND ?
       ORDER BY b.due_date`,
    )
    .all(from, to) as Bill[]
}

export function listPendingBills(): Bill[] {
  return getDb()
    .prepare(
      `SELECT b.*, s.name AS name, s.category AS category
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
    .prepare('SELECT date, amount_cents, category, method, card_id, commitment FROM transactions WHERE date >= ?')
    .all(addDays(today, -90)) as Array<{
    date: ISODate
    amount_cents: number
    category: string
    method: string
    card_id: string | null
    commitment: string
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

/**
 * Da de alta un gasto que se repite todos los meses y deja saldado el mes en
 * curso. Es el atajo del tablero: crea el mismo servicio que se cargaría desde
 * Facturas, pidiendo lo mínimo.
 *
 * Si ya hay un servicio activo con ese nombre lo reutiliza, para que cargar dos
 * veces "Gimnasio" no termine en dos gastos fijos que suman doble.
 */
export function addFixedExpense(input: {
  name: string
  category: string
  amountCents: number
  date: ISODate
}): { serviceId: string; billId: string | null } {
  const db = getDb()
  const { name, category, amountCents, date } = input
  const period = financialMonth(date)

  const existente = db
    .prepare('SELECT id FROM services WHERE lower(name) = lower(?) AND active = 1')
    .get(name) as { id: string } | undefined

  let serviceId = existente?.id
  if (!serviceId) {
    serviceId = id()
    db.prepare(
      `INSERT INTO services (id, name, provider, category, expected_amount_cents, due_day, active, autodebit, notes, created_at)
       VALUES (?, ?, '', ?, ?, ?, 1, 0, '', ?)`,
    ).run(serviceId, name, category, amountCents, parseISO(date).d, now())
  }

  ensureBillsForPeriod(period)
  const bill = db.prepare('SELECT id FROM bills WHERE service_id = ? AND period = ?').get(serviceId, period) as
    | { id: string }
    | undefined
  if (!bill) return { serviceId, billId: null }

  // Confirma el importe (y lo deja rigiendo para los meses siguientes) y lo
  // marca pagado: se está registrando un gasto que ya se hizo.
  updateBillAmount(bill.id, amountCents)
  markBillPaid(bill.id, true)
  return { serviceId, billId: bill.id }
}

/**
 * Confirma el importe de una factura.
 *
 * En un gasto fijo el importe no cambia mes a mes: cuando cambia, cambia para
 * adelante (un aumento de expensas rige de ese mes en más). Así que el valor
 * nuevo pasa a ser el esperado del servicio y se propaga a los meses siguientes
 * que todavía están estimados. Un servicio medido —luz, agua, gas— varía todos
 * los meses, así que ahí el importe vale solo para su propio mes.
 *
 * Nunca pisa una factura ya confirmada: propaga solo sobre las estimadas.
 */
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

  const bill = db
    .prepare(
      `SELECT b.service_id, b.period, s.category
       FROM bills b JOIN services s ON s.id = b.service_id
       WHERE b.id = ?`,
    )
    .get(billId) as { service_id: string; period: string; category: string } | undefined
  if (!bill || billGroup(bill.category) !== 'fijo') return

  db.prepare('UPDATE services SET expected_amount_cents = ? WHERE id = ?').run(amountCents, bill.service_id)
  db.prepare(
    `UPDATE bills SET amount_cents = ?
     WHERE service_id = ? AND period > ? AND estimated = 1 AND status <> 'pagado'`,
  ).run(amountCents, bill.service_id, bill.period)
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

/**
 * Los cinco bloques en los que se divide el mes. `variable` no sale de una
 * factura: es lo que ya se gastó en el mes fuera de los compromisos.
 */
export type MonthGroup = 'tarjeta' | 'prestamo' | 'servicio' | 'fijo' | 'variable'

export const MONTH_GROUP_LABELS: Record<MonthGroup, string> = {
  tarjeta: 'Pagos de tarjetas de crédito',
  prestamo: 'Pagos de préstamos',
  servicio: 'Pago de servicios',
  fijo: 'Gastos fijos',
  variable: 'Gastos variables',
}

/** Orden en el que se muestran los bloques en el tablero. */
export const MONTH_GROUP_ORDER: MonthGroup[] = ['tarjeta', 'prestamo', 'servicio', 'fijo', 'variable']

/**
 * Una factura es "servicio" si el consumo cambia todos los meses (luz, agua,
 * gas). El resto de lo que se factura mes a mes por el mismo importe —
 * expensas, prepaga, colegio — es un gasto fijo.
 */
const SERVICE_CATEGORIES = new Set(['servicios'])

export const billGroup = (category: string): 'servicio' | 'fijo' =>
  SERVICE_CATEGORIES.has(category) ? 'servicio' : 'fijo'

export interface MonthItem {
  kind: 'factura' | 'tarjeta' | 'prestamo'
  group: MonthGroup
  refId: string
  label: string
  detail: string
  dueDate: ISODate
  cents: number
  paid: boolean
  estimated: boolean
  /** Solo las facturas se pueden reimportar a mano desde el tablero. */
  editable: boolean
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
    group: billGroup(b.category),
    refId: b.id,
    label: b.name,
    detail: b.estimated === 1 ? 'importe estimado' : 'confirmada',
    dueDate: b.due_date,
    cents: b.amount_cents,
    paid: b.status === 'pagado',
    estimated: b.estimated === 1,
    editable: true,
  }))

  const tarjetas: MonthItem[] = allCardDues(today, monthRange(period).start)
    .filter((d) => financialMonth(d.due_date) === period)
    .map((d) => ({
      kind: 'tarjeta' as const,
      group: 'tarjeta' as const,
      refId: d.cardId,
      label: `Resumen ${d.name}`,
      detail: 'consumos del resumen importado',
      dueDate: d.due_date,
      cents: d.amount_cents,
      paid: pagados.has(`tarjeta:${d.cardId}`),
      estimated: false,
      editable: false,
    }))

  const prestamos: MonthItem[] = pendingLoanInstallments(listLoans(), today)
    .filter((c) => c.period === period)
    .map((c) => {
      const loan = listLoans().find((l) => l.id === c.loanId)
      const fecha = loan ? addMonths(loan.first_due_date, c.number - 1) : end
      return {
        kind: 'prestamo' as const,
        group: 'prestamo' as const,
        refId: c.loanId,
        label: c.label,
        detail: 'cuota fija',
        dueDate: compare(fecha, start) < 0 ? start : fecha,
        cents: c.amountCents,
        paid: pagados.has(`prestamo:${c.loanId}`),
        estimated: false,
        editable: false,
      }
    })

  return [...facturas, ...tarjetas, ...prestamos].sort((a, b) => compare(a.dueDate, b.dueDate))
}

export interface VariableSpend {
  category: string
  cents: number
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
  /** Gasto variable ya hecho en el mes, por rubro. No entra en `pendingCents`. */
  variable: VariableSpend[]
  variableCents: number
}

/**
 * Lo que se gastó en el mes fuera de los compromisos: efectivo, débito y
 * transferencias. Deja afuera lo que se pagó con tarjeta, que ya viaja dentro
 * del resumen, y los rubros que tienen su propia línea (servicios, préstamos).
 *
 * `commitment` es el filtro que faltaba: el pago de la factura de luz aparece
 * en el extracto como un débito más, pero esa plata ya la cuenta el bloque de
 * servicios. Sin excluirlo se cobraba dos veces en el mismo tablero.
 */
export function variableSpend(period: string): VariableSpend[] {
  const { start, end } = monthRange(period)
  const excluidas = NON_VARIABLE_CATEGORIES.map(() => '?').join(', ')
  const rows = getDb()
    .prepare(
      `SELECT category, SUM(-amount_cents) AS cents
       FROM transactions
       WHERE date BETWEEN ? AND ?
         AND amount_cents < 0
         AND card_id IS NULL
         AND commitment = ''
         AND category NOT IN (${excluidas})
       GROUP BY category
       HAVING cents > 0
       ORDER BY cents DESC`,
    )
    .all(start, end, ...NON_VARIABLE_CATEGORIES) as VariableSpend[]
  return rows
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
  const variable = variableSpend(period)

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
    variable,
    variableCents: variable.reduce((a, v) => a + v.cents, 0),
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
