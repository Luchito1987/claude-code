import { NextResponse } from 'next/server'
import { getDb, id, now } from '@/db/client'
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

/**
 * Carga a mano un movimiento de una cuenta que todavía no llegó en un archivo
 * (un pago hecho hoy), para que el saldo no quede inflado mientras tanto.
 *
 * `compromiso` ('tarjeta:<id>', 'factura:<id>'...) dice qué paga, para que no
 * se cuente además como gasto variable. Cuando llegue el archivo del banco con
 * ese movimiento, hay que borrar este con DELETE antes de subirlo: los textos
 * no coinciden y se duplicaría.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const b = (await req.json().catch(() => ({}))) as {
    cuenta?: string
    fecha?: string
    descripcion?: string
    importeCents?: number
    categoria?: string
    compromiso?: string
  }
  const descripcion = (b.descripcion ?? '').trim()
  if (!b.cuenta || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha ?? '') || !descripcion || !Number.isInteger(b.importeCents) || !b.importeCents) {
    return NextResponse.json(
      { error: 'Hace falta cuenta, fecha (AAAA-MM-DD), descripción e importeCents entero distinto de cero.' },
      { status: 400 },
    )
  }
  if (b.compromiso && !/^(factura|tarjeta|prestamo|interna):[\w-]+$/.test(b.compromiso)) {
    return NextResponse.json({ error: 'Compromiso inválido.' }, { status: 400 })
  }
  const db = getDb()
  const cuenta = db.prepare('SELECT id, name, currency FROM accounts WHERE id = ? OR lower(name) = lower(?)').get(b.cuenta, b.cuenta) as
    | { id: string; name: string; currency: string }
    | undefined
  if (!cuenta) return NextResponse.json({ error: `No existe la cuenta "${b.cuenta}".` }, { status: 404 })
  const nuevo = id()
  db.prepare(
    `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
       account_id, source, commitment, created_at)
     VALUES (?, ?, ?, '', ?, ?, ?, 'transferencia', ?, 'manual', ?, ?)`,
  ).run(nuevo, b.fecha, descripcion, b.importeCents, cuenta.currency, b.categoria || 'otros', cuenta.id, b.compromiso ?? '', now())
  return NextResponse.json({ ok: `${cuenta.name}: movimiento cargado.`, id: nuevo })
}

/** Borra un movimiento cargado a mano. Los importados se deshacen con su archivo. */
export async function DELETE(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const movimiento = new URL(req.url).searchParams.get('id')
  if (!movimiento) return NextResponse.json({ error: 'Falta el id.' }, { status: 400 })
  const r = getDb().prepare("DELETE FROM transactions WHERE id = ? AND source = 'manual'").run(movimiento)
  if (!r.changes) return NextResponse.json({ error: 'No hay un movimiento manual con ese id.' }, { status: 404 })
  return NextResponse.json({ ok: 'Movimiento borrado.' })
}
