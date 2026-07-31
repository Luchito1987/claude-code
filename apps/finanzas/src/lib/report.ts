/**
 * Exportables. El informe en Markdown está pensado para pegarlo en una
 * conversación con Claude: lleva los números crudos, el contexto mínimo para
 * interpretarlos y las preguntas concretas al final.
 */

import { CATEGORY_LABELS } from './categories'
import { addDays, formatDate, formatPeriod, todayISO, type ISODate } from './dates'
import { formatMoney, pct } from './money'
import { analyzeRappi, type RappiAnalysis } from './parsers/rappi'
import { buildRecommendations, type Recommendation } from './recommendations'
import {
  allCardDues,
  buildProjection,
  billingWindowView,
  currentBurnCents,
  listBills,
  listCards,
  listIncomes,
  listLoans,
  listRappiOrders,
  listServices,
  listTransactions,
  loanProgress,
  minBufferCents,
  monthlyIncomeCents,
  monthlySpend,
  spendByCategory,
  totalCashCents,
  listAccounts,
} from './queries'
import type { Projection } from './cashflow'

export interface Snapshot {
  generatedAt: string
  today: ISODate
  cash: {
    totalCents: number
    accounts: Array<{ name: string; kind: string; balanceCents: number }>
    minBufferCents: number
    dailyBurnCents: number
  }
  income: { monthlyCents: number; sources: Array<{ name: string; amountCents: number; day: number }> }
  window: {
    period: string
    start: ISODate
    end: ISODate
    open: boolean
    totalCents: number
    pendingCents: number
    bills: Array<{ name: string; dueDate: ISODate; amountCents: number; status: string; estimated: boolean }>
  }
  loans: Array<{
    name: string
    lender: string
    installmentCents: number
    paid: number
    total: number
    outstandingCents: number
    nextDue: ISODate | null
  }>
  cards: Array<{ name: string; closingDay: number; dueDay: number; dues: Array<{ dueDate: ISODate; amountCents: number }> }>
  spending: {
    last30ByCategory: Array<{ category: string; cents: number; count: number; share: number }>
    monthly: Array<{ period: string; cents: number }>
    topMerchants: Array<{ merchant: string; cents: number; count: number }>
  }
  rappi: RappiAnalysis & { hasDetail: boolean }
  projection: {
    horizonEnd: ISODate
    openingCents: number
    closingCents: number
    lowestCents: number
    lowestDate: ISODate
    breachDate: ISODate | null
    negativeDate: ISODate | null
    committedCents: number
    projectedVariableCents: number
    weeks: Array<{
      start: ISODate
      end: ISODate
      openingCents: number
      inflowCents: number
      outflowCents: number
      closingCents: number
    }>
  }
  recommendations: Recommendation[]
}

export function buildSnapshot(today: ISODate = todayISO()): Snapshot {
  const projection: Projection = buildProjection(today)
  const win = billingWindowView(today)
  const from30 = addDays(today, -30)
  const byCategory = spendByCategory(from30, today)
  const totalSpend30 = byCategory.reduce((a, c) => a + c.cents, 0)
  const orders = listRappiOrders()
  const rappiTx = listTransactions({ from: addDays(today, -180), category: 'delivery' })

  // Si no hay pedidos con detalle cargados, se usa lo que se ve en la tarjeta.
  const rappi = orders.length
    ? analyzeRappi(
        orders.map((o) => ({
          date: o.date,
          store: o.store,
          totalCents: o.total_cents,
          productsCents: o.products_cents,
          deliveryCents: o.delivery_cents,
          serviceCents: o.service_cents,
          tipCents: o.tip_cents,
          itemsCount: o.items_count,
          vertical: o.vertical,
          raw: '',
        })),
      )
    : analyzeRappi(
        rappiTx
          .filter((t) => /rappi/i.test(t.description))
          .map((t) => ({
            date: t.date,
            store: t.merchant || 'Rappi',
            totalCents: -t.amount_cents,
            productsCents: 0,
            deliveryCents: 0,
            serviceCents: 0,
            tipCents: 0,
            itemsCount: 0,
            vertical: 'restaurante',
            raw: '',
          })),
      )

  const transactions = listTransactions({ from: addDays(today, -120) })
  const bills = listBills()
  const services = listServices()

  const recommendations = buildRecommendations({
    today,
    projection,
    transactions,
    bills,
    services,
    loans: listLoans(),
    monthlyIncomeCents: monthlyIncomeCents(),
    minBufferCents: minBufferCents(),
    rappi: orders.length ? rappi : undefined,
    windowOpen: win.window.open,
    windowPeriod: win.window.period,
  })

  const merchants = new Map<string, { cents: number; count: number }>()
  for (const t of transactions) {
    if (t.amount_cents >= 0 || t.date < from30) continue
    const key = t.merchant || t.description
    const cur = merchants.get(key) ?? { cents: 0, count: 0 }
    cur.cents += -t.amount_cents
    cur.count++
    merchants.set(key, cur)
  }

  return {
    generatedAt: new Date().toISOString(),
    today,
    cash: {
      totalCents: totalCashCents(),
      accounts: listAccounts().map((a) => ({ name: a.name, kind: a.kind, balanceCents: a.balance_cents })),
      minBufferCents: minBufferCents(),
      dailyBurnCents: currentBurnCents(today),
    },
    income: {
      monthlyCents: monthlyIncomeCents(),
      sources: listIncomes().map((i) => ({ name: i.name, amountCents: i.amount_cents, day: i.day_of_month })),
    },
    window: {
      period: win.window.period,
      start: win.window.start,
      end: win.window.end,
      open: win.window.open,
      totalCents: win.totalCents,
      pendingCents: win.pendingCents,
      bills: win.bills.map((b) => ({
        name: b.name,
        dueDate: b.due_date,
        amountCents: b.amount_cents,
        status: b.status,
        estimated: b.estimated === 1,
      })),
    },
    loans: listLoans().map((l) => {
      const p = loanProgress(l)
      return {
        name: l.name,
        lender: l.lender,
        installmentCents: l.installment_cents,
        paid: l.installments_paid,
        total: l.installments_total,
        outstandingCents: p.outstandingCents,
        nextDue: p.nextDue,
      }
    }),
    cards: listCards().map((c) => ({
      name: c.name,
      closingDay: c.closing_day,
      dueDay: c.due_day,
      dues: allCardDues(today)
        .filter((d) => d.cardId === c.id)
        .map((d) => ({ dueDate: d.due_date, amountCents: d.amount_cents })),
    })),
    spending: {
      last30ByCategory: byCategory.map((c) => ({ ...c, share: pct(c.cents, totalSpend30) })),
      monthly: monthlySpend(6, today),
      topMerchants: [...merchants.entries()]
        .map(([merchant, v]) => ({ merchant, ...v }))
        .sort((a, b) => b.cents - a.cents)
        .slice(0, 15),
    },
    rappi: { ...rappi, hasDetail: orders.length > 0 },
    projection: {
      horizonEnd: projection.horizonEnd,
      openingCents: projection.openingCents,
      closingCents: projection.closingCents,
      lowestCents: projection.lowestCents,
      lowestDate: projection.lowestDate,
      breachDate: projection.breachDate,
      negativeDate: projection.negativeDate,
      committedCents: projection.committedCents,
      projectedVariableCents: projection.projectedVariableCents,
      weeks: projection.weeks.map((w) => ({
        start: w.start,
        end: w.end,
        openingCents: w.openingCents,
        inflowCents: w.inflowCents,
        outflowCents: w.outflowCents,
        closingCents: w.closingCents,
      })),
    },
    recommendations,
  }
}

export function toMarkdown(s: Snapshot): string {
  const L: string[] = []
  const m = formatMoney

  L.push(`# Situación financiera — ${s.today}`)
  L.push('')
  L.push(
    `Generado por la app de flujo de caja. Todos los importes en pesos argentinos. ` +
      `El "gasto variable proyectado" es una estimación diaria calculada sobre los últimos 90 días.`,
  )
  L.push('')

  L.push('## Resumen')
  L.push('')
  L.push('| Concepto | Importe |')
  L.push('|---|---:|')
  L.push(`| Efectivo disponible hoy | ${m(s.cash.totalCents)} |`)
  L.push(`| Ingreso mensual | ${m(s.income.monthlyCents)} |`)
  L.push(`| Colchón mínimo objetivo | ${m(s.cash.minBufferCents)} |`)
  L.push(`| Consumo variable diario | ${m(s.cash.dailyBurnCents)} |`)
  L.push(`| Compromisos hasta ${s.projection.horizonEnd} | ${m(s.projection.committedCents)} |`)
  L.push(`| Saldo proyectado al cierre | ${m(s.projection.closingCents)} |`)
  L.push(`| Piso de la proyección | ${m(s.projection.lowestCents)} (${s.projection.lowestDate}) |`)
  L.push('')
  if (s.projection.negativeDate) {
    L.push(`> ⚠️ La caja se va a negativo el ${s.projection.negativeDate}.`)
    L.push('')
  } else if (s.projection.breachDate) {
    L.push(`> ⚠️ El colchón mínimo se perfora el ${s.projection.breachDate}.`)
    L.push('')
  }

  L.push(`## Facturas del período ${formatPeriod(s.window.period)}`)
  L.push('')
  L.push(`Ventana de consulta: ${s.window.start} → ${s.window.end}${s.window.open ? ' (abierta)' : ''}.`)
  L.push('')
  if (s.window.bills.length) {
    L.push('| Servicio | Vence | Importe | Estado |')
    L.push('|---|---|---:|---|')
    for (const b of s.window.bills) {
      L.push(
        `| ${b.name} | ${b.dueDate} | ${m(b.amountCents)}${b.estimated ? ' *(est.)*' : ''} | ${b.status} |`,
      )
    }
    L.push('')
    L.push(`Total del período: **${m(s.window.totalCents)}** — pendiente: **${m(s.window.pendingCents)}**.`)
  } else {
    L.push('_Sin facturas cargadas para el período._')
  }
  L.push('')

  L.push('## Tarjetas')
  L.push('')
  if (s.cards.length) {
    for (const c of s.cards) {
      const dues = c.dues.length
        ? c.dues.map((d) => `${d.dueDate}: ${m(d.amountCents)}`).join(' · ')
        : 'sin consumos importados'
      L.push(`- **${c.name}** (cierra ${c.closingDay}, vence ${c.dueDay}) — ${dues}`)
    }
  } else {
    L.push('_Sin tarjetas cargadas._')
  }
  L.push('')

  L.push('## Préstamos')
  L.push('')
  if (s.loans.length) {
    L.push('| Préstamo | Cuota | Avance | Saldo | Próxima |')
    L.push('|---|---:|---|---:|---|')
    for (const l of s.loans) {
      L.push(
        `| ${l.name}${l.lender ? ` (${l.lender})` : ''} | ${m(l.installmentCents)} | ${l.paid}/${l.total} | ` +
          `${m(l.outstandingCents)} | ${l.nextDue ?? '—'} |`,
      )
    }
  } else {
    L.push('_Sin préstamos cargados._')
  }
  L.push('')

  L.push('## Gasto de los últimos 30 días')
  L.push('')
  if (s.spending.last30ByCategory.length) {
    L.push('| Categoría | Importe | % | Movimientos |')
    L.push('|---|---:|---:|---:|')
    for (const c of s.spending.last30ByCategory) {
      L.push(`| ${CATEGORY_LABELS[c.category] ?? c.category} | ${m(c.cents)} | ${c.share}% | ${c.count} |`)
    }
    L.push('')
    L.push('**Comercios con más gasto**')
    L.push('')
    for (const t of s.spending.topMerchants.slice(0, 10)) {
      L.push(`- ${t.merchant}: ${m(t.cents)} en ${t.count} compra(s)`)
    }
  } else {
    L.push('_Sin movimientos importados en el período._')
  }
  L.push('')

  if (s.rappi.orders) {
    L.push('## Delivery / Rappi')
    L.push('')
    L.push(
      `${s.rappi.orders} pedidos por ${m(s.rappi.totalCents)}, ticket promedio ${m(s.rappi.avgTicketCents)}. ` +
        (s.rappi.hasDetail
          ? `Envío + tarifa + propina: ${m(s.rappi.overheadCents)} (${s.rappi.overheadPct}% del total).`
          : `_Solo se detectaron los consumos en la tarjeta; sin detalle de envío/propina._`),
    )
    L.push('')
    if (s.rappi.perMonth.length) {
      L.push('| Mes | Pedidos | Total |')
      L.push('|---|---:|---:|')
      for (const mo of s.rappi.perMonth) L.push(`| ${mo.period} | ${mo.orders} | ${m(mo.totalCents)} |`)
      L.push('')
    }
    if (s.rappi.topStores.length) {
      L.push(
        `Comercios más frecuentes: ${s.rappi.topStores
          .slice(0, 5)
          .map((t) => `${t.store} (${t.orders}, ${m(t.totalCents)})`)
          .join(', ')}.`,
      )
      L.push('')
    }
  }

  L.push('## Proyección semanal')
  L.push('')
  L.push('| Semana | Entra | Sale | Cierre |')
  L.push('|---|---:|---:|---:|')
  for (const w of s.projection.weeks) {
    L.push(`| ${formatDate(w.start)} – ${formatDate(w.end)} | ${m(w.inflowCents)} | ${m(w.outflowCents)} | ${m(w.closingCents)} |`)
  }
  L.push('')

  L.push('## Alertas detectadas por la app')
  L.push('')
  if (s.recommendations.length) {
    for (const r of s.recommendations) {
      L.push(`### [${r.severity}] ${r.title}`)
      L.push('')
      L.push(r.body)
      if (r.impactCents) L.push(`\nImpacto estimado: **${m(r.impactCents)}**.`)
      L.push('')
    }
  } else {
    L.push('_Sin alertas._')
  }

  L.push('---')
  L.push('')
  L.push('## Lo que necesito que analices')
  L.push('')
  L.push('1. ¿Dónde conviene recortar primero, y cuánto, para no perforar el colchón mínimo?')
  L.push('2. ¿Hay vencimientos que convenga mover de fecha para aplanar los picos semanales?')
  L.push('3. ¿Qué gastos recurrentes parecen prescindibles o duplicados?')
  L.push('4. ¿El nivel de deuda (préstamos + tarjetas) es sostenible con este ingreso?')
  L.push('5. Armá un plan concreto para las próximas 4 semanas, con montos por semana.')
  L.push('')

  return L.join('\n')
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
}
