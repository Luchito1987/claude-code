import { NextResponse } from 'next/server'
import { claveValida, duenio, noAutorizado } from '@/lib/api-token'
import { importarExtracto } from '@/lib/importar'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Importa un extracto por el mismo camino que la pantalla de Importar: mismo
 * lector, mismas guardas contra duplicados, misma conciliación. Recibe el
 * formulario tal cual lo manda la pantalla (`file`, `kind`, `target` y, si
 * hace falta, `reemplazar=si`) y devuelve el resultado como JSON.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const user = duenio()
  if (!user) return NextResponse.json({ error: 'La app todavía no tiene usuario.' }, { status: 409 })

  const form = await req.formData()
  const resultado = await importarExtracto(form, user)
  return NextResponse.json(resultado, { status: resultado.error ? 422 : 200 })
}
