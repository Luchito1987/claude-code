import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'
import { claveValida, noAutorizado } from '@/lib/api-token'
import { accountBalanceCents, listAccounts, listCards } from '@/lib/queries'
import { addMonths, todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Lo que hace falta saber antes de subir algo: qué cuentas y tarjetas existen,
 * cuánto da cada saldo, y qué se importó ya, con el rango de fechas que cubre
 * cada importación. Sólo lectura.
 */
export async function GET(req: Request) {
  if (!claveValida(req)) return noAutorizado()
  const db = getDb()
  const hoy = todayISO()

  const cuentas = listAccounts().map((a) => ({
    id: a.id,
    nombre: a.name,
    moneda: a.currency,
    saldoCents: accountBalanceCents(a.id, hoy),
    anclaCents: a.anchor_cents,
    anclaFecha: a.anchor_date || null,
  }))
  const tarjetas = listCards().map((c) => ({ id: c.id, nombre: c.name, emisor: c.issuer, cupoCents: c.limit_cents }))
  const importaciones = db
    .prepare(
      `SELECT s.id, s.kind AS tipo, COALESCE(a.name, c.name) AS destino, s.account_id AS cuentaId, s.card_id AS tarjetaId,
              s.file_name AS archivo, s.period AS periodo, s.rows_count AS filas, s.imported_at AS importado,
              MIN(t.date) AS desde, MAX(t.date) AS hasta, COUNT(t.id) AS movimientos
       FROM statements s
       LEFT JOIN accounts a ON a.id = s.account_id
       LEFT JOIN cards c ON c.id = s.card_id
       LEFT JOIN transactions t ON t.statement_id = s.id
       GROUP BY s.id ORDER BY s.imported_at`,
    )
    .all()
  const porMes = db
    .prepare(
      `SELECT a.name AS cuenta, substr(t.date, 1, 7) AS mes, COUNT(*) AS movimientos, SUM(t.amount_cents) AS netoCents
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       GROUP BY a.name, mes ORDER BY a.name, mes`,
    )
    .all()

  const servicios = db
    .prepare(
      `SELECT id, name AS nombre, match_pattern AS patronPago, expected_amount_cents AS esperadoCents,
              due_day AS dia, frequency AS frecuencia, active AS activo
       FROM services ORDER BY name`,
    )
    .all()
  // Las facturas de los últimos meses: lo que está pendiente es lo que importa.
  const facturas = db
    .prepare(
      `SELECT b.id, s.name AS servicio, b.period AS periodo, b.amount_cents AS importeCents,
              b.due_date AS vence, b.status AS estado, b.estimated AS estimada
       FROM bills b JOIN services s ON s.id = b.service_id
       WHERE b.period >= ? ORDER BY b.period, b.due_date`,
    )
    .all(addMonths(hoy, -2).slice(0, 7))

  return NextResponse.json({ hoy, cuentas, tarjetas, importaciones, porMes, servicios, facturas })
}
