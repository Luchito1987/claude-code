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
  const { nombre, saldoCents, fecha, tipo } = (await req.json().catch(() => ({}))) as {
    nombre?: string
    saldoCents?: number
    fecha?: string
    tipo?: string
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
    `INSERT INTO accounts (id, name, kind, balance_cents, anchor_cents, anchor_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(nueva, n, tipo || 'billetera', saldoCents, saldoCents, fecha, now())
  return NextResponse.json({ ok: `Cuenta "${n}" creada.`, id: nueva })
}
