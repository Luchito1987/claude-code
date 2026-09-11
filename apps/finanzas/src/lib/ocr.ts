/**
 * OCR local de la foto de un ticket. Corre en esta máquina con tesseract.js:
 * la imagen nunca sale de la red de casa.
 *
 * El diccionario de español pesa 8 MB y tesseract lo baja de internet la
 * primera vez. Queda cacheado en `data/tesseract/` para que a partir de ahí
 * funcione sin conexión — que es la gracia de hacerlo local.
 */

import { createWorker, type Worker } from 'tesseract.js'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

function cachePath(): string {
  const path = process.env.TESSERACT_CACHE ?? resolve(process.cwd(), 'data', 'tesseract')
  mkdirSync(path, { recursive: true })
  return path
}

/**
 * Arrancar un worker tarda varios segundos, así que se reusa entre fotos.
 * La promesa se guarda —no el worker ya resuelto— para que dos fotos subidas
 * a la vez esperen el mismo arranque en lugar de levantar dos workers.
 */
let worker: Promise<Worker> | null = null

function getWorker(): Promise<Worker> {
  if (!worker) {
    worker = createWorker('spa', 1, { cachePath: cachePath() }).catch((err) => {
      // Sin esto, un arranque fallido queda cacheado y ninguna foto vuelve a andar.
      worker = null
      throw err
    })
  }
  return worker
}

/**
 * Cuánto se espera antes de dar por perdida una foto.
 *
 * Hay fallas del OCR que no se manifiestan como error sino como silencio: si
 * falta el `.wasm`, el worker aborta por dentro y la promesa nunca vuelve. Sin
 * este límite, la persona se queda mirando "Leyendo el ticket…" para siempre.
 */
const OCR_TIMEOUT_MS = 90_000

/** Texto crudo de la imagen. Devuelve '' si no reconoció nada. */
export async function readImageText(image: Buffer): Promise<string> {
  const w = await getWorker()

  let timer: NodeJS.Timeout | undefined
  const limite = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`El OCR no respondió en ${OCR_TIMEOUT_MS / 1000}s`)),
      OCR_TIMEOUT_MS,
    )
  })

  try {
    const { data } = await Promise.race([w.recognize(image), limite])
    return data.text ?? ''
  } finally {
    clearTimeout(timer)
  }
}

/** Para los tests y para cerrar prolijo en un script de línea de comandos. */
export async function stopOcr(): Promise<void> {
  if (!worker) return
  const w = await worker.catch(() => null)
  worker = null
  await w?.terminate()
}
