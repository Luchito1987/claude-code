/**
 * Acceso por clave, para cargar extractos sin la sesión del navegador.
 *
 * La app se protege con usuario, contraseña y segundo factor, y eso está bien
 * para una persona. Pero para que un asistente suba los extractos hace falta
 * otra puerta, y ésta se abre sólo si el servidor tiene configurada una clave
 * larga (`FINANZAS_API_TOKEN`, que genera el script de arranque). Sin clave,
 * o con una corta, la API entera responde "no autorizado": nunca queda una
 * puerta abierta por olvido.
 *
 * La clave se compara en tiempo constante, para que no se pueda adivinar
 * midiendo cuánto tarda en responder. Las dos se pasan por SHA-256 antes de
 * compararlas porque `timingSafeEqual` exige el mismo largo y el largo de la
 * clave tampoco debería filtrarse.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'

const LARGO_MINIMO = 32

export function apiHabilitada(): boolean {
  return (process.env.FINANZAS_API_TOKEN ?? '').length >= LARGO_MINIMO
}

export function claveValida(req: Request): boolean {
  if (!apiHabilitada()) return false
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('authorization') ?? '')
  if (!m) return false
  const recibida = createHash('sha256').update(m[1]).digest()
  const esperada = createHash('sha256').update(process.env.FINANZAS_API_TOKEN!).digest()
  return timingSafeEqual(recibida, esperada)
}

export function noAutorizado(): NextResponse {
  return NextResponse.json({ error: 'No autorizado.' }, { status: 401 })
}

/**
 * Las importaciones quedan a nombre de la persona dueña de la app, que es
 * quien autorizó la clave: así se ven en el historial igual que las que hace
 * desde la pantalla.
 */
export function duenio(): { id: string; name: string } | undefined {
  return getDb().prepare('SELECT id, name FROM users ORDER BY created_at LIMIT 1').get() as
    | { id: string; name: string }
    | undefined
}
