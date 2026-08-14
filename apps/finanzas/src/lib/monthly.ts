/**
 * Visión por mes financiero: qué se paga cada mes, cuánto se debe y hasta cuándo.
 *
 * La pieza que faltaba son las cuotas de tarjeta. Un resumen que dice
 * "ZARA 3/6  $25.000" no es un gasto de $25.000: son $25.000 este mes y otros
 * tres meses más. Sin eso, la proyección a seis meses no sirve para nada.
 */

import {
  addMonths,
  financialMonth,
  monthRange,
  nextPeriod,
  todayISO,
  type ISODate,
} from './dates'
import type { CardDue } from './cashflow'

export interface InstallmentTx {
  id: string
  description: string
  merchant: string
  amount_cents: number
  installment: string
  card_id: string | null
  /** Mes de resumen donde apareció. Si falta, se deduce de la fecha. */
  billing_period?: string | null
  date: ISODate
}

export interface FutureInstallment {
  period: string
  cardId: string
  label: string
  amountCents: number
  number: number
  total: number
}

/** Lee "3/6", "3 de 6", "03/06". Devuelve null si no es una cuota. */
export function parseInstallment(raw: string): { n: number; total: number } | null {
  const m = raw.match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i)
  if (!m) return null
  const n = Number(m[1])
  const total = Number(m[2])
  if (!n || !total || n > total) return null
  return { n, total }
}

/**
 * Cuotas que todavía no se pagaron, mes a mes. La cuota `n` de `N` que aparece
 * en el resumen del mes M deja las cuotas n+1..N en los meses M+1..M+(N-n).
 */
export function pendingInstallments(txs: InstallmentTx[], today: ISODate = todayISO()): FutureInstallment[] {
  const desde = financialMonth(today)
  const out: FutureInstallment[] = []

  for (const tx of txs) {
    if (!tx.card_id || tx.amount_cents >= 0) continue
    const cuota = parseInstallment(tx.installment)
    if (!cuota || cuota.n >= cuota.total) continue

    const ancla = tx.billing_period || financialMonth(tx.date)
    const monto = Math.abs(tx.amount_cents)

    for (let k = 1; k <= cuota.total - cuota.n; k++) {
      const period = nextPeriod(ancla, k)
      if (period < desde) continue
      out.push({
        period,
        cardId: tx.card_id,
        label: tx.merchant || tx.description,
        amountCents: monto,
        number: cuota.n + k,
        total: cuota.total,
      })
    }
  }

  return out.sort((a, b) => a.period.localeCompare(b.period) || b.amountCents - a.amountCents)
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

export interface LoanInstallment {
  period: string
  loanId: string
  label: string
  amountCents: number
  number: number
  total: number
}

/** Cuotas de préstamo pendientes, ubicadas en su mes financiero. */
export function pendingLoanInstallments(loans: LoanLike[], today: ISODate = todayISO()): LoanInstallment[] {
  const desde = financialMonth(today)
  const out: LoanInstallment[] = []

  for (const loan of loans) {
    if (!loan.active) continue
    const faltan = loan.installments_total - loan.installments_paid
    for (let i = 0; i < faltan; i++) {
      const numero = loan.installments_paid + i + 1
      const fecha = addMonths(loan.first_due_date, loan.installments_paid + i)
      const period = financialMonth(fecha)
      // Una cuota atrasada se sigue debiendo: se ancla al mes en curso.
      const mes = period < desde ? desde : period
      out.push({
        period: mes,
        loanId: loan.id,
        label: `${loan.name} · cuota ${numero}/${loan.installments_total}`,
        amountCents: Math.abs(loan.installment_cents),
        number: numero,
        total: loan.installments_total,
      })
    }
  }
  return out.sort((a, b) => a.period.localeCompare(b.period))
}

/**
 * Cuotas que ya se pagaron y caen en un mes dado.
 *
 * Hace falta porque `pendingLoanInstallments` solo devuelve lo que falta pagar:
 * en cuanto la cuota del mes quedaba saldada, el préstamo desaparecía entero de
 * la lista del mes —a diferencia de una factura o un resumen de tarjeta, que se
 * quedan tildados—. Desde el tablero eso se lee como que el préstamo no se paga
 * este mes, justo cuando acaba de pagarse.
 *
 * No filtra por `active`: una cuota pagada es un hecho del mes en que salió, y
 * dar de baja el préstamo después no la borra.
 */
export function settledLoanInstallments(loans: LoanLike[], period: string): LoanInstallment[] {
  const out: LoanInstallment[] = []
  for (const loan of loans) {
    for (let numero = 1; numero <= loan.installments_paid; numero++) {
      if (financialMonth(addMonths(loan.first_due_date, numero - 1)) !== period) continue
      out.push({
        period,
        loanId: loan.id,
        label: `${loan.name} · cuota ${numero}/${loan.installments_total}`,
        amountCents: Math.abs(loan.installment_cents),
        number: numero,
        total: loan.installments_total,
      })
    }
  }
  return out
}

export interface MonthOutlook {
  period: string
  serviciosCents: number
  serviciosEstimados: boolean
  prestamosCents: number
  tarjetasCents: number
  tarjetasEstimadas: boolean
  variableCents: number
  totalCents: number
  ingresosCents: number
  netoCents: number
  detalle: {
    servicios: Array<{ label: string; cents: number; estimado: boolean }>
    prestamos: Array<{ label: string; cents: number }>
    tarjetas: Array<{ label: string; cents: number; estimado: boolean }>
  }
}

export interface OutlookInput {
  months: string[]
  /** Facturas ya generadas, con su período. */
  bills: Array<{ name: string; period: string; amount_cents: number; estimated: number }>
  /** Estimación por servicio activo, para los meses que todavía no tienen factura. */
  serviceEstimates: Array<{ name: string; cents: number }>
  loans: LoanLike[]
  installments: FutureInstallment[]
  /** Resúmenes de tarjeta ya importados, con su vencimiento real. */
  cardDues: Array<CardDue & { cardId: string }>
  incomeMonthlyCents: number
  dailyBurnCents: number
  today?: ISODate
}

/**
 * Gasto proyectado mes a mes. Para cada concepto se usa el dato real cuando
 * existe y la estimación cuando no; el resultado marca cuál es cuál para que se
 * pueda leer con la desconfianza justa.
 */
export function monthlyOutlook(input: OutlookInput): MonthOutlook[] {
  const today = input.today ?? todayISO()

  const billsPorMes = new Map<string, typeof input.bills>()
  for (const b of input.bills) {
    const lista = billsPorMes.get(b.period) ?? []
    lista.push(b)
    billsPorMes.set(b.period, lista)
  }

  const cuotasPorMes = new Map<string, FutureInstallment[]>()
  for (const c of input.installments) {
    const lista = cuotasPorMes.get(c.period) ?? []
    lista.push(c)
    cuotasPorMes.set(c.period, lista)
  }

  const prestamos = pendingLoanInstallments(input.loans, today)
  const prestamosPorMes = new Map<string, LoanInstallment[]>()
  for (const p of prestamos) {
    const lista = prestamosPorMes.get(p.period) ?? []
    lista.push(p)
    prestamosPorMes.set(p.period, lista)
  }

  // Resúmenes reales por mes y por tarjeta: cuando existe uno, manda sobre la
  // proyección de cuotas, que sería contar dos veces la misma cuota.
  const resumenesPorMes = new Map<string, Array<CardDue & { cardId: string }>>()
  for (const d of input.cardDues) {
    const period = financialMonth(d.due_date)
    const lista = resumenesPorMes.get(period) ?? []
    lista.push(d)
    resumenesPorMes.set(period, lista)
  }

  return input.months.map((period) => {
    const { start, end } = monthRange(period)
    const dias = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1

    const facturas = billsPorMes.get(period) ?? []
    const servicios = facturas.length
      ? facturas.map((b) => ({ label: b.name, cents: b.amount_cents, estimado: b.estimated === 1 }))
      : input.serviceEstimates.map((s) => ({ label: s.name, cents: s.cents, estimado: true }))

    const cuotasPrestamo = (prestamosPorMes.get(period) ?? []).map((p) => ({
      label: p.label,
      cents: p.amountCents,
    }))

    const resumenes = resumenesPorMes.get(period) ?? []
    const conResumen = new Set(resumenes.map((r) => r.cardId))
    const cuotasProyectadas = (cuotasPorMes.get(period) ?? []).filter((c) => !conResumen.has(c.cardId))

    const tarjetas = [
      ...resumenes.map((r) => ({ label: `Resumen ${r.name}`, cents: r.amount_cents, estimado: false })),
      ...cuotasProyectadas.map((c) => ({
        label: `${c.label} · cuota ${c.number}/${c.total}`,
        cents: c.amountCents,
        estimado: true,
      })),
    ]

    const suma = (xs: Array<{ cents: number }>) => xs.reduce((a, x) => a + x.cents, 0)
    const serviciosCents = suma(servicios)
    const prestamosCents = suma(cuotasPrestamo)
    const tarjetasCents = suma(tarjetas)
    const variableCents = Math.abs(input.dailyBurnCents) * dias
    const totalCents = serviciosCents + prestamosCents + tarjetasCents + variableCents

    return {
      period,
      serviciosCents,
      serviciosEstimados: !facturas.length || facturas.some((b) => b.estimated === 1),
      prestamosCents,
      tarjetasCents,
      tarjetasEstimadas: cuotasProyectadas.length > 0,
      variableCents,
      totalCents,
      ingresosCents: input.incomeMonthlyCents,
      netoCents: input.incomeMonthlyCents - totalCents,
      detalle: { servicios, prestamos: cuotasPrestamo, tarjetas },
    }
  })
}

// ------------------------------------------------------------------- deudas

export interface CardDebt {
  cardId: string
  name: string
  /** Resumen emitido que todavía no venció. */
  resumenCents: number
  resumenDue: ISODate | null
  /** Cuotas de meses siguientes ya comprometidas. */
  cuotasCents: number
  cuotasCount: number
  /** Mes de la última cuota pendiente. */
  ultimoMes: string | null
  totalCents: number
}

export interface LoanDebt {
  loanId: string
  name: string
  lender: string
  installmentCents: number
  remaining: number
  total: number
  ultimoMes: string | null
  totalCents: number
}

export interface DebtSummary {
  cards: CardDebt[]
  loans: LoanDebt[]
  totalCents: number
  /** Lo que sale de deudas el mes que viene. */
  proximoMesCents: number
  /** Promedio mensual mientras dure la deuda. */
  promedioMensualCents: number
  mesesRestantes: number
  ultimoMes: string | null
  ingresoMensualCents: number
  /** Porcentaje del ingreso que se lleva la deuda el mes que viene. */
  pesoSobreIngreso: number
  porMes: Array<{ period: string; cents: number }>
}

export function debtSummary(args: {
  cards: Array<{ id: string; name: string }>
  loans: LoanLike[]
  installments: FutureInstallment[]
  cardDues: Array<CardDue & { cardId: string }>
  incomeMonthlyCents: number
  today?: ISODate
}): DebtSummary {
  const today = args.today ?? todayISO()
  const mesActual = financialMonth(today)

  const porMes = new Map<string, number>()
  const sumar = (period: string, cents: number) => porMes.set(period, (porMes.get(period) ?? 0) + cents)

  const cards: CardDebt[] = args.cards.map((card) => {
    const resumen = args.cardDues
      .filter((d) => d.cardId === card.id)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
    const cuotas = args.installments.filter((c) => c.cardId === card.id)

    const mesesConResumen = new Set(
      args.cardDues.filter((d) => d.cardId === card.id).map((d) => financialMonth(d.due_date)),
    )
    const cuotasNetas = cuotas.filter((c) => !mesesConResumen.has(c.period))

    if (resumen) sumar(financialMonth(resumen.due_date), resumen.amount_cents)
    for (const c of cuotasNetas) sumar(c.period, c.amountCents)

    const cuotasCents = cuotasNetas.reduce((a, c) => a + c.amountCents, 0)
    const ultimoMes = cuotasNetas.length
      ? cuotasNetas.map((c) => c.period).sort().at(-1)!
      : resumen
        ? financialMonth(resumen.due_date)
        : null

    return {
      cardId: card.id,
      name: card.name,
      resumenCents: resumen?.amount_cents ?? 0,
      resumenDue: resumen?.due_date ?? null,
      cuotasCents,
      cuotasCount: cuotasNetas.length,
      ultimoMes,
      totalCents: (resumen?.amount_cents ?? 0) + cuotasCents,
    }
  })

  const cuotasPrestamo = pendingLoanInstallments(args.loans, today)
  for (const c of cuotasPrestamo) sumar(c.period, c.amountCents)

  const loans: LoanDebt[] = args.loans
    .filter((l) => l.active && l.installments_paid < l.installments_total)
    .map((l) => {
      const mias = cuotasPrestamo.filter((c) => c.loanId === l.id)
      return {
        loanId: l.id,
        name: l.name,
        lender: '',
        installmentCents: l.installment_cents,
        remaining: mias.length,
        total: l.installments_total,
        ultimoMes: mias.length ? mias.map((c) => c.period).sort().at(-1)! : null,
        totalCents: mias.reduce((a, c) => a + c.amountCents, 0),
      }
    })

  const totalCents = cards.reduce((a, c) => a + c.totalCents, 0) + loans.reduce((a, l) => a + l.totalCents, 0)
  const meses = [...porMes.entries()].map(([period, cents]) => ({ period, cents })).sort((a, b) => a.period.localeCompare(b.period))
  const ultimoMes = meses.length ? meses[meses.length - 1].period : null
  const proximoMesCents = porMes.get(mesActual) ?? 0

  return {
    cards,
    loans,
    totalCents,
    proximoMesCents,
    promedioMensualCents: meses.length ? Math.round(totalCents / meses.length) : 0,
    mesesRestantes: meses.length,
    ultimoMes,
    ingresoMensualCents: args.incomeMonthlyCents,
    pesoSobreIngreso: args.incomeMonthlyCents
      ? Math.round((proximoMesCents / args.incomeMonthlyCents) * 1000) / 10
      : 0,
    porMes: meses,
  }
}
