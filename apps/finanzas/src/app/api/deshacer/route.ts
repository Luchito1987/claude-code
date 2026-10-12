import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { deleteStatement } from '@/lib/queries'
import { getDb } from '@/db/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Deshace una importación: borra el archivo y sus movimientos, igual que el
 * botón "Deshacer" de la pantalla. Es lo que permite reemplazar una carga
 * parcial por el extracto completo del mismo período.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { id } = (await req.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: 'Falta el id de la importación.' }, { status: 400 })
  const existe = getDb().prepare('SELECT file_name FROM statements WHERE id = ?').get(id) as { file_name: string } | undefined
  if (!existe) return NextResponse.json({ error: 'No existe esa importación.' }, { status: 404 })
  deleteStatement(id)
  return NextResponse.json({ ok: `Importación "${existe.file_name}" deshecha.` })
}
