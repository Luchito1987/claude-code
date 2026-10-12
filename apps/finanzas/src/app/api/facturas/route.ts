import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { ensureBillsForPeriod, markBillPaid } from '@/lib/queries'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Marca pagada (o pendiente) la factura de un servicio en un mes, para pagos
 * que no pasan por un extracto: efectivo, o una transferencia desde una cuenta
 * que no se carga.
 *
 * `importeCents` fija lo que se pagó ese mes y nada más: un descuento puntual
 * no cambia lo que se espera para los meses siguientes.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { servicio, periodo, pagada = true, importeCents } = (await req.json().catch(() => ({}))) as {
    servicio?: string
    periodo?: string
    pagada?: boolean
    importeCents?: number
  }
  if (!servicio || !/^\d{4}-\d{2}$/.test(periodo ?? '')) {
    return NextResponse.json({ error: 'Hace falta el servicio y el período (AAAA-MM).' }, { status: 400 })
  }
  if (importeCents !== undefined && !(Number.isInteger(importeCents) && importeCents > 0)) {
    return NextResponse.json({ error: 'El importe va en centavos, entero y positivo.' }, { status: 400 })
  }
  const db = getDb()
  const servicios = db
    .prepare('SELECT id, name FROM services WHERE id = ? OR lower(name) = lower(?)')
    .all(servicio, servicio) as Array<{ id: string; name: string }>
  if (!servicios.length) return NextResponse.json({ error: `No existe el servicio "${servicio}".` }, { status: 404 })
  if (servicios.length > 1) return NextResponse.json({ error: `Hay más de un servicio "${servicio}": usá el id.` }, { status: 409 })

  ensureBillsForPeriod(periodo!)
  const factura = db
    .prepare('SELECT id FROM bills WHERE service_id = ? AND period = ?')
    .get(servicios[0].id, periodo) as { id: string } | undefined
  if (!factura) {
    return NextResponse.json({ error: `${servicios[0].name} no tiene factura en ${periodo}.` }, { status: 404 })
  }
  if (importeCents !== undefined) {
    db.prepare("UPDATE bills SET amount_cents = ?, estimated = 0, source = 'manual' WHERE id = ?").run(importeCents, factura.id)
  }
  markBillPaid(factura.id, pagada)
  const fila = db.prepare('SELECT amount_cents, status FROM bills WHERE id = ?').get(factura.id) as {
    amount_cents: number
    status: string
  }
  return NextResponse.json({ ok: `${servicios[0].name} ${periodo}: ${fila.status}.`, importeCents: fila.amount_cents })
}
