/**
 * Categorización por comercio. Se aplica sobre la descripción cruda del extracto,
 * que suele venir en mayúsculas y con ruido ("COMPRA 1234 RAPPI*RESTAURANT BA").
 */

export const CATEGORIES = [
  'delivery',
  'supermercado',
  'transporte',
  'combustible',
  'servicios',
  'salud',
  'educacion',
  'entretenimiento',
  'indumentaria',
  'hogar',
  'restaurante',
  'farmacia',
  'impuestos',
  'prestamos',
  'transferencias',
  'pago_tarjeta',
  'ingresos',
  'otros',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Categorías sobre las que sí se puede recortar en el corto plazo. */
export const VARIABLE_CATEGORIES: Category[] = [
  'delivery',
  'restaurante',
  'entretenimiento',
  'indumentaria',
  'hogar',
  'supermercado',
  'transporte',
]

/** Gastos comprometidos: no se recortan de una semana a la otra. */
export const FIXED_CATEGORIES: Category[] = ['servicios', 'educacion', 'salud', 'impuestos', 'prestamos']

/**
 * Rubros que quedan fuera del bloque "Gastos variables" del mes: cada uno ya
 * tiene su propia línea —el resumen de la tarjeta, la cuota del préstamo, la
 * factura del servicio— o directamente no es un gasto. Sumarlos ahí sería
 * contarlos dos veces.
 */
export const NON_VARIABLE_CATEGORIES: Category[] = [
  'pago_tarjeta',
  'transferencias',
  'servicios',
  'prestamos',
  'impuestos',
  'ingresos',
]

/**
 * Las que se ofrecen al cargar un gasto suelto a mano. Es el complemento exacto
 * de `NON_VARIABLE_CATEGORIES`: elegir cualquier otra haría que el gasto se
 * guarde pero no aparezca en el bloque de variables.
 */
export const MANUAL_EXPENSE_CATEGORIES: Category[] = CATEGORIES.filter(
  (c) => !NON_VARIABLE_CATEGORIES.includes(c),
)

/**
 * Rubros que no puede tener un servicio que se factura mes a mes: una cuota de
 * préstamo y un resumen de tarjeta se cargan en su propia pantalla y ya tienen
 * su bloque en el mes, así que darlos de alta también como servicio contaría el
 * mismo pago dos veces. Un ingreso o una transferencia directamente no son una
 * factura.
 */
const NOT_BILLABLE: Category[] = ['ingresos', 'pago_tarjeta', 'transferencias', 'prestamos']

/** Las que se ofrecen al dar de alta un servicio. */
export const BILLABLE_CATEGORIES: Category[] = CATEGORIES.filter((c) => !NOT_BILLABLE.includes(c))

const RULES: Array<{ re: RegExp; category: Category }> = [
  // Estas tres van primero: sus palabras aparecen dentro de otros comercios
  // ("PRESTAMO PERSONAL" contra Personal telefonía, "PAGO TARJETA VISA" contra
  // cualquier consumo con Visa en el detalle).
  { re: /\bPAGO\s+(DE\s+)?(TARJETA|RESUMEN|VISA|MASTER\s?CARD|MASTERCARD|AMEX|AMERICAN\s?EXPRESS|CABAL)/i, category: 'pago_tarjeta' },
  { re: /\bCUOTA\s?PRESTAMO|PRESTAMO|CREDITO\s?PERSONAL|REFINANCIACION/i, category: 'prestamos' },
  { re: /\bRAPPI|RAPI\*|RAPPIPRO|RAPPI\s?FAVOR/i, category: 'delivery' },
  { re: /\bPEDIDOS\s?YA|PEDIDOSYA|UBER\s?EATS|MC\s?DELIVERY|GLOVO/i, category: 'delivery' },
  { re: /\bCARREFOUR|COTO|JUMBO|DIA%|DIA\b|VEA\b|DISCO\b|LIBERTAD|CHANGOMAS|MAKRO|VITAL\b/i, category: 'supermercado' },
  { re: /\bFARMACITY|FARMACIA|FARMAONLINE|DR\.?\s?AHORRO|SIMILARES/i, category: 'farmacia' },
  { re: /\bYPF|SHELL|AXION|PUMA\s?ENERGY|GNC\b/i, category: 'combustible' },
  { re: /\bUBER\b|CABIFY|DIDI\b|SUBE\b|PEAJE|AUSA|AUTOPISTA/i, category: 'transporte' },
  { re: /\bEDENOR|EDESUR|EDEA|EPEC|METROGAS|CAMUZZI|NATURGY|AYSA|AGUAS\b/i, category: 'servicios' },
  { re: /\bPERSONAL|MOVISTAR|CLARO|FIBERTEL|TELECENTRO|FLOW\b|IPLAN|STARLINK/i, category: 'servicios' },
  { re: /\bNETFLIX|SPOTIFY|DISNEY|HBO|MAX\b|PRIME\s?VIDEO|YOUTUBE\s?PREMIUM|APPLE\.COM\/BILL|GOOGLE\s?\*|PARAMOUNT/i, category: 'entretenimiento' },
  { re: /\bCINE|CINEMARK|HOYTS|SHOWCASE|TEATRO|TICKETEK|PASSLINE/i, category: 'entretenimiento' },
  { re: /\bOSDE|SWISS\s?MEDICAL|GALENO|MEDIFE|OMINT|SANATORIO|HOSPITAL|LABORATORIO/i, category: 'salud' },
  { re: /\bCOLEGIO|INSTITUTO|UNIVERSIDAD|CUOTA\s?ESCOLAR|JARDIN\b|UDEMY|PLATZI|COURSERA/i, category: 'educacion' },
  { re: /\bZARA|H&M|ADIDAS|NIKE|DEXTER|FALABELLA|MERCADOLIBRE|MERCADO\s?LIBRE|SHEIN|DAFITI/i, category: 'indumentaria' },
  { re: /\bEASY\b|SODIMAC|FERRETERIA|PINTURERIA|MUEBLES|IKEA/i, category: 'hogar' },
  { re: /\bAFIP|ARBA|AGIP|RENTAS|MONOTRIBUTO|IIBB|IMPUESTO|SELLOS/i, category: 'impuestos' },
  { re: /\bTRANSFERENCIA|TRANSF\b|CVU|CBU|DEBIN|MERCADO\s?PAGO\s?TRANSF/i, category: 'transferencias' },
  { re: /\bSUELDO|HABERES|ACREDITACION\s?HABERES|REMUNERACION|HONORARIOS/i, category: 'ingresos' },
  { re: /\bMOSTAZA|MCDONALD|BURGER\s?KING|STARBUCKS|HAVANNA|BAR\b|RESTO\b|PARRILLA|PIZZ/i, category: 'restaurante' },
]

export interface UserRule {
  pattern: string
  category: string
  priority: number
}

/**
 * Devuelve la categoría de una descripción. Las reglas del usuario (tabla
 * category_rules) ganan sobre las reglas de fábrica.
 */
export function categorize(description: string, userRules: UserRule[] = []): Category {
  const text = description.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  const sorted = [...userRules].sort((a, b) => a.priority - b.priority)
  for (const rule of sorted) {
    if (text.toLowerCase().includes(rule.pattern.toLowerCase())) {
      return (CATEGORIES as readonly string[]).includes(rule.category)
        ? (rule.category as Category)
        : 'otros'
    }
  }
  for (const rule of RULES) {
    if (rule.re.test(text)) return rule.category
  }
  return 'otros'
}

const RAPPI_RE = /\bRAPPI|RAPI\*|RAPPIPRO/i

export function isRappi(description: string): boolean {
  return RAPPI_RE.test(description)
}

/** Nombre del comercio, sin los prefijos ni la marca de cuota que agrega el banco. */
export function extractMerchant(description: string): string {
  return description
    .replace(/^(COMPRA|CONSUMO|DEBITO|PAGO|COMPRAS?)\s+/i, '')
    .replace(/\s+\d{1,2}\s*\/\s*\d{1,2}\s*$/, '')
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*\*\s*/g, ' ')
    .trim()
    .slice(0, 60)
}

export const CATEGORY_LABELS: Record<string, string> = {
  delivery: 'Delivery',
  supermercado: 'Supermercado',
  transporte: 'Transporte',
  combustible: 'Combustible',
  servicios: 'Servicios',
  salud: 'Salud',
  educacion: 'Educación',
  entretenimiento: 'Entretenimiento',
  indumentaria: 'Indumentaria',
  hogar: 'Hogar',
  restaurante: 'Restaurantes',
  farmacia: 'Farmacia',
  impuestos: 'Impuestos',
  prestamos: 'Préstamos',
  transferencias: 'Transferencias',
  pago_tarjeta: 'Pago de tarjeta',
  ingresos: 'Ingresos',
  otros: 'Otros',
}

/**
 * Traduce el nombre de categoría que trae una planilla propia ("Comida", "Auto",
 * "Deudas") a las categorías de la app. Devuelve null cuando no hay equivalente
 * claro, para que en ese caso decida el detalle del movimiento.
 */
const SINONIMOS: Array<[RegExp, Category]> = [
  [/^(delivery|pedidos?\s?ya|rappi|comida\s?a\s?domicilio)$/i, 'delivery'],
  [/^(super|supermercado|almacen|alimentos?|comida|mercado|verduler[ií]a|carnicer[ií]a)$/i, 'supermercado'],
  [/^(resto|restaurante|salidas?\s?a\s?comer|bares?)$/i, 'restaurante'],
  [/^(auto|nafta|combustible|gasoil|gnc|vehiculo|veh[ií]culo)$/i, 'combustible'],
  [/^(transporte|viajes?\s?diarios?|sube|taxi|colectivo)$/i, 'transporte'],
  [/^(servicios?|expensas|luz|gas|agua|internet|telefon[ií]a|cable)$/i, 'servicios'],
  [/^(salud|medicina|prepaga|obra\s?social|m[eé]dico)$/i, 'salud'],
  [/^(farmacia|remedios?|medicamentos?)$/i, 'farmacia'],
  [/^(educaci[oó]n|colegio|escuela|cuota\s?escolar|universidad|cursos?)$/i, 'educacion'],
  [/^(ocio|entretenimiento|salidas?|streaming|suscripciones?|cine)$/i, 'entretenimiento'],
  [/^(ropa|indumentaria|vestimenta|calzado)$/i, 'indumentaria'],
  [/^(hogar|casa|muebles|ferreter[ií]a|mantenimiento)$/i, 'hogar'],
  [/^(impuestos?|afip|arba|monotributo|patente|abl)$/i, 'impuestos'],
  [/^(deudas?|pr[eé]stamos?|cuotas?|cr[eé]ditos?)$/i, 'prestamos'],
  [/^(transferencias?|env[ií]os?)$/i, 'transferencias'],
  [/^(ingresos?|sueldos?|haberes|cobros?)$/i, 'ingresos'],
]

export function mapCategoryName(raw: string): Category | null {
  const texto = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  if (!texto) return null
  if ((CATEGORIES as readonly string[]).includes(texto.toLowerCase())) return texto.toLowerCase() as Category
  for (const [re, cat] of SINONIMOS) if (re.test(texto)) return cat
  return null
}
