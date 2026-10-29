import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { currentBurnCents, monthlyProjection } from '@/lib/queries'
import type { Moneda } from '@/lib/money'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** La proyección mensual de una moneda (?moneda=ARS), con su detalle. Sólo lectura. */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const u = new URL(req.url)
  const moneda: Moneda = u.searchParams.get('moneda') === 'ARS' ? 'ARS' : 'COP'
  const meses = Number(u.searchParams.get('meses') ?? 6) || 6
  return NextResponse.json({
    moneda,
    gastoVariableDiarioCents: currentBurnCents(undefined, moneda),
    meses: monthlyProjection(meses, undefined, moneda),
  })
}
