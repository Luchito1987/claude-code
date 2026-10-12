import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { reconcileCardPayments } from '@/lib/queries'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Vuelve a cruzar los pagos de tarjeta contra lo ya cargado, y devuelve qué
 * meses de qué tarjeta quedaron pagados y con cuánto.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  return NextResponse.json({ conciliados: reconcileCardPayments() })
}
