import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { calcularPlan, guardarPlan, type PlanArgentina } from '@/lib/plan-argentina'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El plan de mudanza a Argentina, ya calculado. */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  return NextResponse.json(calcularPlan())
}

/** Cambia supuestos del plan (los campos que vengan; el resto queda igual). */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const cambios = (await req.json().catch(() => ({}))) as Partial<PlanArgentina>
  return NextResponse.json({ ok: 'Plan actualizado.', plan: guardarPlan(cambios) })
}
