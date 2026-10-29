import { NextResponse } from 'next/server'
import { getDb, id, now } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Da de alta una cuenta (una billetera como la RappiCuenta, por ejemplo) con su
 * saldo a una fecha. Ese saldo es el ancla: los movimientos posteriores a esa
 * fecha lo mueven; los de ese mismo día ya están incluidos.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { nombre, saldoCents, fecha, tipo, moneda } = (await req.json().catch(() => ({}))) as {
    nombre?: string
    saldoCents?: number
    fecha?: string
    tipo?: string
    moneda?: string
  }
  const n = (nombre ?? '').trim()
  if (!n || !Number.isInteger(saldoCents) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) {
    return NextResponse.json({ error: 'Hace falta nombre, saldoCents (entero) y fecha (AAAA-MM-DD).' }, { status: 400 })
  }
  const db = getDb()
  if (db.prepare('SELECT 1 FROM accounts WHERE lower(name) = lower(?)').get(n)) {
    return NextResponse.json({ error: `Ya existe una cuenta "${n}".` }, { status: 409 })
  }
  const nueva = id()
  db.prepare(
    `INSERT INTO accounts (id, name, kind, currency, balance_cents, anchor_cents, anchor_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(nueva, n, tipo || 'billetera', moneda === 'ARS' ? 'ARS' : 'COP', saldoCents, saldoCents, fecha, now())
  return NextResponse.json({ ok: `Cuenta "${n}" creada.`, id: nueva })
}

/**
 * Corrige el saldo de una cuenta contra el banco: fija el ancla en `fecha` con
 * `saldoCents`. Los movimientos de ese día ya quedan incluidos en el saldo; los
 * posteriores lo mueven.
 */
export async function PATCH(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { cuenta, saldoCents, fecha } = (await req.json().catch(() => ({}))) as {
    cuenta?: string
    saldoCents?: number
    fecha?: string
  }
  if (!cuenta || !Number.isInteger(saldoCents) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) {
    return NextResponse.json({ error: 'Hace falta cuenta, saldoCents (entero) y fecha (AAAA-MM-DD).' }, { status: 400 })
  }
  const db = getDb()
  const c = db.prepare('SELECT id, name FROM accounts WHERE id = ? OR lower(name) = lower(?)').get(cuenta, cuenta) as
    | { id: string; name: string }
    | undefined
  if (!c) return NextResponse.json({ error: `No existe la cuenta "${cuenta}".` }, { status: 404 })
  db.prepare('UPDATE accounts SET anchor_cents = ?, anchor_date = ?, balance_cents = ?, updated_at = ? WHERE id = ?').run(
    saldoCents,
    fecha,
    saldoCents,
    now(),
    c.id,
  )
  return NextResponse.json({ ok: `${c.name}: saldo ${(saldoCents! / 100).toFixed(2)} al ${fecha}.` })
}
