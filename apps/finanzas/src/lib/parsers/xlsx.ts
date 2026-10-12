/**
 * Lectura de planillas (.xlsx / .xlsm). Convierte cada hoja a una matriz de
 * strings para que la use el mismo detector de columnas que el CSV: así un
 * extracto bajado en Excel y uno en CSV siguen el mismo camino.
 *
 * Lo único que necesita cuidado son las fechas y los números, que en Excel no
 * son texto: se normalizan a 'YYYY-MM-DD' y a un decimal con punto, que es lo
 * que `parseDate` y `toCents` esperan.
 */

import ExcelJS from 'exceljs'
import { readZip } from './zip'

export interface Sheet {
  name: string
  rows: string[][]
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''

  if (value instanceof Date) {
    // Excel guarda las fechas en UTC; se lee en UTC para no correr un día.
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value.trim()

  const obj = value as Record<string, unknown>

  // Celda con fórmula: interesa el resultado, no la fórmula.
  if ('result' in obj) return cellToString(obj.result)
  // Texto enriquecido: se concatenan los fragmentos.
  if ('richText' in obj && Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text?: string }>).map((t) => t.text ?? '').join('').trim()
  }
  if ('text' in obj) return cellToString(obj.text)
  if ('hyperlink' in obj) return cellToString(obj.text ?? obj.hyperlink)
  if ('error' in obj) return ''

  return String(value)
}

export async function readWorkbook(buffer: ArrayBuffer | Buffer): Promise<Sheet[]> {
  try {
    const sheets = await readWithExcelJS(buffer)
    if (sheets.length) return sheets
  } catch (error) {
    // Excel abre archivos que exceljs rechaza; antes de rendirse se prueba
    // leerlos a mano. Si tampoco así, el error que vale es el original.
    const sheets = await readRaw(buffer).catch(() => [])
    if (sheets.length) return sheets
    throw error
  }
  return readRaw(buffer)
}

async function readWithExcelJS(buffer: ArrayBuffer | Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook()
  // exceljs declara su propio tipo Buffer, incompatible con el de Node aunque
  // en tiempo de ejecución sea el mismo objeto.
  await wb.xlsx.load(buffer as never)

  const sheets: Sheet[] = []
  wb.eachSheet((ws) => {
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = []
      // `row.values` viene con un hueco en el índice 0.
      const values = row.values as unknown[]
      for (let i = 1; i < values.length; i++) cells.push(cellToString(values[i]))
      // Quita las columnas vacías del final, que Excel arrastra de más.
      while (cells.length && cells[cells.length - 1] === '') cells.pop()
      if (cells.some((c) => c !== '')) rows.push(cells)
    })
    sheets.push({ name: ws.name, rows })
  })
  return sheets
}

/**
 * Lectura directa del XML, para las planillas que Excel abre y exceljs no.
 *
 * Bancolombia arma los extractos de cuenta con un generador mínimo: declara el
 * libro por extensión en vez de por ruta, apunta a él con una ruta absoluta y
 * escribe las celdas sin su referencia ("A1"), una detrás de otra. Todo eso es
 * válido —Excel lo abre sin quejarse— pero exceljs no encuentra el libro y se
 * cae. Sin este camino, ningún extracto trimestral de Bancolombia se podía
 * importar.
 *
 * Además escribe cada etiqueta con prefijo de espacio de nombres (`<x:row>`,
 * `<x:c>`) y deja filas vacías auto-cerradas (`<x:row />`), así que las
 * expresiones de abajo aceptan las dos formas.
 *
 * Lee sólo lo que hace falta para sacar una matriz de texto: los nombres de las
 * hojas, los textos compartidos y el valor de cada celda. Los números quedan
 * como vienen, que es lo que `cellToString` haría con ellos de todas formas.
 */
async function readRaw(buffer: ArrayBuffer | Buffer): Promise<Sheet[]> {
  const archivos = readZip(buffer)
  const leer = async (ruta: string) => archivos.get(ruta.replace(/^\/+/, ''))?.toString('utf8') ?? ''

  const libro = relacion(await leer('_rels/.rels'), /officeDocument/) ?? 'xl/workbook.xml'
  const rutaLibro = libro.replace(/^\/+/, '')
  const carpeta = rutaLibro.includes('/') ? rutaLibro.slice(0, rutaLibro.lastIndexOf('/') + 1) : ''
  const resolver = (target: string) => (target.startsWith('/') ? target.slice(1) : carpeta + target)

  const relaciones = await leer(`${carpeta}_rels/${rutaLibro.slice(carpeta.length)}.rels`)
  const destinos = new Map<string, string>()
  for (const { attrs } of etiquetas(relaciones, 'Relationship')) {
    const id = valor(attrs, 'Id')
    const target = valor(attrs, 'Target')
    if (id && target) destinos.set(id, resolver(target))
  }

  const compartidos: string[] = []
  const rutaCompartidos = relacion(relaciones, /sharedStrings/)
  const xmlCompartidos = await leer(rutaCompartidos ? resolver(rutaCompartidos) : `${carpeta}sharedStrings.xml`)
  for (const { cuerpo } of etiquetas(xmlCompartidos, 'si')) compartidos.push(textos(cuerpo))

  const sheets: Sheet[] = []
  for (const { attrs } of etiquetas(await leer(rutaLibro), 'sheet')) {
    const name = decode(valor(attrs, 'name') ?? `Hoja ${sheets.length + 1}`)
    const rid = valor(attrs, 'r:id')
    const ruta = rid ? destinos.get(rid) : undefined
    if (ruta) sheets.push({ name, rows: filas(await leer(ruta), compartidos) })
  }
  return sheets
}

function filas(xml: string, compartidos: string[]): string[][] {
  const rows: string[][] = []
  for (const fila of etiquetas(xml, 'row')) {
    const cells: string[] = []
    let siguiente = 0
    for (const { attrs, cuerpo } of etiquetas(fila.cuerpo, 'c')) {
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1]
      const col = ref ? columna(ref) : siguiente
      const tipo = valor(attrs, 't')
      const v = etiquetas(cuerpo, 'v')[0]?.cuerpo
      let texto = ''
      if (tipo === 'inlineStr') texto = textos(cuerpo)
      else if (tipo === 's' && v !== undefined) texto = compartidos[Number(v)] ?? ''
      else if (tipo === 'b') texto = v === '1' ? 'true' : 'false'
      else if (v !== undefined) texto = decode(v)
      while (cells.length < col) cells.push('')
      cells[col] = texto.trim()
      siguiente = col + 1
    }
    while (cells.length && cells[cells.length - 1] === '') cells.pop()
    if (cells.some((c) => c !== '')) rows.push(cells)
  }
  return rows
}

/**
 * Todas las apariciones de una etiqueta, con o sin prefijo (`<row>` o
 * `<x:row>`), abierta y cerrada o auto-cerrada. Sin la variante auto-cerrada,
 * una `<x:row />` vacía se tragaría la fila siguiente.
 */
function etiquetas(xml: string, nombre: string): Array<{ attrs: string; cuerpo: string }> {
  const p = '(?:[A-Za-z_][\\w.-]*:)?'
  const re = new RegExp(`<${p}${nombre}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${p}${nombre}>)`, 'g')
  return [...xml.matchAll(re)].map(([, attrs = '', cuerpo = '']) => ({ attrs, cuerpo }))
}

function valor(attrs: string, nombre: string): string | undefined {
  return new RegExp(`(?:^|\\s)${nombre.replace(':', '\\:')}="([^"]*)"`).exec(attrs)?.[1]
}

/** El destino de la primera relación cuyo tipo coincide. */
function relacion(xml: string, tipo: RegExp): string | undefined {
  const r = etiquetas(xml, 'Relationship').find(({ attrs }) => tipo.test(valor(attrs, 'Type') ?? ''))
  return r ? valor(r.attrs, 'Target') : undefined
}

/** "A" → 0, "Z" → 25, "AA" → 26. */
function columna(letras: string): number {
  let n = 0
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function textos(xml: string): string {
  return etiquetas(xml, 't').map(({ cuerpo }) => decode(cuerpo)).join('')
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function isSpreadsheet(fileName: string): boolean {
  return /\.(xlsx|xlsm|xltx)$/i.test(fileName)
}

/** Resumen de estructura, para poder mirar una planilla desconocida sin abrirla. */
export function describeSheet(sheet: Sheet, preview = 8): string[] {
  const columnas = Math.max(0, ...sheet.rows.map((r) => r.length))
  const out = [`Hoja "${sheet.name}": ${sheet.rows.length} filas × ${columnas} columnas`]
  for (const row of sheet.rows.slice(0, preview)) {
    out.push('  ' + row.map((c) => (c.length > 18 ? `${c.slice(0, 17)}…` : c)).join(' | '))
  }
  if (sheet.rows.length > preview) out.push(`  … ${sheet.rows.length - preview} filas más`)
  return out
}
