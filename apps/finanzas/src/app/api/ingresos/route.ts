import { NextResponse } from 'next/server'
import { getDb, id, now } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Los ingresos mensuales cargados. */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const filas = getDb()
    .prepare(
      `SELECT id, name AS nombre, owner AS titular, amount_cents AS importeCents, floor_cents AS pisoCents,
              currency AS moneda, day_of_month AS dia, active AS activo FROM incomes ORDER BY currency, name`,
    )
    .all()
  return NextResponse.json(filas)
}

/**
 * Da de alta un ingreso mensual, o actualiza su importe si ya existe uno con
 * ese nombre (el sueldo cambia mes a mes). `pisoCents` es lo que entra seguro
 * en un mal mes; si no se dice, es el mismo importe.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const b = (await req.json().catch(() => ({}))) as {
    nombre?: string
    titular?: string
    importeCents?: number
    pisoCents?: number
    dia?: number
    moneda?: string
  }
  const nombre = (b.nombre ?? '').trim()
  if (!nombre || !Number.isInteger(b.importeCents) || b.importeCents! <= 0) {
    return NextResponse.json({ error: 'Hace falta nombre e importeCents entero positivo.' }, { status: 400 })
  }
  const piso = Number.isInteger(b.pisoCents) && b.pisoCents! >= 0 ? b.pisoCents! : b.importeCents!
  const dia = Number.isInteger(b.dia) && b.dia! >= 1 && b.dia! <= 31 ? b.dia! : 1
  const moneda = b.moneda === 'ARS' ? 'ARS' : 'COP'
  const db = getDb()
  const previo = db.prepare('SELECT id FROM incomes WHERE lower(name) = lower(?) AND currency = ?').get(nombre, moneda) as
    | { id: string }
    | undefined
  if (previo) {
    db.prepare('UPDATE incomes SET amount_cents = ?, floor_cents = ?, day_of_month = ?, active = 1 WHERE id = ?').run(
      b.importeCents,
      piso,
      dia,
      previo.id,
    )
    return NextResponse.json({ ok: `Ingreso "${nombre}" actualizado.`, id: previo.id })
  }
  const nuevo = id()
  db.prepare(
    `INSERT INTO incomes (id, name, owner, amount_cents, floor_cents, currency, day_of_month, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(nuevo, nombre, b.titular ?? '', b.importeCents, piso, moneda, dia, now())
  return NextResponse.json({ ok: `Ingreso "${nombre}" creado.`, id: nuevo })
}
