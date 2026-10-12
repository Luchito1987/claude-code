import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { randomUUID } from 'node:crypto'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { normalizarFrecuencia } from '@/lib/frecuencia'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Carga cómo aparece el pago de un servicio en el extracto ("SOI ACH" para la
 * PILA): sin eso, la factura sigue pendiente aunque el pago ya esté cargado.
 *
 * Con `crear` da de alta un servicio nuevo, para un pago fijo que la app no
 * conocía —una segunda PILA, por ejemplo—. No modifica ni borra servicios
 * existentes más allá del patrón de pago.
 */
interface Alta {
  nombre: string
  esperadoCents: number
  dia: number
  categoria?: string
  frecuencia?: string
}

export async function POST(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const { servicio, patronPago, crear } = (await req.json().catch(() => ({}))) as {
    servicio?: string
    patronPago?: string
    crear?: Alta
  }
  const patron = (patronPago ?? '').trim()
  if (crear) return alta(crear, patron)
  if (!servicio || patron.length < 4) {
    return NextResponse.json({ error: 'Hace falta el servicio y un texto de al menos 4 caracteres.' }, { status: 400 })
  }
  const db = getDb()
  const encontrados = db
    .prepare('SELECT id, name FROM services WHERE id = ? OR lower(name) = lower(?)')
    .all(servicio, servicio) as Array<{ id: string; name: string }>
  if (!encontrados.length) return NextResponse.json({ error: `No existe el servicio "${servicio}".` }, { status: 404 })
  if (encontrados.length > 1) return NextResponse.json({ error: `Hay más de un servicio "${servicio}": usá el id.` }, { status: 409 })
  db.prepare('UPDATE services SET match_pattern = ? WHERE id = ?').run(patron, encontrados[0].id)
  return NextResponse.json({ ok: `${encontrados[0].name}: su pago se reconoce por "${patron}".` })
}

function alta(a: Alta, patron: string) {
  const nombre = (a.nombre ?? '').trim()
  if (!nombre || !(a.esperadoCents > 0) || !(a.dia >= 1 && a.dia <= 31)) {
    return NextResponse.json({ error: 'Para crear un servicio hace falta nombre, importe esperado y día (1-31).' }, { status: 400 })
  }
  const db = getDb()
  if (db.prepare('SELECT 1 FROM services WHERE lower(name) = lower(?)').get(nombre)) {
    return NextResponse.json({ error: `Ya existe un servicio "${nombre}".` }, { status: 409 })
  }
  const id = randomUUID()
  db.prepare(
    `INSERT INTO services (id, name, category, expected_amount_cents, due_day, active, match_pattern, frequency, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).run(id, nombre, a.categoria || 'servicios', Math.round(a.esperadoCents), Math.trunc(a.dia), patron, normalizarFrecuencia(a.frecuencia), new Date().toISOString())
  return NextResponse.json({ ok: `Servicio "${nombre}" creado.`, id })
}
