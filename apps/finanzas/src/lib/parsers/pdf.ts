/**
 * Lectura de resúmenes en PDF.
 *
 * Un PDF no tiene renglones: tiene fragmentos de texto sueltos con su posición
 * en la página. Para que el importador pueda trabajarlo hay que rearmar la
 * tabla — agrupar los fragmentos que están a la misma altura, ordenarlos de
 * izquierda a derecha y unirlos — hasta dejar una línea por movimiento, que es
 * lo que ya sabe leer `parseStatement`.
 *
 * Solo sirve con PDF que tengan capa de texto, que es como los emiten los
 * bancos. Si es una foto escaneada no hay nada que extraer y se avisa.
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Tolerancia vertical para considerar que dos fragmentos son del mismo renglón. */
const MISMA_LINEA_PX = 2.5

/** Separación horizontal a partir de la cual se asume un cambio de columna. */
const SALTO_COLUMNA_PX = 6

export interface PdfText {
  text: string
  pages: number
  /** false cuando el PDF es una imagen escaneada: no hay texto que extraer. */
  hasTextLayer: boolean
}

export function isPdf(fileName: string): boolean {
  return /\.pdf$/i.test(fileName)
}

interface Fragmento {
  texto: string
  x: number
  y: number
  ancho: number
}

/** Agrupa por altura y ordena por posición: de fragmentos sueltos a renglones. */
function armarLineas(fragmentos: Fragmento[]): string[] {
  const porAltura = [...fragmentos].sort((a, b) => b.y - a.y || a.x - b.x)
  const lineas: string[] = []
  let actual: Fragmento[] = []

  const cerrar = () => {
    if (!actual.length) return
    const ordenada = actual.sort((a, b) => a.x - b.x)
    let texto = ''
    let finAnterior = -Infinity
    for (const f of ordenada) {
      // Dos columnas separadas necesitan espacio; letras contiguas, no.
      const separar = texto && f.x - finAnterior > SALTO_COLUMNA_PX
      texto += (separar ? '  ' : texto ? '' : '') + f.texto
      finAnterior = f.x + f.ancho
    }
    const limpia = texto.replace(/\s+/g, ' ').trim()
    if (limpia) lineas.push(limpia)
    actual = []
  }

  for (const f of porAltura) {
    if (actual.length && Math.abs(actual[0].y - f.y) > MISMA_LINEA_PX) cerrar()
    actual.push(f)
  }
  cerrar()
  return lineas
}

/**
 * Carpeta de fuentes estándar de pdfjs. Los PDF que usan Helvetica y compañía no
 * incrustan la fuente: sin esto pdfjs avisa por cada archivo y el texto puede
 * salir con los caracteres corridos.
 */
function carpetaDeFuentes(): string | undefined {
  const require = createRequire(import.meta.url)
  try {
    const raiz = dirname(require.resolve('pdfjs-dist/package.json'))
    const carpeta = join(raiz, 'standard_fonts/')
    return existsSync(carpeta) ? carpeta : undefined
  } catch {
    return undefined
  }
}

export async function extractPdfText(buffer: ArrayBuffer | Buffer): Promise<PdfText> {
  // El build "legacy" es el que corre en Node sin worker ni canvas.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

  const data = buffer instanceof Buffer ? new Uint8Array(buffer) : new Uint8Array(buffer)
  const doc = await pdfjs.getDocument({
    data,
    standardFontDataUrl: carpetaDeFuentes(),
    // Sin worker, sin eval y sin fuentes del sistema: es un proceso de servidor,
    // no un navegador, y el PDF viene de afuera.
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise

  const paginas: string[] = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const contenido = await page.getTextContent()

      const fragmentos: Fragmento[] = []
      for (const item of contenido.items) {
        if (!('str' in item) || !item.str.trim()) continue
        // transform = [a, b, c, d, e, f]: e y f son la posición en la página.
        const [, , , , x, y] = item.transform
        fragmentos.push({ texto: item.str, x, y, ancho: item.width ?? 0 })
      }

      paginas.push(armarLineas(fragmentos).join('\n'))
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }

  const text = paginas.join('\n')
  return { text, pages: doc.numPages, hasTextLayer: text.trim().length > 0 }
}
