/**
 * Proyección de caja.
 *
 * Modelo (conservador y explícito, para que los números se puedan auditar):
 *  - El saldo inicial es la suma de las cuentas de dinero disponible.
 *  - Los compromisos ya conocidos (facturas pendientes, cuotas de préstamo,
 *    resúmenes de tarjeta ya importados) impactan el día que vencen.
 *  - El gasto variable futuro se proyecta como un consumo diario parejo
 *    calculado sobre el historial, y se cuenta el día que ocurre. Es decir: se
 *    asume que lo que se compra se paga, aunque vaya en tarjeta. Sobreestima un
 *    poco la salida de las primeras semanas, que es el lado seguro para
 *    decidir.
 *  - Los consumos de tarjeta ya importados NO se cuentan el día de la compra:
 *    solo se cuentan dentro del resumen, el día de su vencimiento.
 */

import {
  addDays,
  addMonths,
  compare,
  daysInMonth,
  diffDays,
  iso,
  parseISO,
  todayISO,
  type ISODate,
} from './dates'

export type EventKind = 'factura' | 'prestamo' | 'tarjeta' | 'ingreso' | 'variable' | 'manual'

export interface CashEvent {
  date: ISODate
  kind: EventKind
  label: string
  amountCents: number // negativo = salida
  refId?: string
}

export interface BillLike {
  id: string
  name: string
  due_date: ISODate
  amount_cents: number
  status: string
}

export interface LoanLike {
  id: string
  name: string
  installment_cents: number
  installments_total: number
  installments_paid: number
  first_due_date: ISODate
  active: number
}

export interface IncomeLike {
  id: string
  name: string
  amount_cents: number
  day_of_month: number
  active: number
}

export interface CardDue {
  cardId: string
  name: string
  due_date: ISODate
  amount_cents: number
}

export interface ProjectionInput {
  today?: ISODate
  weeks?: number
  openingCents: number
  bills: BillLike[]
  loans: LoanLike[]
  incomes: IncomeLike[]
  cardDues: CardDue[]
  dailyBurnCents: number
  minBufferCents: number
}

export interface WeekBucket {
  index: number
  start: ISODate
  end: ISODate
  openingCents: number
  inflowCents: number
  outflowCents: number
  closingCents: number
  minCents: number
  events: CashEvent[]
}

export interface Projection {
  today: ISODate
  horizonEnd: ISODate
  openingCents: number
  weeks: WeekBucket[]
  events: CashEvent[]
  /** Primer día en que el saldo perfora el colchón mínimo. */
  breachDate: ISODate | null
  /** Primer día en que el saldo se va a negativo. */
  negativeDate: ISODate | null
  lowestCents: number
  lowestDate: ISODate
  closingCents: number
  totalInflowCents: number
  totalOutflowCents: number
  committedCents: number
  projectedVariableCents: number
}

/** Cuotas de préstamo que todavía faltan pagar, dentro del rango. */
export function loanSchedule(loan: LoanLike, from: ISODate, to: ISODate): CashEvent[] {
  if (!loan.active) return []
  const out: CashEvent[] = []
  const remaining = loan.installments_total - loan.installments_paid
  for (let i = 0; i < remaining; i++) {
    const date = addMonths(loan.first_due_date, loan.installments_paid + i)
    if (compare(date, from) < 0) continue
    if (compare(date, to) > 0) break
    out.push({
      date,
      kind: 'prestamo',
      label: `${loan.name} · cuota ${loan.installments_paid + i + 1}/${loan.installments_total}`,
      amountCents: -Math.abs(loan.installment_cents),
      refId: loan.id,
    })
  }
  return out
}

export function incomeSchedule(income: IncomeLike, from: ISODate, to: ISODate): CashEvent[] {
  if (!income.active) return []
  const out: CashEvent[] = []
  const start = parseISO(from)
  let y = start.y
  let m = start.m
  for (let guard = 0; guard < 60; guard++) {
    const day = Math.min(income.day_of_month, daysInMonth(y, m))
    const date = iso(y, m, day)
    if (compare(date, to) > 0) break
    if (compare(date, from) >= 0) {
      out.push({
        date,
        kind: 'ingreso',
        label: income.name,
        amountCents: Math.abs(income.amount_cents),
        refId: income.id,
      })
    }
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export function project(input: ProjectionInput): Projection {
  const today = input.today ?? todayISO()
  const weeks = input.weeks ?? 8
  const horizonEnd = addDays(today, weeks * 7 - 1)

  const events: CashEvent[] = []

  for (const bill of input.bills) {
    if (bill.status === 'pagado') continue
    // Una factura vencida sigue siendo plata que hay que poner: se ancla a hoy.
    const date = compare(bill.due_date, today) < 0 ? today : bill.due_date
    if (compare(date, horizonEnd) > 0) continue
    events.push({
      date,
      kind: 'factura',
      label: bill.name + (compare(bill.due_date, today) < 0 ? ' (vencida)' : ''),
      amountCents: -Math.abs(bill.amount_cents),
      refId: bill.id,
    })
  }

  for (const loan of input.loans) events.push(...loanSchedule(loan, today, horizonEnd))
  for (const income of input.incomes) events.push(...incomeSchedule(income, today, horizonEnd))

  for (const due of input.cardDues) {
    if (due.amount_cents === 0) continue
    const date = compare(due.due_date, today) < 0 ? today : due.due_date
    if (compare(date, horizonEnd) > 0) continue
    events.push({
      date,
      kind: 'tarjeta',
      label: `Resumen ${due.name}`,
      amountCents: -Math.abs(due.amount_cents),
      refId: due.cardId,
    })
  }

  const burn = Math.abs(input.dailyBurnCents)
  if (burn > 0) {
    for (let d = 0; d < weeks * 7; d++) {
      events.push({
        date: addDays(today, d),
        kind: 'variable',
        label: 'Gasto variable proyectado',
        amountCents: -burn,
      })
    }
  }

  events.sort((a, b) => compare(a.date, b.date) || a.kind.localeCompare(b.kind))

  // Recorrido día a día para no perder el mínimo dentro de la semana.
  let balance = input.openingCents
  let lowest = balance
  let lowestDate = today
  let breachDate: ISODate | null = null
  let negativeDate: ISODate | null = null

  const buckets: WeekBucket[] = []
  for (let w = 0; w < weeks; w++) {
    const start = addDays(today, w * 7)
    const end = addDays(start, 6)
    const weekEvents = events.filter((e) => compare(e.date, start) >= 0 && compare(e.date, end) <= 0)
    const opening = balance
    let inflow = 0
    let outflow = 0
    let weekMin = balance

    for (let d = 0; d < 7; d++) {
      const day = addDays(start, d)
      for (const e of weekEvents) {
        if (e.date !== day) continue
        balance += e.amountCents
        if (e.amountCents > 0) inflow += e.amountCents
        else outflow += -e.amountCents
      }
      if (balance < weekMin) weekMin = balance
      if (balance < lowest) {
        lowest = balance
        lowestDate = day
      }
      if (breachDate === null && balance < input.minBufferCents) breachDate = day
      if (negativeDate === null && balance < 0) negativeDate = day
    }

    buckets.push({
      index: w,
      start,
      end,
      openingCents: opening,
      inflowCents: inflow,
      outflowCents: outflow,
      closingCents: balance,
      minCents: weekMin,
      events: weekEvents,
    })
  }

  const committed = events
    .filter((e) => e.amountCents < 0 && e.kind !== 'variable')
    .reduce((a, e) => a + -e.amountCents, 0)
  const variable = events
    .filter((e) => e.kind === 'variable')
    .reduce((a, e) => a + -e.amountCents, 0)

  return {
    today,
    horizonEnd,
    openingCents: input.openingCents,
    weeks: buckets,
    events,
    breachDate,
    negativeDate,
    lowestCents: lowest,
    lowestDate,
    closingCents: balance,
    totalInflowCents: events.filter((e) => e.amountCents > 0).reduce((a, e) => a + e.amountCents, 0),
    totalOutflowCents: committed + variable,
    committedCents: committed,
    projectedVariableCents: variable,
  }
}

export interface TxLike {
  date: ISODate
  amount_cents: number
  category: string
  method: string
  card_id?: string | null
  /**
   * Vencimiento del resumen donde apareció el movimiento, cuando el archivo lo
   * declara. Manda sobre la fecha de la compra: en un resumen con planes de
   * cuotas, una compra del año pasado se sigue pagando en el ciclo actual.
   */
  statement_due?: ISODate | null
}

/**
 * Consumo diario de gasto variable, promediado sobre los últimos `days` días.
 * Deja afuera transferencias e ingresos, y también los rubros comprometidos
 * (servicios, préstamos, impuestos) porque esos ya entran como eventos propios.
 */
export function dailyBurn(txs: TxLike[], today: ISODate = todayISO(), days = 90): number {
  const from = addDays(today, -days)
  // `pago_tarjeta` queda afuera: el consumo ya se cuenta en el resumen, sumarlo
  // otra vez como gasto duplicaría todo lo que pasa por la tarjeta.
  const excluded = new Set([
    'transferencias',
    'pago_tarjeta',
    'ingresos',
    'servicios',
    'prestamos',
    'impuestos',
    'educacion',
  ])
  let total = 0
  let earliest: ISODate | null = null
  for (const t of txs) {
    if (t.amount_cents >= 0) continue
    if (compare(t.date, from) < 0 || compare(t.date, today) > 0) continue
    if (excluded.has(t.category)) continue
    total += -t.amount_cents
    if (earliest === null || compare(t.date, earliest) < 0) earliest = t.date
  }
  if (!earliest) return 0
  // Se divide por los días que realmente cubre el historial: con un mes de datos
  // dividir por 90 subestimaría el consumo, que es el error caro.
  const span = Math.max(1, Math.min(days, diffDays(earliest, today) + 1))
  return Math.round(total / span)
}

export interface CardLike {
  id: string
  name: string
  closing_day: number
  due_day: number
}

/**
 * Resúmenes a pagar de cada tarjeta a partir de los consumos ya importados.
 * Un consumo entra en el ciclo que cierra el primer `closing_day` posterior;
 * ese resumen vence el `due_day` del mes siguiente al cierre.
 */
/**
 * Vencimiento del resumen donde cae una compra: cierra el primer `closing_day`
 * posterior a la compra y vence el primer `due_day` posterior al cierre.
 */
export function dueDateFor(card: CardLike, purchaseDate: ISODate): ISODate {
  const { y, m, d } = parseISO(purchaseDate)
  const closing = d <= card.closing_day ? iso(y, m, card.closing_day) : addMonths(iso(y, m, card.closing_day), 1)
  const c = parseISO(closing)
  const due = iso(c.y, c.m, card.due_day)
  return compare(due, closing) <= 0 ? addMonths(due, 1) : due
}

/**
 * Resúmenes a pagar. Por defecto solo los que todavía no vencieron: uno vencido
 * ya se pagó y ese pago aparece en el extracto de la cuenta. Con `since` se
 * puede pedir desde antes — la vista del mes lo usa para no perder de vista un
 * resumen que venció hace unos días y sigue impago.
 */
export function cardDues(
  card: CardLike,
  txs: TxLike[],
  today: ISODate = todayISO(),
  since: ISODate = today,
): CardDue[] {
  const byDue = new Map<ISODate, number>()

  for (const t of txs) {
    if (t.card_id !== card.id) continue
    if (t.amount_cents >= 0) continue
    const due = t.statement_due || dueDateFor(card, t.date)
    byDue.set(due, (byDue.get(due) ?? 0) + -t.amount_cents)
  }

  return [...byDue.entries()]
    .filter(([due]) => compare(due, since) >= 0)
    .map(([due_date, amount_cents]) => ({ cardId: card.id, name: card.name, due_date, amount_cents }))
    .sort((a, b) => compare(a.due_date, b.due_date))
}
