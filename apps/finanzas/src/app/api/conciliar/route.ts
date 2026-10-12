import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { ensureBillsForPeriod, reconcileBills, reconcileCardPayments } from '@/lib/queries'
import { financialMonth } from '@/lib/dates'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Vuelve a cruzar los pagos de tarjeta y de facturas contra lo ya cargado, y
 * devuelve qué quedó pagado y con cuánto.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  // Las facturas del mes se generan al mirar el tablero; un servicio recién
  // creado todavía no tiene la suya y su pago no tendría contra qué cruzarse.
  ensureBillsForPeriod(financialMonth())
  return NextResponse.json({ conciliados: reconcileCardPayments(), facturas: reconcileBills() })
}
