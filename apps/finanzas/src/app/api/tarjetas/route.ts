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
  const { tarjeta, patronPago, pagado, saldada, crear } = (await req.json().catch(() => ({}))) as {
    tarjeta?: string
    patronPago?: string
    pagado?: { periodo?: string; importeCents?: number }
    saldada?: { hasta?: string }
    crear?: { nombre?: string; emisor?: string; moneda?: string; cierre?: number; vencimiento?: number }
  }
  const patron = (patronPago ?? '').trim()
  if (crear) return altaTarjeta(crear, patron)
  if (tarjeta && pagado) return marcarPagado(tarjeta, pagado)
  if (tarjeta && saldada) return marcarSaldada(tarjeta, saldada.hasta)
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
  if (!/^\d{4}-\d{2}$/.test(periodo ?? '') || !(Number.isInteger(importeCents) && importeCents! >= 0)) {
    return NextResponse.json({ error: 'El pago necesita periodo (AAAA-MM) e importeCents entero (0 = sin deuda, saldada con un pago anterior).' }, { status: 400 })
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

/**
 * Con `saldada: {hasta}` marca pagados completos los resúmenes de la tarjeta
 * que vencen hasta esa fecha: sus compras en cuotas dejan de proyectarse como
 * deuda futura, porque el pago total las canceló.
 */
function marcarSaldada(tarjeta: string, hasta?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hasta ?? '')) {
    return NextResponse.json({ error: 'saldada.hasta tiene que ser una fecha AAAA-MM-DD.' }, { status: 400 })
  }
  const db = getDb()
  const card = db.prepare('SELECT id, name FROM cards WHERE id = ? OR name = ?').get(tarjeta, tarjeta) as
    | { id: string; name: string }
    | undefined
  if (!card) return NextResponse.json({ error: `No existe la tarjeta "${tarjeta}".` }, { status: 404 })
  const r = db
    .prepare("UPDATE statements SET paid_in_full = 1 WHERE card_id = ? AND due_date <> '' AND due_date <= ?")
    .run(card.id, hasta)
  return NextResponse.json({ ok: `${card.name}: ${r.changes} resumen(es) marcados como pagados completos.` })
}

/** Da de alta una tarjeta (p. ej. la Naranja X, en pesos argentinos). */
function altaTarjeta(
  c: { nombre?: string; emisor?: string; moneda?: string; cierre?: number; vencimiento?: number },
  patron: string,
) {
  const nombre = (c.nombre ?? '').trim()
  const dia = (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 31
  if (!nombre || !dia(c.cierre) || !dia(c.vencimiento)) {
    return NextResponse.json({ error: 'Hace falta nombre, cierre y vencimiento (días 1-31).' }, { status: 400 })
  }
  const db = getDb()
  if (db.prepare('SELECT 1 FROM cards WHERE lower(name) = lower(?)').get(nombre)) {
    return NextResponse.json({ error: `Ya existe una tarjeta "${nombre}".` }, { status: 409 })
  }
  const nueva = id()
  db.prepare(
    `INSERT INTO cards (id, name, issuer, closing_day, due_day, currency, match_pattern) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(nueva, nombre, c.emisor ?? '', c.cierre, c.vencimiento, c.moneda === 'ARS' ? 'ARS' : 'COP', patron)
  return NextResponse.json({ ok: `Tarjeta "${nombre}" creada.`, id: nueva })
}
