/**
 * Cada cuánto vence un servicio.
 *
 * La app nació dando por hecho que todo se paga todos los meses, y para la luz
 * o el arriendo eso es cierto. Para la declaración de renta no: se paga una vez
 * al año y el resto de los meses no existe. Mientras la frecuencia no se
 * modelara, la app generaba esa factura los doce meses y el gasto fijo del mes
 * quedaba inflado por algo que nadie va a pagar — plata que parecía
 * comprometida sin estarlo, que es justo el error que más caro sale cuando se
 * está mirando si el mes cierra.
 *
 * El período es el ancla: dice en qué mes cae, y de ahí salen los demás
 * contando de a `pasoMeses`.
 */

export const FRECUENCIAS = {
  mensual: 1,
  bimestral: 2,
  trimestral: 3,
  semestral: 6,
  anual: 12,
} as const

export type Frecuencia = keyof typeof FRECUENCIAS

export const FRECUENCIA_LABELS: Record<Frecuencia, string> = {
  mensual: 'Todos los meses',
  bimestral: 'Cada 2 meses',
  trimestral: 'Cada 3 meses',
  semestral: 'Cada 6 meses',
  anual: 'Una vez al año',
}

export const FRECUENCIA_DEFAULT: Frecuencia = 'mensual'

export const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

/** Lo guardado en la base es texto libre: puede venir vacío o de una versión vieja. */
export function normalizarFrecuencia(valor: string | null | undefined): Frecuencia {
  return valor && valor in FRECUENCIAS ? (valor as Frecuencia) : FRECUENCIA_DEFAULT
}

/** 1–12. El 0 que dejaban las filas viejas se lee como enero. */
export function normalizarMesAncla(valor: number | null | undefined): number {
  if (!valor || !Number.isFinite(valor)) return 1
  return Math.min(12, Math.max(1, Math.trunc(valor)))
}

/**
 * Lo mínimo para saber cuándo cae algo. Los dos campos son opcionales a
 * propósito: lo que no declara frecuencia es mensual, que es lo que era todo
 * antes de que esto existiera y sigue siendo casi todo.
 */
export interface ConFrecuencia {
  frequency?: string | null
  anchor_month?: number | null
}

/**
 * Si un servicio con esta frecuencia vence en ese período ('YYYY-MM').
 *
 * Mensual siempre cae, sin mirar el ancla: es el caso de casi todo y no tiene
 * sentido pedir un mes de referencia para algo que pasa los doce.
 */
export function venceEnPeriodo(servicio: ConFrecuencia, period: string): boolean {
  const frecuencia = normalizarFrecuencia(servicio.frequency)
  const paso = FRECUENCIAS[frecuencia]
  if (paso === 1) return true

  const mes = Number(period.slice(5, 7))
  if (!mes || mes < 1 || mes > 12) return false

  const ancla = normalizarMesAncla(servicio.anchor_month)
  // El módulo de JS devuelve negativo para negativos; el `+ 12` lo evita.
  return (((mes - ancla) % paso) + paso) % paso === 0
}

/** Cómo describirle al usuario cuándo cae, ya con el mes puesto. */
export function describirFrecuencia(servicio: ConFrecuencia): string {
  const frecuencia = normalizarFrecuencia(servicio.frequency)
  if (frecuencia === 'mensual') return FRECUENCIA_LABELS.mensual
  const mes = MESES[normalizarMesAncla(servicio.anchor_month) - 1]
  if (frecuencia === 'anual') return `Cada ${mes}`
  return `${FRECUENCIA_LABELS[frecuencia]}, desde ${mes}`
}
