import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Carga cómo aparece el pago de una tarjeta en el extracto de la cuenta
 * ("PAGO SUC VIRT TC VISA"). Es lo único de la tarjeta que se puede tocar por
 * acá: sin eso, los pagos que salen de las cuentas no se reconocen como pago
 * de la tarjeta y quedan contados como gasto.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { tarjeta, patronPago } = (await req.json().catch(() => ({}))) as { tarjeta?: string; patronPago?: string }
  const patron = (patronPago ?? '').trim()
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
