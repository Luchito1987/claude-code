/**
 * Rappi no publica una API abierta ni un export de historial: no hay un endpoint
 * oficial al que conectarse con usuario y contraseña. Lo que sí se puede hacer,
 * sin romper sus términos ni guardar credenciales, es reconstruir el historial
 * desde tres fuentes:
 *
 *   1. Los mails de confirmación de pedido (se pegan o se suben como .txt/.eml).
 *   2. Un CSV armado a mano o exportado desde el mail.
 *   3. Los consumos "RAPPI*" que ya vienen en el resumen de la tarjeta.
 *
 * La 3 da el total gastado; la 1 y la 2 agregan el detalle (comercio, envío,
 * propina, tarifa de servicio) que es donde suele estar el ahorro.
 */

import { createHash } from 'node:crypto'
import { parseCsv } from './csv'
import { toCents } from '../money'
import { parseDate } from './statement'
import type { ISODate } from '../dates'

export interface RappiOrder {
  date: ISODate
  store: string
  totalCents: number
  productsCents: number
  deliveryCents: number
  serviceCents: number
  tipCents: number
  itemsCount: number
  vertical: string
  raw: string
}

export interface RappiParseResult {
  orders: RappiOrder[]
  skipped: number
  warnings: string[]
}

const FIELD_RES = {
  products: /(?:productos|subtotal|sub\s?total)\D{0,20}([\d.,]+)/i,
  delivery: /(?:costo\s+de\s+env[ií]o|env[ií]o|delivery)\D{0,20}([\d.,]+)/i,
  service: /(?:tarifa\s+de\s+servicio|servicio\s+rappi|service\s+fee|tarifa)\D{0,20}([\d.,]+)/i,
  tip: /(?:propina|tip)\D{0,20}([\d.,]+)/i,
  total: /(?:total\s+(?:del\s+)?pedido|total\s+pagado|total)\D{0,20}([\d.,]+)/i,
  store: /(?:pedido\s+(?:de|en)|restaurante|comercio|tienda|store)\s*:?\s*(.+)/i,
  date: /(?:fecha|realizado\s+el|entregado\s+el)\s*:?\s*(.+)/i,
  items: /(\d+)\s*(?:x|unidad|producto|item)/i,
}

// El orden importa: "Farmacity Turbo" es farmacia, no super.
const VERTICALS: Array<[RegExp, string]> = [
  [/farmacia|farmacity|pharmacy/i, 'farmacia'],
  [/turbo|express|super|market|mercado/i, 'super'],
  [/licor|bebida|drinks/i, 'bebidas'],
  [/favor|whim/i, 'favor'],
]

function detectVertical(text: string): string {
  for (const [re, name] of VERTICALS) if (re.test(text)) return name
  return 'restaurante'
}

const SEP = '\u241E'

/**
 * Corta un texto largo en bloques, uno por pedido. Primero corta por el número
 * de pedido; si el texto no los trae, separa por línea en blanco.
 */
function splitOrders(text: string): string[] {
  const marked = text.replace(/(?=(?:pedido|orden)\s*(?:#|n[°º]|nro)\s*[\w-]+)/gi, SEP)
  const parts = marked.includes(SEP) ? marked.split(SEP) : text.split(/\n\s*\n/)
  return parts.map((p) => p.trim()).filter((p) => p.length > 10)
}

export function parseRappiReceipts(text: string, fallbackYear?: number): RappiParseResult {
  const orders: RappiOrder[] = []
  const warnings: string[] = []
  let skipped = 0

  for (const block of splitOrders(text)) {
    const total = pick(block, FIELD_RES.total)
    const date = findDate(block, fallbackYear)
    if (!total || !date) {
      skipped++
      continue
    }
    const storeMatch = block.match(FIELD_RES.store)
    const store = (storeMatch?.[1] ?? '').split(/\n/)[0].trim().slice(0, 60) || 'Rappi'
    const itemsMatch = block.match(FIELD_RES.items)

    orders.push({
      date,
      store,
      totalCents: total,
      productsCents: pick(block, FIELD_RES.products) ?? 0,
      deliveryCents: pick(block, FIELD_RES.delivery) ?? 0,
      serviceCents: pick(block, FIELD_RES.service) ?? 0,
      tipCents: pick(block, FIELD_RES.tip) ?? 0,
      itemsCount: itemsMatch ? Number(itemsMatch[1]) : 0,
      vertical: detectVertical(block),
      raw: block.slice(0, 500),
    })
  }

  if (!orders.length) {
    warnings.push(
      'No se reconoció ningún pedido. Cada bloque necesita al menos una fecha y una línea "Total $ ...".',
    )
  }
  return { orders, skipped, warnings }
}

function pick(block: string, re: RegExp): number | null {
  const m = block.match(re)
  if (!m) return null
  const cents = Math.abs(toCents(m[1]))
  return cents || null
}

function findDate(block: string, fallbackYear?: number): ISODate | null {
  const labeled = block.match(FIELD_RES.date)
  if (labeled) {
    const d = parseDate(labeled[1], fallbackYear)
    if (d) return d
  }
  return parseDate(block, fallbackYear)
}

const CSV_HINTS = {
  date: ['fecha', 'date', 'created_at'],
  store: ['tienda', 'comercio', 'restaurante', 'store', 'nombre'],
  total: ['total', 'importe', 'monto'],
  delivery: ['envio', 'delivery', 'shipping'],
  service: ['servicio', 'service', 'tarifa'],
  tip: ['propina', 'tip'],
  products: ['productos', 'subtotal'],
}

function col(headers: string[], hints: string[]): number {
  const normed = headers.map((h) =>
    h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(),
  )
  for (const hint of hints) {
    const i = normed.findIndex((h) => h === hint)
    if (i !== -1) return i
  }
  for (const hint of hints) {
    const i = normed.findIndex((h) => h.includes(hint))
    if (i !== -1) return i
  }
  return -1
}

export function parseRappiCsv(text: string, fallbackYear?: number): RappiParseResult {
  const rows = parseCsv(text)
  if (rows.length < 2) return { orders: [], skipped: 0, warnings: ['El CSV está vacío.'] }

  const headers = rows[0]
  const cols = {
    date: col(headers, CSV_HINTS.date),
    store: col(headers, CSV_HINTS.store),
    total: col(headers, CSV_HINTS.total),
    delivery: col(headers, CSV_HINTS.delivery),
    service: col(headers, CSV_HINTS.service),
    tip: col(headers, CSV_HINTS.tip),
    products: col(headers, CSV_HINTS.products),
  }
  if (cols.date === -1 || cols.total === -1) {
    return { orders: [], skipped: rows.length - 1, warnings: ['El CSV necesita al menos columnas de fecha y total.'] }
  }

  const orders: RappiOrder[] = []
  let skipped = 0
  for (const r of rows.slice(1)) {
    const date = parseDate(r[cols.date] ?? '', fallbackYear)
    const total = Math.abs(toCents(r[cols.total] ?? ''))
    if (!date || !total) {
      skipped++
      continue
    }
    const store = (cols.store !== -1 ? r[cols.store] : '')?.trim() || 'Rappi'
    orders.push({
      date,
      store,
      totalCents: total,
      productsCents: cols.products !== -1 ? Math.abs(toCents(r[cols.products] ?? '')) : 0,
      deliveryCents: cols.delivery !== -1 ? Math.abs(toCents(r[cols.delivery] ?? '')) : 0,
      serviceCents: cols.service !== -1 ? Math.abs(toCents(r[cols.service] ?? '')) : 0,
      tipCents: cols.tip !== -1 ? Math.abs(toCents(r[cols.tip] ?? '')) : 0,
      itemsCount: 0,
      vertical: detectVertical(`${store} ${r.join(' ')}`),
      raw: r.join(' | '),
    })
  }
  return { orders, skipped, warnings: [] }
}

export function rappiFingerprint(o: RappiOrder): string {
  return createHash('sha256')
    .update(['rappi', o.date, o.store.toLowerCase(), o.totalCents].join('|'))
    .digest('hex')
    .slice(0, 32)
}

export interface RappiAnalysis {
  orders: number
  totalCents: number
  avgTicketCents: number
  /** Lo que se paga por el servicio en sí: envío + tarifa + propina. */
  overheadCents: number
  overheadPct: number
  perMonth: Array<{ period: string; orders: number; totalCents: number }>
  topStores: Array<{ store: string; orders: number; totalCents: number }>
  byWeekday: Array<{ day: string; orders: number; totalCents: number }>
  monthlyRunRateCents: number
}

const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

export function analyzeRappi(orders: RappiOrder[]): RappiAnalysis {
  const totalCents = orders.reduce((a, o) => a + o.totalCents, 0)
  const overheadCents = orders.reduce((a, o) => a + o.deliveryCents + o.serviceCents + o.tipCents, 0)

  const months = new Map<string, { orders: number; totalCents: number }>()
  const stores = new Map<string, { orders: number; totalCents: number }>()
  const weekdays = new Map<string, { orders: number; totalCents: number }>()

  for (const o of orders) {
    const period = o.date.slice(0, 7)
    bump(months, period, o.totalCents)
    bump(stores, o.store, o.totalCents)
    const [y, m, d] = o.date.split('-').map(Number)
    bump(weekdays, DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], o.totalCents)
  }

  const perMonth = [...months.entries()]
    .map(([period, v]) => ({ period, ...v }))
    .sort((a, b) => a.period.localeCompare(b.period))

  return {
    orders: orders.length,
    totalCents,
    avgTicketCents: orders.length ? Math.round(totalCents / orders.length) : 0,
    overheadCents,
    overheadPct: totalCents ? Math.round((overheadCents / totalCents) * 1000) / 10 : 0,
    perMonth,
    topStores: [...stores.entries()]
      .map(([store, v]) => ({ store, ...v }))
      .sort((a, b) => b.totalCents - a.totalCents)
      .slice(0, 10),
    byWeekday: DOW.map((day) => ({ day, ...(weekdays.get(day) ?? { orders: 0, totalCents: 0 }) })),
    monthlyRunRateCents: perMonth.length
      ? Math.round(perMonth.slice(-3).reduce((a, m) => a + m.totalCents, 0) / Math.min(perMonth.length, 3))
      : 0,
  }
}

function bump(map: Map<string, { orders: number; totalCents: number }>, key: string, cents: number): void {
  const cur = map.get(key) ?? { orders: 0, totalCents: 0 }
  cur.orders++
  cur.totalCents += cents
  map.set(key, cur)
}
