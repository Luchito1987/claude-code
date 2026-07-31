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

const fmt = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

export function formatMoney(cents: number): string {
  // El `|| 0` evita que un -0,4 se muestre como "-$ 0".
  return fmt.format(Math.round(cents / 100) || 0)
}

export function formatMoneyExact(cents: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cents / 100)
}

export function pct(part: number, total: number): number {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}
