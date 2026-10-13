import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
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

/**
 * Da de baja (o reactiva) un préstamo: uno terminado deja de aparecer en el
 * tablero. No borra nada; lo ya pagado sigue en los movimientos.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { prestamo, activo } = (await req.json().catch(() => ({}))) as { prestamo?: string; activo?: boolean }
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
