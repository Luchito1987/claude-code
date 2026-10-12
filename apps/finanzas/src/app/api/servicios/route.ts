import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { randomUUID } from 'node:crypto'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { describirFrecuencia, normalizarFrecuencia, normalizarMesAncla } from '@/lib/frecuencia'
import { dropBillsOutsideFrequency } from '@/lib/queries'
import { financialMonth } from '@/lib/dates'

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
  const { servicio, patronPago, numeroContrato, frecuencia, mesAncla, crear } = (await req.json().catch(() => ({}))) as {
    servicio?: string
    patronPago?: string
    numeroContrato?: string
    frecuencia?: string
    mesAncla?: number
    crear?: Alta
  }
  const patron = (patronPago ?? '').trim()
  const contrato = (numeroContrato ?? '').trim()
  if (crear) return alta(crear, patron, contrato)
  if (!servicio || (patron.length < 4 && !contrato && !frecuencia)) {
    return NextResponse.json(
      { error: 'Hace falta el servicio y algo que cambiar: patrón de pago (4 caracteres o más), número de contrato o frecuencia.' },
      { status: 400 },
    )
  }
  const db = getDb()
  const encontrados = db
    .prepare('SELECT id, name FROM services WHERE id = ? OR lower(name) = lower(?)')
    .all(servicio, servicio) as Array<{ id: string; name: string }>
  if (!encontrados.length) return NextResponse.json({ error: `No existe el servicio "${servicio}".` }, { status: 404 })
  if (encontrados.length > 1) return NextResponse.json({ error: `Hay más de un servicio "${servicio}": usá el id.` }, { status: 409 })
  const hechos: string[] = []
  if (patron.length >= 4) {
    db.prepare('UPDATE services SET match_pattern = ? WHERE id = ?').run(patron, encontrados[0].id)
    hechos.push(`su pago se reconoce por "${patron}"`)
  }
  if (contrato) {
    db.prepare('UPDATE services SET contract_number = ? WHERE id = ?').run(contrato, encontrados[0].id)
    hechos.push(`contrato ${contrato}`)
  }
  if (frecuencia) {
    const f = normalizarFrecuencia(frecuencia)
    const ancla = normalizarMesAncla(mesAncla)
    db.prepare('UPDATE services SET frequency = ?, anchor_month = ? WHERE id = ?').run(f, ancla, encontrados[0].id)
    const borradas = dropBillsOutsideFrequency(encontrados[0].id, financialMonth())
    hechos.push(
      `${describirFrecuencia({ frequency: f, anchor_month: ancla }).toLowerCase()}` +
        (borradas.length ? ` (se quitaron las facturas de ${borradas.join(', ')}, que no correspondían)` : ''),
    )
  }
  return NextResponse.json({ ok: `${encontrados[0].name}: ${hechos.join('; ')}.` })
}

function alta(a: Alta, patron: string, contrato: string) {
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
    `INSERT INTO services (id, name, category, expected_amount_cents, due_day, active, match_pattern, frequency, contract_number, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(id, nombre, a.categoria || 'servicios', Math.round(a.esperadoCents), Math.trunc(a.dia), patron, normalizarFrecuencia(a.frecuencia), contrato, new Date().toISOString())
  return NextResponse.json({ ok: `Servicio "${nombre}" creado.`, id })
}
