import { NextResponse } from 'next/server'
import { getDb, id, now } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { listLoans } from '@/lib/queries'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Los préstamos cargados, con cuántas cuotas van pagadas. */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  return NextResponse.json(
    listLoans().map((l) => ({
      id: l.id,
      nombre: l.name,
      cuotaCents: l.installment_cents,
      pagadas: l.installments_paid,
      total: l.installments_total,
      activo: l.active === 1,
    })),
  )
}

/** Un préstamo nuevo, con su plan de cuotas. */
interface Alta {
  nombre: string
  prestamista?: string
  capitalCents: number
  cuotaCents: number
  cuotas: number
  primeraCuota: string
  tasaAnual?: number
  patronPago?: string
}

/**
 * Con `crear` da de alta un préstamo. Si no, da de baja (o reactiva) un préstamo: uno terminado deja de aparecer en el
 * tablero. No borra nada; lo ya pagado sigue en los movimientos.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { prestamo, activo, crear } = (await req.json().catch(() => ({}))) as {
    prestamo?: string
    activo?: boolean
    crear?: Alta
  }
  if (crear) return alta(crear)
  if (!prestamo || typeof activo !== 'boolean') {
    return NextResponse.json({ error: 'Hace falta el préstamo y si queda activo (true/false).' }, { status: 400 })
  }
  const db = getDb()
  const encontrados = db
    .prepare('SELECT id, name FROM loans WHERE id = ? OR lower(name) = lower(?)')
    .all(prestamo, prestamo) as Array<{ id: string; name: string }>
  if (!encontrados.length) return NextResponse.json({ error: `No existe el préstamo "${prestamo}".` }, { status: 404 })
  if (encontrados.length > 1) return NextResponse.json({ error: `Hay más de un préstamo "${prestamo}": usá el id.` }, { status: 409 })
  db.prepare('UPDATE loans SET active = ? WHERE id = ?').run(activo ? 1 : 0, encontrados[0].id)
  return NextResponse.json({ ok: `${encontrados[0].name}: ${activo ? 'activo' : 'dado de baja'}.` })
}

function alta(a: Alta) {
  const nombre = (a.nombre ?? '').trim()
  const enteros = [a.capitalCents, a.cuotaCents, a.cuotas].every((n) => Number.isInteger(n) && n > 0)
  if (!nombre || !enteros || !/^\d{4}-\d{2}-\d{2}$/.test(a.primeraCuota ?? '')) {
    return NextResponse.json(
      { error: 'Para crear un préstamo hace falta nombre, capitalCents, cuotaCents, cuotas y primeraCuota (AAAA-MM-DD).' },
      { status: 400 },
    )
  }
  const db = getDb()
  if (db.prepare('SELECT 1 FROM loans WHERE lower(name) = lower(?)').get(nombre)) {
    return NextResponse.json({ error: `Ya existe un préstamo "${nombre}".` }, { status: 409 })
  }
  const nuevo = id()
  db.prepare(
    `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
     installments_paid, first_due_date, rate_annual, active, match_pattern, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, ?)`,
  ).run(nuevo, nombre, a.prestamista ?? '', a.capitalCents, a.cuotaCents, a.cuotas, a.primeraCuota, a.tasaAnual ?? 0, (a.patronPago ?? '').trim(), now())
  return NextResponse.json({ ok: `Préstamo "${nombre}" creado.`, id: nuevo })
}
