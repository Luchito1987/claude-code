import { NextResponse } from 'next/server'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { estadoPresupuesto, guardarPresupuesto } from '@/lib/queries'
import { MONEDA_BASE, type Moneda } from '@/lib/money'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const monedaDe = (m: unknown): Moneda | null => (m === undefined ? MONEDA_BASE : m === 'COP' || m === 'ARS' ? m : null)
const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Cómo va el presupuesto de gasto variable: cuánto se gastó y cuánto queda. */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const moneda = monedaDe(new URL(req.url).searchParams.get('moneda') ?? undefined)
  if (!moneda) return NextResponse.json({ error: 'Moneda inválida (COP o ARS).' }, { status: 400 })
  return NextResponse.json(estadoPresupuesto(moneda))
}

/**
 * Fija el presupuesto de gasto variable de una moneda:
 * `{moneda, montoCents, desde, hasta}`, o `{moneda, borrar: true}` para volver
 * al promedio de los últimos 90 días.
 */
export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const b = (await req.json().catch(() => ({}))) as {
    moneda?: string
    montoCents?: number
    desde?: string
    hasta?: string
    borrar?: boolean
  }
  const moneda = monedaDe(b.moneda)
  if (!moneda) return NextResponse.json({ error: 'Moneda inválida (COP o ARS).' }, { status: 400 })
  if (b.borrar) {
    guardarPresupuesto(moneda, null)
    return NextResponse.json({ ok: `Presupuesto ${moneda} borrado.` })
  }
  if (
    !Number.isInteger(b.montoCents) ||
    b.montoCents! < 0 ||
    !FECHA.test(b.desde ?? '') ||
    !FECHA.test(b.hasta ?? '') ||
    b.desde! > b.hasta!
  ) {
    return NextResponse.json(
      { error: 'Hace falta montoCents (entero ≥ 0), desde y hasta (AAAA-MM-DD, desde ≤ hasta).' },
      { status: 400 },
    )
  }
  guardarPresupuesto(moneda, { montoCents: b.montoCents!, desde: b.desde!, hasta: b.hasta! })
  return NextResponse.json({ ok: `Presupuesto ${moneda} guardado.`, estado: estadoPresupuesto(moneda) })
}
