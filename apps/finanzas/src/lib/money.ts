/** Todo el dinero vive como enteros en centavos. Nada de floats en la base. */

export function toCents(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100)
  const raw = input.trim()
  if (!raw) return 0

  // Limpia símbolos y espacios (incluye el espacio duro que meten los PDF).
  let s = raw.replace(/[$\s ]/g, '').replace(/ARS|USD|AR\$|US\$/gi, '')

  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1)
  }
  if (s.endsWith('-')) {
    negative = true
    s = s.slice(0, -1)
  }

  // Formato local: el último separador que aparece es el decimal si deja 1-2 dígitos.
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const sep = Math.max(lastComma, lastDot)
  let intPart = s
  let decPart = ''
  if (sep !== -1 && s.length - sep - 1 <= 2 && s.length - sep - 1 > 0) {
    intPart = s.slice(0, sep)
    decPart = s.slice(sep + 1)
  }
  intPart = intPart.replace(/[.,]/g, '')
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(decPart)) return 0

  const cents = Number(intPart || '0') * 100 + Number(decPart.padEnd(2, '0').slice(0, 2) || '0')
  return negative ? -cents : cents
}

export function fromCents(cents: number): number {
  return cents / 100
}

/**
 * Las dos monedas de esta casa. El hogar vive en Colombia y sus cuentas,
 * tarjetas y servicios son en pesos colombianos; el sueldo que entra desde
 * Argentina, y las obligaciones que se pagan allá, son en pesos argentinos.
 *
 * No se mezclan nunca sumando: un importe sin su moneda al lado es un número
 * sin significado, y dos montos de monedas distintas sólo se comparan pasando
 * por el tipo de cambio que se consigue de verdad (ver `convertir`).
 */
export type Moneda = 'COP' | 'ARS'

/** La moneda en la que se vive y en la que se decide. */
export const MONEDA_BASE: Moneda = 'COP'

const LOCALES: Record<Moneda, string> = { COP: 'es-CO', ARS: 'es-AR' }

// Construir un Intl.NumberFormat no es gratis y estos se usan en cada fila de
// cada tabla; se arman una vez por moneda.
const cache = new Map<string, Intl.NumberFormat>()

function formateador(currency: Moneda, decimales: boolean): Intl.NumberFormat {
  const clave = `${currency}:${decimales}`
  let f = cache.get(clave)
  if (!f) {
    f = new Intl.NumberFormat(LOCALES[currency], {
      style: 'currency',
      currency,
      // El código y no el símbolo: los dos países usan "$", así que "$ 200.000"
      // no dice si son doscientos mil pesos colombianos o argentinos, que a la
      // cotización de hoy son cifras que no se parecen en nada. Escribir
      // "COP 200.000" es más largo y no deja lugar a leerlo mal.
      currencyDisplay: 'code',
      ...(decimales ? {} : { maximumFractionDigits: 0 }),
    })
    cache.set(clave, f)
  }
  return f
}

export function formatMoney(cents: number, currency: Moneda = MONEDA_BASE): string {
  // El `|| 0` evita que un -0,4 se muestre como "-$ 0".
  return formateador(currency, false).format(Math.round(cents / 100) || 0)
}

export function formatMoneyExact(cents: number, currency: Moneda = MONEDA_BASE): string {
  return formateador(currency, true).format(cents / 100)
}

/**
 * Pasa un importe de una moneda a la otra con el tipo de cambio dado, expresado
 * en cuántos COP vale un ARS.
 *
 * El tipo de cambio lo carga la persona a mano y no sale de ninguna API: quien
 * manda plata de Argentina a Colombia no la cambia al oficial, y el único que
 * sabe a cuánto la pasó de verdad es el que la pasó.
 */
export function convertir(cents: number, desde: Moneda, hacia: Moneda, copPorArs: number): number {
  if (desde === hacia) return cents
  if (!copPorArs) return 0
  return desde === 'ARS'
    ? Math.round(cents * copPorArs)
    : Math.round(cents / copPorArs)
}

export function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}
