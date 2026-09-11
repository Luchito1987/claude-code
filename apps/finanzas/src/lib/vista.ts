/**
 * Desde qué país se está mirando la app.
 *
 * La casa vive en Colombia pero el plan es mudarse a Argentina, y mientras
 * tanto hay plata de los dos lados: un sueldo y obligaciones allá, la vida
 * diaria acá. Cada vista muestra un solo bolsillo —su moneda, sus deudas, su
 * flujo— porque sumar pesos de dos países en un mismo total no da una cifra
 * con significado, da un promedio de dos realidades distintas.
 *
 * La vista se guarda en una cookie para que sobreviva a la navegación, y el
 * país con el que arranca cada sesión se elige en Configuración: el día que se
 * muden, se cambia ahí y la app queda mirando al otro lado.
 */

import { cookies } from 'next/headers'
import { getDb } from '@/db/client'
import type { Moneda } from './money'

export type CodigoPais = 'CO' | 'AR'

export interface Pais {
  codigo: CodigoPais
  nombre: string
  moneda: Moneda
}

export const PAISES: readonly Pais[] = [
  { codigo: 'CO', nombre: 'Colombia', moneda: 'COP' },
  { codigo: 'AR', nombre: 'Argentina', moneda: 'ARS' },
] as const

const COOKIE = 'finz_vista'
const CLAVE_DEFECTO = 'pais_default'

function pais(codigo: string | undefined): Pais | undefined {
  return PAISES.find((p) => p.codigo === codigo)
}

/** Con qué país abre la app cuando todavía no se eligió nada en esta sesión. */
export function paisPorDefecto(): Pais {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(CLAVE_DEFECTO) as
    | { value: string }
    | undefined
  return pais(row?.value) ?? PAISES[0]
}

export function setPaisPorDefecto(codigo: CodigoPais): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(CLAVE_DEFECTO, codigo)
}

export function vistaActual(): Pais {
  return pais(cookies().get(COOKIE)?.value) ?? paisPorDefecto()
}

export function setVista(codigo: CodigoPais): void {
  cookies().set(COOKIE, codigo, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 365 * 86400,
  })
}

/** Atajo para lo que más se pregunta: en qué moneda se está mirando. */
export function monedaActual(): Moneda {
  return vistaActual().moneda
}
