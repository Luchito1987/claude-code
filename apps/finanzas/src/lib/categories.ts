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

const RULES: Array<{ re: RegExp; category: Category }> = [
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
  { re: /\bCUOTA\s?PRESTAMO|PRESTAMO|CREDITO\s?PERSONAL|REFINANCIACION/i, category: 'prestamos' },
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

/** Nombre del comercio, sin los prefijos que agregan los bancos. */
export function extractMerchant(description: string): string {
  return description
    .replace(/^(COMPRA|CONSUMO|DEBITO|PAGO|COMPRAS?)\s+/i, '')
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
  ingresos: 'Ingresos',
  otros: 'Otros',
}
