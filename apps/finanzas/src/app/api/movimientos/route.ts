import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Los movimientos de una cuenta o tarjeta en un rango, con el archivo del que
 * vino cada uno. Sirve para comparar, antes de subir un extracto, contra lo
 * que ya está cargado y no duplicar. Sólo lectura.
 */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const u = new URL(req.url)
  const cuenta = u.searchParams.get('cuenta')
  const tarjeta = u.searchParams.get('tarjeta')
  const desde = u.searchParams.get('desde') ?? '0000-00-00'
  const hasta = u.searchParams.get('hasta') ?? '9999-12-31'
  if (!cuenta && !tarjeta) return NextResponse.json({ error: 'Falta la cuenta o la tarjeta.' }, { status: 400 })

  const filas = getDb()
    .prepare(
      `SELECT t.id, t.date AS fecha, t.description AS descripcion, t.amount_cents AS importeCents,
              t.category AS categoria, t.commitment AS compromiso, t.source AS origen, s.file_name AS archivo
       FROM transactions t LEFT JOIN statements s ON s.id = t.statement_id
       WHERE ${cuenta ? 't.account_id = ?' : 't.card_id = ?'} AND t.date BETWEEN ? AND ?
       ORDER BY t.date, t.id`,
    )
    .all(cuenta ?? tarjeta, desde, hasta)
  return NextResponse.json({ movimientos: filas })
}
