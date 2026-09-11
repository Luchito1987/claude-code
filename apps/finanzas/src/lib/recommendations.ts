/**
 * Recomendaciones semanales. Son reglas deterministas sobre los datos cargados:
 * cada una dice qué pasa, cuánta plata mueve y qué hacer. Nada de consejos
 * genéricos: si una regla no puede cuantificar el impacto, no se emite.
 */

import { CATEGORY_LABELS, VARIABLE_CATEGORIES } from './categories'
import { addDays, compare, formatDate, todayISO, weekStart, type ISODate } from './dates'
import { formatMoney, pct } from './money'
import type { Projection } from './cashflow'
import type { RappiAnalysis } from './parsers/rappi'

export type Severity = 'critica' | 'alta' | 'media' | 'info'

export interface Recommendation {
  id: string
  severity: Severity
  title: string
  body: string
  /** Plata que libera (o que falta) si aplica la sugerencia. */
  impactCents: number
  category?: string
}

export interface RecoInput {
  today?: ISODate
  projection: Projection
  transactions: Array<{
    date: ISODate
    description: string
    merchant: string
    amount_cents: number
    category: string
  }>
  bills: Array<{ id: string; name: string; due_date: ISODate; amount_cents: number; status: string; estimated: number }>
  services: Array<{ id: string; name: string; expected_amount_cents: number }>
  loans: Array<{ name: string; installment_cents: number; installments_total: number; installments_paid: number; active: number }>
  monthlyIncomeCents: number
  minBufferCents: number
  rappi?: RappiAnalysis
  windowOpen: boolean
  windowPeriod: string
}

const SEVERITY_ORDER: Record<Severity, number> = { critica: 0, alta: 1, media: 2, info: 3 }

export function buildRecommendations(input: RecoInput): Recommendation[] {
  const today = input.today ?? todayISO()
  const out: Recommendation[] = []
  const p = input.projection

  out.push(...ruleCashGap(p, input, today))
  out.push(...ruleOverdueBills(input, today))
  out.push(...ruleBillingWindow(input))
  out.push(...ruleDueConcentration(p))
  out.push(...ruleDelivery(input, today))
  out.push(...ruleSubscriptions(input, today))
  out.push(...ruleServiceSpike(input, today))
  out.push(...ruleDebtLoad(input))
  out.push(...ruleTopVariable(input, today))
  out.push(...ruleSurplus(p, input))

  return out.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.impactCents - a.impactCents,
  )
}

/** El agujero de caja: cuánto falta y de dónde se puede sacar. */
function ruleCashGap(p: Projection, input: RecoInput, today: ISODate): Recommendation[] {
  if (p.negativeDate) {
    const gap = Math.abs(p.lowestCents)
    const week = Math.floor(daysBetween(today, p.negativeDate) / 7) + 1
    return [
      {
        id: 'caja-negativa',
        severity: 'critica',
        title: `La caja se va a negativo el ${formatDate(p.negativeDate)}`,
        body:
          `Con los compromisos cargados, el saldo toca ${formatMoney(p.lowestCents)} el ${formatDate(p.lowestDate)} ` +
          `(semana ${week}). Faltan ${formatMoney(gap)}. Opciones: postergar lo que se pueda mover, ` +
          `pagar el resumen de tarjeta en dos partes, o recortar gasto variable en las próximas ` +
          `${Math.max(1, week)} semana(s).`,
        impactCents: gap,
      },
    ]
  }
  if (p.breachDate) {
    const gap = Math.max(0, input.minBufferCents - p.lowestCents)
    return [
      {
        id: 'colchon-perforado',
        severity: 'alta',
        title: `El colchón de ${formatMoney(input.minBufferCents)} se perfora el ${formatDate(p.breachDate)}`,
        body:
          `El piso de la proyección es ${formatMoney(p.lowestCents)} el ${formatDate(p.lowestDate)}. ` +
          `Con ${formatMoney(gap)} más el mes queda cubierto sin tocar el colchón.`,
        impactCents: gap,
      },
    ]
  }
  return []
}

function ruleOverdueBills(input: RecoInput, today: ISODate): Recommendation[] {
  const overdue = input.bills.filter((b) => b.status !== 'pagado' && compare(b.due_date, today) < 0)
  if (!overdue.length) return []
  const total = overdue.reduce((a, b) => a + b.amount_cents, 0)
  return [
    {
      id: 'facturas-vencidas',
      severity: 'critica',
      title: `${overdue.length} factura(s) vencida(s) sin pagar`,
      body:
        `${overdue.map((b) => `${b.name} (${formatDate(b.due_date)}, ${formatMoney(b.amount_cents)})`).join(', ')}. ` +
        `Los recargos por mora son el gasto más caro y más evitable del mes.`,
      impactCents: total,
    },
  ]
}

/** Del 28 al 15 hay que salir a buscar las facturas: acá se avisa cuáles faltan. */
function ruleBillingWindow(input: RecoInput): Recommendation[] {
  if (!input.windowOpen) return []
  const pending = input.bills.filter((b) => b.estimated === 1 && b.status !== 'pagado')
  if (!pending.length) return []
  const total = pending.reduce((a, b) => a + b.amount_cents, 0)
  return [
    {
      id: 'ventana-facturacion',
      severity: 'media',
      title: `${pending.length} factura(s) del período con importe estimado`,
      body:
        `Estamos dentro de la ventana de consulta (28 al 15). Faltan confirmar: ` +
        `${pending.map((b) => b.name).join(', ')}. Hoy están estimadas en ${formatMoney(total)}; ` +
        `hasta que no se confirmen, la proyección puede correrse.`,
      impactCents: total,
    },
  ]
}

/** Vencimientos amontonados en una misma semana. */
function ruleDueConcentration(p: Projection): Recommendation[] {
  const worst = [...p.weeks].sort((a, b) => b.outflowCents - a.outflowCents)[0]
  if (!worst) return []
  const totalOut = p.weeks.reduce((a, w) => a + w.outflowCents, 0)
  if (!totalOut) return []
  const share = worst.outflowCents / totalOut
  if (share < 0.4 || p.weeks.length < 3) return []
  const avg = totalOut / p.weeks.length
  const excess = Math.round(worst.outflowCents - avg)
  return [
    {
      id: 'concentracion-vencimientos',
      severity: 'media',
      title: `La semana del ${formatDate(worst.start)} concentra el ${Math.round(share * 100)}% de los egresos`,
      body:
        `Salen ${formatMoney(worst.outflowCents)} contra un promedio de ${formatMoney(avg)}. ` +
        `Mover una de las fechas de vencimiento (varios servicios lo permiten desde la web del proveedor) ` +
        `aplana ${formatMoney(excess)} y evita el pico.`,
      impactCents: excess,
    },
  ]
}

function ruleDelivery(input: RecoInput, today: ISODate): Recommendation[] {
  const from = addDays(today, -30)
  const delivery = input.transactions.filter(
    (t) => t.category === 'delivery' && t.amount_cents < 0 && compare(t.date, from) >= 0,
  )
  const spent = delivery.reduce((a, t) => a + -t.amount_cents, 0)
  if (spent === 0 && !input.rappi?.orders) return []

  const out: Recommendation[] = []
  const orders = delivery.length || input.rappi?.orders || 0
  const monthly = spent || input.rappi?.monthlyRunRateCents || 0
  const avgTicket = orders ? Math.round(monthly / orders) : 0
  const shareOfIncome = input.monthlyIncomeCents ? pct(monthly, input.monthlyIncomeCents) : 0

  if (monthly > 0) {
    // Bajar un tercio de los pedidos es una meta que se sostiene; cortar de raíz no.
    const saving = Math.round(monthly / 3)
    out.push({
      id: 'delivery-volumen',
      severity: shareOfIncome > 10 ? 'alta' : 'media',
      title: `Delivery: ${formatMoney(monthly)} en 30 días (${orders} pedidos)`,
      body:
        `Ticket promedio ${formatMoney(avgTicket)}` +
        (shareOfIncome ? `, ${shareOfIncome}% del ingreso mensual` : '') +
        `. Bajar de ${orders} a ${Math.max(1, Math.round(orders * 0.67))} pedidos por mes libera ` +
        `${formatMoney(saving)} por mes, ${formatMoney(saving * 12)} por año.`,
      impactCents: saving,
      category: 'delivery',
    })
  }

  const r = input.rappi
  if (r && r.overheadCents > 0 && r.orders > 0) {
    const perOrder = Math.round(r.overheadCents / r.orders)
    out.push({
      id: 'delivery-overhead',
      severity: r.overheadPct > 20 ? 'alta' : 'media',
      title: `${r.overheadPct}% de lo que gastás en Rappi no es comida`,
      body:
        `Envío, tarifa de servicio y propina suman ${formatMoney(r.overheadCents)} sobre ` +
        `${formatMoney(r.totalCents)} en ${r.orders} pedidos: ${formatMoney(perOrder)} por pedido. ` +
        `Agrupar dos pedidos en uno, o retirar en el local cuando queda de paso, ataca directamente esa parte.`,
      impactCents: Math.round(r.overheadCents / 2),
      category: 'delivery',
    })
  }
  return out
}

/** Cargos que se repiten con el mismo importe todos los meses: suscripciones. */
function ruleSubscriptions(input: RecoInput, today: ISODate): Recommendation[] {
  const from = addDays(today, -120)
  const groups = new Map<string, { amounts: number[]; dates: ISODate[]; label: string }>()

  for (const t of input.transactions) {
    if (t.amount_cents >= 0 || compare(t.date, from) < 0) continue
    const key = (t.merchant || t.description).toUpperCase().slice(0, 24)
    const g = groups.get(key) ?? { amounts: [], dates: [], label: t.merchant || t.description }
    g.amounts.push(-t.amount_cents)
    g.dates.push(t.date)
    groups.set(key, g)
  }

  const subs: Array<{ label: string; cents: number }> = []
  for (const g of groups.values()) {
    if (g.amounts.length < 3) continue
    const months = new Set(g.dates.map((d) => d.slice(0, 7)))
    if (months.size < 3) continue
    // Una suscripción cobra una vez por mes. Un comercio donde comprás seguido
    // (el súper, la nafta) aparece muchas veces en el mismo mes: no es esto.
    if (g.amounts.length > months.size * 1.4) continue
    const avg = g.amounts.reduce((a, b) => a + b, 0) / g.amounts.length
    const spread = Math.max(...g.amounts) - Math.min(...g.amounts)
    // Importe estable mes a mes (±10%): huele a suscripción, no a compra suelta.
    if (avg > 0 && spread / avg <= 0.1) subs.push({ label: g.label, cents: Math.round(avg) })
  }

  if (!subs.length) return []
  subs.sort((a, b) => b.cents - a.cents)
  const total = subs.reduce((a, s) => a + s.cents, 0)
  return [
    {
      id: 'suscripciones',
      severity: 'media',
      title: `${subs.length} cargo(s) recurrente(s) por ${formatMoney(total)} al mes`,
      body:
        `${subs.slice(0, 8).map((s) => `${s.label} ${formatMoney(s.cents)}`).join(' · ')}. ` +
        `Son ${formatMoney(total * 12)} al año en piloto automático: vale revisar cuáles se usan de verdad.`,
      impactCents: total,
    },
  ]
}

/** Un servicio que saltó fuerte respecto de su propio promedio. */
function ruleServiceSpike(input: RecoInput, today: ISODate): Recommendation[] {
  const out: Recommendation[] = []
  for (const service of input.services) {
    const history = input.bills
      .filter((b) => b.name === service.name && b.amount_cents > 0)
      .sort((a, b) => compare(a.due_date, b.due_date))
    if (history.length < 3) continue
    const last = history[history.length - 1]
    if (compare(last.due_date, addDays(today, -60)) < 0) continue
    const prev = history.slice(-4, -1)
    const avg = prev.reduce((a, b) => a + b.amount_cents, 0) / prev.length
    if (avg <= 0) continue
    const jump = (last.amount_cents - avg) / avg
    if (jump < 0.25) continue
    out.push({
      id: `salto-${service.id}`,
      severity: 'media',
      title: `${service.name} subió ${Math.round(jump * 100)}% sobre su promedio`,
      body:
        `Última factura ${formatMoney(last.amount_cents)} contra un promedio de ${formatMoney(Math.round(avg))} ` +
        `en los meses previos. Puede ser un ajuste de tarifa, un consumo fuera de lo normal o un cargo mal ` +
        `facturado: conviene mirar el detalle antes de pagarla.`,
      impactCents: Math.round(last.amount_cents - avg),
      category: 'servicios',
    })
  }
  return out
}

/** Cuánto del ingreso se va en deuda antes de comprar nada. */
function ruleDebtLoad(input: RecoInput): Recommendation[] {
  if (!input.monthlyIncomeCents) return []
  const loanMonthly = input.loans
    .filter((l) => l.active && l.installments_paid < l.installments_total)
    .reduce((a, l) => a + l.installment_cents, 0)
  if (!loanMonthly) return []
  const share = pct(loanMonthly, input.monthlyIncomeCents)
  if (share < 25) return []
  const target = Math.round(input.monthlyIncomeCents * 0.25)
  return [
    {
      id: 'carga-deuda',
      severity: share >= 40 ? 'alta' : 'media',
      title: `Las cuotas de préstamos se llevan el ${share}% del ingreso`,
      body:
        `${formatMoney(loanMonthly)} por mes en cuotas fijas sobre ${formatMoney(input.monthlyIncomeCents)} de ingreso. ` +
        `Por encima del 25% (${formatMoney(target)}) cualquier imprevisto entra directo a la tarjeta. ` +
        `Cancelar anticipadamente el préstamo de cuota más chica es lo que más rápido descomprime el mes.`,
      impactCents: loanMonthly - target,
      category: 'prestamos',
    },
  ]
}

/** Dónde está la plata recortable y cuánto hay que recortar. */
function ruleTopVariable(input: RecoInput, today: ISODate): Recommendation[] {
  const from = addDays(today, -30)
  const totals = new Map<string, number>()
  for (const t of input.transactions) {
    if (t.amount_cents >= 0 || compare(t.date, from) < 0) continue
    if (!VARIABLE_CATEGORIES.includes(t.category as never)) continue
    totals.set(t.category, (totals.get(t.category) ?? 0) + -t.amount_cents)
  }
  if (!totals.size) return []
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const totalVariable = [...totals.values()].reduce((a, b) => a + b, 0)
  const need = input.projection.breachDate
    ? Math.max(0, input.minBufferCents - input.projection.lowestCents)
    : 0
  const cut = need ? Math.min(0.3, need / totalVariable) : 0.15

  return [
    {
      id: 'recorte-variable',
      severity: need ? 'alta' : 'info',
      title: need
        ? `Recortando ${Math.round(cut * 100)}% del gasto variable se cierra el bache`
        : `Gasto variable de los últimos 30 días: ${formatMoney(totalVariable)}`,
      body:
        `Concentrado en ${ranked
          .map(([c, v]) => `${CATEGORY_LABELS[c] ?? c} ${formatMoney(v)} (${pct(v, totalVariable)}%)`)
          .join(', ')}. ` +
        (need
          ? `Hacen falta ${formatMoney(need)}: sale de recortar ${Math.round(cut * 100)}% sobre estos tres rubros.`
          : `Un 15% menos acá son ${formatMoney(Math.round(totalVariable * 0.15))} por mes de colchón.`),
      impactCents: Math.round(totalVariable * cut),
    },
  ]
}

function ruleSurplus(p: Projection, input: RecoInput): Recommendation[] {
  if (p.breachDate || p.negativeDate) return []
  const surplus = p.closingCents - input.minBufferCents
  if (surplus <= 0) return []
  return [
    {
      id: 'excedente',
      severity: 'info',
      title: `Sobran ${formatMoney(surplus)} sobre el colchón al final del horizonte`,
      body:
        `La proyección cierra en ${formatMoney(p.closingCents)} con un colchón objetivo de ` +
        `${formatMoney(input.minBufferCents)}. Apartar ese excedente apenas entra el ingreso ` +
        `evita que se consuma solo.`,
      impactCents: surplus,
    },
  ]
}

function daysBetween(a: ISODate, b: ISODate): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/** Clave de la semana en curso, para no repetir el mismo set de recomendaciones. */
export function weekKey(today: ISODate = todayISO()): string {
  return weekStart(today)
}
