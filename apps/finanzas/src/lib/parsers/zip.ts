/**
 * Lectura de un archivo zip con lo que ya trae Node.
 *
 * Un .xlsx es un zip con XML adentro. exceljs trae su propio lector, pero
 * cuando exceljs no puede abrir el libro hace falta llegar al XML por otro
 * camino, y la biblioteca de zip habitual tiene una licencia que la política
 * del repositorio no admite. El formato es simple para lo que se necesita
 * acá: el directorio central, al final del archivo, dice dónde empieza cada
 * entrada, cuánto mide y si viene guardada tal cual o comprimida con deflate.
 *
 * No soporta zip64 ni cifrado: un extracto bancario no llega a 4 GB.
 */

import { inflateRawSync } from 'node:zlib'

const FIN_DIRECTORIO = 0x06054b50
const ENTRADA_DIRECTORIO = 0x02014b50

export function readZip(input: ArrayBuffer | Buffer): Map<string, Buffer> {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input)

  // El registro de cierre mide 22 bytes más un comentario de hasta 64 KB.
  let fin = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === FIN_DIRECTORIO) {
      fin = i
      break
    }
  }
  if (fin === -1) throw new Error('El archivo no es un zip')

  const entradas = buf.readUInt16LE(fin + 10)
  let p = buf.readUInt32LE(fin + 16)
  const archivos = new Map<string, Buffer>()

  for (let n = 0; n < entradas; n++) {
    if (buf.readUInt32LE(p) !== ENTRADA_DIRECTORIO) throw new Error('El directorio del zip está dañado')
    const metodo = buf.readUInt16LE(p + 10)
    const comprimido = buf.readUInt32LE(p + 20)
    const largoNombre = buf.readUInt16LE(p + 28)
    const largoExtra = buf.readUInt16LE(p + 30)
    const largoComentario = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const nombre = buf.toString('utf8', p + 46, p + 46 + largoNombre)

    // El encabezado local repite el nombre y puede traer un extra de otro
    // largo que el del directorio: se mide el suyo.
    const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const datos = buf.subarray(inicio, inicio + comprimido)
    if (metodo === 0) archivos.set(nombre, Buffer.from(datos))
    else if (metodo === 8) archivos.set(nombre, inflateRawSync(datos))

    p += 46 + largoNombre + largoExtra + largoComentario
  }
  return archivos
}
