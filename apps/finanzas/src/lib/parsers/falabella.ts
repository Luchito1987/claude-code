/**
 * Extracto de la tarjeta CMR de Banco Falabella. Llega en PDF y su tabla tiene
 * esta forma:
 *
 *   12/08/2026 MOVISTAR PAGOSEPAYCO TV 60 TT $59.400,00 1 de 1 29,64% $59.399,47 $0,00
 *   fecha      descripción                   T  valor     cuotas tasa   cuota mes  pendiente
 *
 * Lo que lo hace distinto de los otros no es la tabla sino el PDF: el diseño
 * simula negrita dibujando el mismo texto dos veces, una encima de la otra, y
 * espacia las letras y los dígitos. Extraído queda así:
 *
 *   04/08/2026 P A G O TA R JETA C M RP A G O TA R JETA C M R TT -$ 1. 40 9 . 10 8, 0 0-$ 1. 40 9 . 10 8, 0 0
 *
 * Sin deshacer esas dos cosas no hay expresión regular que sirva, y un parser
 * genérico leería importes al azar. Por eso acá se normaliza primero y se
 * interpreta después.
 *
 * Igual que en Tuya, lo que se paga este mes es la "cuota a pagar este mes" y
 * no el valor de la compra: una compra en cuotas aparece entera en la columna
 * del valor aunque este mes sólo se pague una parte.
 */

import { categorize, extractMerchant, isRappi, type UserRule } from '../categories'
import { toCents, MONEDA_BASE } from '../money'
import type { ISODate } from '../dates'
import type { ParsedRow, ParseResult } from './statement'

export interface FalabellaMeta {
  closingDate?: ISODate
  dueDate?: ISODate
  minimumCents?: number
  totalCents?: number
  manejoCents?: number
  seguroCents?: number
  interesesCents?: number
}

const MESES: Record<string, string> = {
  ene: '01', feb: '02', mar: '03', abr: '04', may: '05', jun: '06',
  jul: '07', ago: '08', sep: '09', oct: '10', nov: '11', dic: '12',
}

/** "10 SEP 2026" o "24 ago 2026" -> "2026-09-10". */
function fechaLarga(texto: string): ISODate | null {
  const m = texto.match(/(\d{1,2})\s*([a-zA-Z]{3})[a-zA-Z]*\s*(\d{4})/)
  if (!m) return null
  const mes = MESES[m[2].toLowerCase()]
  return mes ? `${m[3]}-${mes}-${m[1].padStart(2, '0')}` : null
}

/**
 * Deshace el "doble dibujo" del PDF.
 *
 * El diseño imprime el mismo texto dos veces para que se vea en negrita, así
 * que al extraerlo cada tramo aparece pegado a su propia copia. Se busca el
 * trozo repetido inmediatamente y se deja uno solo.
 *
 * El mínimo de seis caracteres evita comerse repeticiones legítimas: "60 60"
 * de un plan o un "00" de un importe no son duplicaciones del diseño.
 */
export function colapsarDuplicado(s: string): string {
  let previo = ''
  let actual = s
  // Se repite hasta que no cambie: una línea puede traer varios tramos dobles.
  while (actual !== previo) {
    previo = actual
    actual = actual.replace(/(\S.{5,}?)\1/g, '$1')
  }
  return actual
}

/**
 * Junta los dígitos que el PDF separó: "-$ 1. 40 9 . 10 8, 0 0" -> "-$1.409.108,00".
 *
 * Sólo toca tramos que ya son numéricos: nunca junta letras, para no convertir
 * "PAGO TARJETA" en una sola palabra ilegible.
 */
export function juntarNumeros(s: string): string {
  /*
   * Se exige que el tramo arranque en "$" y termine en coma más exactamente dos
   * decimales. Sin ese corte el patrón seguía comiéndose lo que venía después:
   * "$97.200,00 2 de 2" quedaba como "$97.200,002 de 2", y el plan de cuotas
   * desaparecía dentro del importe.
   */
  return s.replace(/-?\$[\s\d.]*,\s*\d\s*\d/g, (tramo) => tramo.replace(/\s+/g, ''))
}

export function normalizarLinea(linea: string): string {
  return colapsarDuplicado(juntarNumeros(linea)).replace(/\s{2,}/g, ' ').trim()
}

/**
 * Junta las letras que el PDF dejó sueltas: "P A G O TA R JETA C M R" -> "PAGOTARJETACMR".
 *
 * Los espacios entre palabras y entre letras se ven iguales una vez extraído el
 * texto, así que no hay forma de saber dónde terminaba cada palabra: se juntan
 * todas. Queda sin espacios, pero legible y estable, que es lo que necesita
 * quien después busca "PAGOTARJETA" entre sus movimientos.
 *
 * Sólo se aplica cuando hay al menos tres letras sueltas seguidas; una
 * descripción normal con una inicial suelta —"RAPPI COLOMBIA*DL CR 7 127"— se
 * deja como está.
 */
export function juntarLetrasSueltas(texto: string): string {
  const sueltas = (texto.match(/(?:^|\s)[A-Za-zÁÉÍÓÚÑ](?=\s|$)/g) ?? []).length
  return sueltas >= 3 ? texto.replace(/\s+/g, '') : texto
}

export function isFalabellaStatement(text: string): boolean {
  return (
    /Banco\s*Fa\s*la\s*be\s*lla|Tarjeta de Cr[eé]dito CMR|bancofalabe\s*lla/i.test(text) ||
    /N\s*úm\s*e\s*r\s*o\s*de\s*ta\s*r\s*je\s*ta\s*C\s*M\s*R/i.test(text)
  )
}

/**
 * fecha · descripción · T/A · valor · "N de M" · [tasa] · [cuota del mes] · pendiente
 *
 * La tasa y la cuota del mes faltan en los planes ya terminados, por eso son
 * opcionales: una compra cuya última cuota ya se cobró figura sin ellas.
 */
const FILA =
  /^(\d{2})\/(\d{2})\/(\d{4})\s+(.+?)\s+(TT|TA)\s+(-?\$[\d.]+,\d{2})(?:\s+(\d+)\s*de\s*(\d+))?(?:\s+[\d,]+%)?(?:\s+(\$[\d.]+,\d{2}))?(?:\s+(\$[\d.]+,\d{2}))?\s*$/

function leerEncabezado(text: string): FalabellaMeta {
  /*
   * Las etiquetas del recuadro vienen con las letras espaciadas —"Tu p a go
   * m ín i m o e s :"— y el espaciado no es el mismo en cada una. Buscarlas con
   * los espacios puestos es adivinar; quitándolos todos, la etiqueta vuelve a
   * ser una palabra y el patrón deja de depender del diseño del PDF.
   */
  const pegado = colapsarDuplicado(juntarNumeros(text.replace(/\n/g, ' '))).replace(/\s+/g, '')
  const buscar = (re: RegExp): number => {
    const m = pegado.match(re)
    return m ? Math.abs(toCents(m[1])) : 0
  }
  const fecha = (re: RegExp): ISODate | undefined => {
    const m = pegado.match(re)
    return m ? (fechaLarga(m[1]) ?? undefined) : undefined
  }

  return {
    // "24ago2026": sin espacios, el mes queda pegado al día y al año.
    closingDate: fecha(/co\s*rtefue:?(\d{1,2}[a-zA-Z]{3}\d{4})/i),
    dueDate: fecha(/Pagaantesdel[\s\S]{0,60}?(\d{1,2}[a-zA-Z]{3}\d{4})/i),
    minimumCents: buscar(/pagom[ií]nimoes:?\$?([\d.]+,\d{2})/i) || undefined,
    totalCents: buscar(/pagototales:?\$?([\d.]+,\d{2})/i) || undefined,
    manejoCents: buscar(/Cuotademanejo:?\$?([\d.]+,\d{2})/i) || undefined,
    seguroCents: buscar(/Segurodevidadeudor:?\$?([\d.]+,\d{2})/i) || undefined,
    interesesCents: buscar(/Interesescorrientes:?\$?([\d.]+,\d{2})/i) || undefined,
  }
}

export interface FalabellaParseResult extends ParseResult {
  meta: FalabellaMeta
}

export function parseFalabella(text: string, opts: { userRules?: UserRule[] } = {}): FalabellaParseResult {
  const meta = leerEncabezado(text)
  const rows: ParsedRow[] = []
  const warnings: string[] = []
  let skipped = 0

  for (const cruda of text.split(/\r?\n/)) {
    if (!cruda.trim()) continue
    const linea = normalizarLinea(cruda)
    const m = linea.match(FILA)
    if (!m) {
      skipped++
      continue
    }

    const [, dia, mes, anio, descripcionCruda, , valor, , totales, cuotaMes] = m
    const descripcion = juntarLetrasSueltas(descripcionCruda.replace(/\s+/g, ' ').trim())
    const plan = Number(totales ?? 0)
    const cobradas = Number(m[7] ?? 0)

    const valorCents = toCents(valor)
    const esPago = valorCents < 0

    /*
     * Cuánto pesa este movimiento en el mes.
     *
     * Con plan de cuotas, la cuota que se cobra ahora; sin ella —o si el plan ya
     * terminó y la columna viene vacía— no pesa nada este mes, aunque la compra
     * siga figurando en la tabla. Los pagos entran por su valor.
     */
    const cents = esPago ? Math.abs(valorCents) : cuotaMes ? Math.abs(toCents(cuotaMes)) : 0

    /*
     * Un plan que ya terminó de pagarse sigue figurando en la tabla con cuota
     * cero. No es un movimiento de este mes ni deja cuotas por delante: cargarlo
     * sólo ensucia la lista con filas en cero.
     */
    if (!cents && (!plan || cobradas >= plan)) {
      skipped++
      continue
    }

    rows.push({
      date: `${anio}-${mes}-${dia}`,
      description: descripcion,
      merchant: extractMerchant(descripcion),
      amountCents: esPago ? cents : -cents,
      category: esPago ? 'pago_tarjeta' : categorize(descripcion, opts.userRules ?? []),
      installment: plan > 0 ? `${cobradas}/${plan}` : '',
      currency: MONEDA_BASE,
      rappi: isRappi(descripcion),
      raw: linea,
    })
  }

  // Cargos que el extracto lista en el recuadro del pago mínimo y no en la tabla.
  const delRecuadro: Array<[number | undefined, string, string]> = [
    [meta.interesesCents, 'Intereses corrientes', 'Falabella'],
    [meta.manejoCents, 'Cuota de manejo', 'Falabella'],
    [meta.seguroCents, 'Seguro de vida deudor', 'Falabella'],
  ]
  for (const [cents, descripcion, comercio] of delRecuadro) {
    if (!cents) continue
    rows.push({
      date: meta.closingDate ?? rows[rows.length - 1]?.date ?? '',
      description: descripcion,
      merchant: comercio,
      amountCents: -cents,
      category: 'servicios',
      installment: '',
      currency: MONEDA_BASE,
      rappi: false,
      raw: 'recuadro del pago mínimo',
    })
  }

  const cargos = rows.filter((r) => r.amountCents < 0).reduce((a, r) => a + -r.amountCents, 0)
  const pesos = (c: number) => c.toLocaleString('es-CO', { minimumFractionDigits: 2 })
  if (meta.minimumCents && Math.abs(cargos - meta.minimumCents) > 100) {
    const d = meta.minimumCents - cargos
    warnings.push(
      `El detalle suma ${pesos(cargos / 100)} y el extracto exige ${pesos(meta.minimumCents / 100)}: ` +
        `${d > 0 ? 'faltan' : 'sobran'} ${pesos(Math.abs(d) / 100)}. ` +
        'Se usa el importe del extracto, que es el que hay que pagar.',
    )
  }

  return {
    rows,
    skipped,
    strategy: 'text',
    warnings,
    meta,
    statementDueDate: meta.dueDate,
    statementMinimumCents: meta.minimumCents,
    statementTotalCents: meta.totalCents,
  }
}
