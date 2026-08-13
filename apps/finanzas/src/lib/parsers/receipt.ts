/**
 * Lectura de un ticket de compra fotografiado.
 *
 * El OCR de una foto de papel térmico es ruidoso: se come tildes, confunde O
 * con 0, parte renglones y a veces manda el importe a la línea siguiente. Así
 * que esto no busca "el número más grande" —eso agarraría el NIT o el número
 * de factura— sino la palabra que marca el total, con dos reglas:
 *
 *   1. Las frases largas ganan: "TOTAL A PAGAR" vale más que "TOTAL" suelto.
 *   2. SUBTOTAL, IVA, CAMBIO y EFECTIVO se descartan explícitamente, porque
 *      todas contienen o rodean a "TOTAL" y son el error clásico.
 *
 * Lo que sale de acá siempre se muestra para confirmar antes de guardar: el
 * objetivo es acertar la mayoría de las veces, no adivinar sin red.
 */

import { toCents } from '../money'
import { parseDate } from './statement'
import { categorize, type Category, type UserRule } from '../categories'
import type { ISODate } from '../dates'

export interface ReceiptRead {
  /** Importe en centavos, positivo. null si no se encontró nada creíble. */
  amountCents: number | null
  merchant: string
  date: ISODate | null
  category: Category
  /**
   * De dónde salió el importe. `total` es una línea que decía total;
   * `mayor` es el número más grande y hay que mirarlo con desconfianza.
   */
  source: 'total' | 'mayor' | 'ninguno'
  /** El texto leído, para poder revisarlo cuando algo sale mal. */
  lines: string[]
}

/** Frases que marcan el total, de la más específica a la más genérica. */
const TOTAL_PHRASES: Array<{ re: RegExp; weight: number }> = [
  { re: /T[O0]TAL\s+A\s+PAGAR/, weight: 100 },
  { re: /NET[O0]\s+A\s+PAGAR/, weight: 100 },
  { re: /VAL[O0]R\s+A\s+PAGAR/, weight: 100 },
  { re: /T[O0]TAL\s+FACTURA/, weight: 90 },
  { re: /T[O0]TAL\s+VENTA/, weight: 90 },
  { re: /T[O0]TAL\s+C[O0]MPRA/, weight: 90 },
  { re: /VAL[O0]R\s+T[O0]TAL/, weight: 90 },
  { re: /\bA\s+PAGAR\b/, weight: 80 },
  { re: /\bT[O0]TAL\b/, weight: 50 },
]

/** "SUB-TOTAL", "SUB TOTAL", "SUBTOTAL": todas la misma cosa. */
const SUBTOTAL = /SUB\s*-?\s*T[O0]TAL/g

/**
 * Renglones que nunca son el total aunque contengan la palabra.
 *
 * Los dos últimos grupos salieron de tickets reales: Olímpica imprime el saldo
 * de puntos como "Total/acuml: 23.427" —plata que no se gastó— y los conteos
 * de cierre ("TOTAL ARTICULOS VENDIDOS: 38") también empiezan con la palabra.
 */
const NOT_TOTAL = /\bIVA\b|IMP[O0]C[O0]NSUM[O0]|\bBASE\b|CAMBI[O0]|DEVUELTA|VUELT[O0]|EFECTIV[O0]|RECIBID[O0]|PR[O0]PINA|DESCUENT[O0]|AH[O0]RR[O0]|PUNT[O0]S|\bCUP[O0]N\b|ACU[MN]|\bL[I1]NEAS?\b|ART[I1]CUL[O0]S?|\bITEMS?\b/

/** Renglones cuyos números son identificadores, no plata. */
const IDENTIFIERS = /\bNIT\b|\bC\.?C\.?\b|\bTEL\b|TELEF[O0]N[O0]|\bFACTURA\b|\bF-?\d|\bCUFE\b|RES[O0]LUCI[O0]N|AUT[O0]RIZACI[O0]N|\bN[O0]\.?\s*\d|\bCAJA\b|\bCAJER[O0]\b|\bTRANS\b|\bREF\b|C[O0]D[I1]G[O0]|\bBARRAS\b|\bFECHA\b|\bH[O0]RA\b/

/** Quita tildes y normaliza espacios, para que las regex de arriba peguen. */
function normalize(line: string): string {
  return line
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * El OCR mete espacios adentro de los n\u00fameros: un ticket real tra\u00eda
 * "TOTAL FACTURA $ 201 .800,00", que le\u00eddo crudo son dos importes \u2014201 y
 * 800,00\u2014 y el parser se quedaba con el segundo. Solo pega los espacios que
 * est\u00e1n pegados a un separador de miles, porque "201 ." y ". 800" no son
 * importes v\u00e1lidos por separado; dos n\u00fameros sueltos ("2 500") no se tocan.
 */
function joinSplitNumbers(line: string): string {
  return line.replace(/(\d)\s+([.,]\d)/g, '$1$2').replace(/(\d[.,])\s+(\d)/g, '$1$2')
}

/**
 * Si una l\u00ednea dice "SUBTOTAL/TOTAL" el total real est\u00e1 ah\u00ed, as\u00ed que la
 * exclusi\u00f3n de subtotal no puede com\u00e9rsela: se saca la palabra SUBTOTAL y se
 * mira qu\u00e9 queda. "SUBTOTAL 20.700" queda sin nada y se descarta; "SUBTOTAL/
 * TOTAL 748.381" conserva su TOTAL y sigue en juego.
 */
function withoutSubtotal(line: string): string {
  return line.replace(SUBTOTAL, ' ')
}

/**
 * Importes de una línea. En Colombia el punto separa miles ("45.900" son
 * cuarenta y cinco mil novecientos pesos), que es justo lo que `toCents`
 * resuelve. Pide un mínimo de $100 para no confundir cantidades ni ítems.
 */
function amountsIn(line: string, opts: { looksLikeMoney?: boolean } = {}): number[] {
  const out: number[] = []
  for (const raw of joinSplitNumbers(line).match(/\d[\d.,]*/g) ?? []) {
    // Un token que termina en separador es basura del OCR ("45.900,").
    const limpio = raw.replace(/[.,]+$/, '')
    if (!/\d/.test(limpio)) continue

    if (opts.looksLikeMoney) {
      // Sin una palabra que diga "total" cerca, el número tiene que parecer
      // plata por sí solo: o trae separador de miles, o es corto. Así un código
      // de producto de ocho dígitos ("21525616 REFRESC CLIGHT") no se cuela
      // como si fueran veintiún millones de pesos.
      if (!/[.,]/.test(limpio) && limpio.length > 4) continue
      // Y si venía cortado, es un pedazo de otra cosa: un ticket real trajo el
      // NIT partido como "890.107." y se leía como ochocientos noventa mil.
      if (raw !== limpio) continue
    }

    const cents = Math.abs(toCents(limpio))
    if (cents >= 10000) out.push(cents)
  }
  return out
}

/** El comercio suele estar en las primeras líneas, antes de los importes. */
function findMerchant(lines: string[]): string {
  for (const line of lines.slice(0, 6)) {
    const norm = normalize(line)
    if (norm.length < 3) continue
    if (IDENTIFIERS.test(norm)) continue
    // Una línea con más dígitos que letras es un encabezado numérico.
    const letters = (norm.match(/[A-Z]/g) ?? []).length
    const digits = (norm.match(/\d/g) ?? []).length
    if (letters < 3 || digits > letters) continue
    return line.trim().replace(/\s{2,}/g, ' ').slice(0, 60)
  }
  return ''
}

/**
 * Fechas que no son la de la compra: la vigencia de la numeración de la DIAN
 * ("VIGENCIA 24 MESES HASTA:11-12-2024") y el rango de la resolución. Un
 * ticket real las trae arriba de todo, antes de la fecha real.
 */
const NOT_A_PURCHASE_DATE = /V[I1]GENC[I1]A|HASTA|RES[O0]LUC[I1][O0]N|RES\.|D[I1]AN|AUT[O0]RRETENED[O0]R|\bVIG\b/

function findDate(lines: string[]): ISODate | null {
  for (const line of lines) {
    if (!/\d/.test(line)) continue
    if (NOT_A_PURCHASE_DATE.test(normalize(line))) continue
    const found = parseDate(line)
    if (found) return found
  }
  return null
}

/**
 * Busca el importe recorriendo las líneas y quedándose con la frase de mayor
 * peso. Si la línea que dice "TOTAL" no trae número —pasa cuando el ticket lo
 * imprime alineado a la derecha y el OCR lo parte— mira la línea siguiente.
 */
function findTotal(lines: string[]): number | null {
  const normalized = lines.map(normalize)
  let best: { weight: number; cents: number } | null = null

  for (let i = 0; i < normalized.length; i++) {
    // Sin la palabra SUBTOTAL: "SUBTOTAL/TOTAL" sigue contando como total.
    const line = withoutSubtotal(normalized[i])
    if (NOT_TOTAL.test(line)) continue

    const phrase = TOTAL_PHRASES.find((p) => p.re.test(line))
    if (!phrase) continue

    let cents = amountsIn(line).at(-1) ?? null
    if (cents === null && i + 1 < normalized.length) {
      const next = withoutSubtotal(normalized[i + 1])
      // La línea de abajo solo sirve si no es otra cosa (cambio, IVA, puntos).
      if (!NOT_TOTAL.test(next) && !TOTAL_PHRASES.some((p) => p.re.test(next))) {
        cents = amountsIn(next).at(-1) ?? null
      }
    }
    if (cents === null) continue

    // A igual peso gana el último: los tickets cierran con el total real.
    if (!best || phrase.weight >= best.weight) best = { weight: phrase.weight, cents }
  }

  return best?.cents ?? null
}

/**
 * Red de seguridad cuando ninguna línea dice "total": el importe más grande
 * que parezca plata. Se marca como `mayor` para que la pantalla pida revisarlo.
 */
function findLargest(lines: string[]): number | null {
  let max = 0
  for (const line of lines) {
    const norm = withoutSubtotal(normalize(line))
    if (IDENTIFIERS.test(norm) || NOT_TOTAL.test(norm)) continue
    for (const cents of amountsIn(norm, { looksLikeMoney: true })) max = Math.max(max, cents)
  }
  return max > 0 ? max : null
}

export function parseReceipt(text: string, rules: UserRule[] = []): ReceiptRead {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const total = findTotal(lines)
  const amountCents = total ?? findLargest(lines)
  const merchant = findMerchant(lines)

  return {
    amountCents,
    merchant,
    date: findDate(lines),
    category: categorize(merchant, rules),
    source: total !== null ? 'total' : amountCents !== null ? 'mayor' : 'ninguno',
    lines,
  }
}
