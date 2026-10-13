import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { getDb, id, now } from '@/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Carga cómo aparece el pago de una tarjeta en el extracto de la cuenta
 * ("PAGO SUC VIRT TC VISA"). Es lo único de la tarjeta que se puede tocar por
 * acá: sin eso, los pagos que salen de las cuentas no se reconocen como pago
 * de la tarjeta y quedan contados como gasto.
 *
 * Con `pagado: {periodo, importeCents}` marca pagado el resumen de ese mes
 * financiero, para un pago adelantado o hecho desde una cuenta que no se carga:
 * el pago se concilia por su fecha, y uno hecho antes del cierre del mes
 * quedaría en el mes anterior.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { tarjeta, patronPago, pagado } = (await req.json().catch(() => ({}))) as {
    tarjeta?: string
    patronPago?: string
    pagado?: { periodo?: string; importeCents?: number }
  }
  const patron = (patronPago ?? '').trim()
  if (tarjeta && pagado) return marcarPagado(tarjeta, pagado)
  if (!tarjeta || patron.length < 4) {
    return NextResponse.json({ error: 'Hace falta la tarjeta y un texto de al menos 4 caracteres.' }, { status: 400 })
  }
  const db = getDb()
  const card = db.prepare('SELECT id, name FROM cards WHERE id = ? OR name = ?').get(tarjeta, tarjeta) as
    | { id: string; name: string }
    | undefined
  if (!card) return NextResponse.json({ error: `No existe la tarjeta "${tarjeta}".` }, { status: 404 })
  db.prepare('UPDATE cards SET match_pattern = ? WHERE id = ?').run(patron, card.id)
  return NextResponse.json({ ok: `${card.name}: su pago se reconoce por "${patron}".` })
}

function marcarPagado(tarjeta: string, pagado: { periodo?: string; importeCents?: number }) {
  const { periodo, importeCents } = pagado
  if (!/^\d{4}-\d{2}$/.test(periodo ?? '') || !(Number.isInteger(importeCents) && importeCents! > 0)) {
    return NextResponse.json({ error: 'El pago necesita periodo (AAAA-MM) e importeCents entero y positivo.' }, { status: 400 })
  }
  const db = getDb()
  const card = db.prepare('SELECT id, name FROM cards WHERE id = ? OR name = ?').get(tarjeta, tarjeta) as
    | { id: string; name: string }
    | undefined
  if (!card) return NextResponse.json({ error: `No existe la tarjeta "${tarjeta}".` }, { status: 404 })
  db.prepare(
    `INSERT INTO month_payments (id, kind, ref_id, period, amount_cents, paid_at)
     VALUES (?, 'tarjeta', ?, ?, ?, ?)
     ON CONFLICT(kind, ref_id, period) DO UPDATE SET amount_cents = excluded.amount_cents`,
  ).run(id(), card.id, periodo, importeCents, now())
  return NextResponse.json({ ok: `${card.name} ${periodo}: pagado.` })
}
