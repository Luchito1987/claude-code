/**
 * Segundo factor con códigos de un solo uso (TOTP, RFC 6238).
 *
 * Es el mismo estándar que usa Google Authenticator, Authy o 1Password: el
 * teléfono y el servidor comparten un secreto y ambos derivan de él el mismo
 * número de seis dígitos cada treinta segundos. El código no viaja nunca por la
 * red hasta que se escribe, y sirve una sola vez.
 *
 * Se implementa acá y no con una librería porque son cuarenta líneas de HMAC
 * que ya trae Node, y una dependencia menos en el camino de autenticación es
 * una superficie menos que auditar.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const DIGITOS = 6
const PASO_SEGUNDOS = 30

/**
 * Cuántos pasos de treinta segundos se aceptan para atrás y para adelante.
 *
 * Uno solo: cubre el reloj del teléfono corrido y el tiempo que tarda alguien
 * en leer el código y escribirlo, sin ampliar de más la ventana en la que un
 * código robado todavía sirve.
 */
const TOLERANCIA_PASOS = 1

export function generarSecreto(): string {
  // 20 bytes es el largo que recomienda el RFC para HMAC-SHA1.
  return base32Encode(randomBytes(20))
}

export function base32Encode(buf: Buffer): string {
  let bits = 0
  let valor = 0
  let salida = ''
  for (const byte of buf) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31]
  return salida
}

export function base32Decode(s: string): Buffer {
  const limpio = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0
  let valor = 0
  const bytes: number[] = []
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c)
    if (i === -1) continue
    valor = (valor << 5) | i
    bits += 5
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/** El código de seis dígitos que corresponde a un instante dado. */
export function codigoEn(secreto: string, enSegundos: number): string {
  const paso = Math.floor(enSegundos / PASO_SEGUNDOS)
  const contador = Buffer.alloc(8)
  contador.writeUInt32BE(Math.floor(paso / 2 ** 32), 0)
  contador.writeUInt32BE(paso >>> 0, 4)

  const hmac = createHmac('sha1', base32Decode(secreto)).update(contador).digest()
  // Truncado dinámico del RFC: el último nibble dice desde dónde leer.
  const offset = hmac[hmac.length - 1] & 0x0f
  const binario =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return String(binario % 10 ** DIGITOS).padStart(DIGITOS, '0')
}

/**
 * Si el código escrito es válido ahora.
 *
 * Compara en tiempo constante contra cada código de la ventana: una comparación
 * que corta en la primera diferencia le dice a quien prueba cuántos dígitos
 * acertó, y con eso se adivina de a un dígito por vez.
 */
export function verificarCodigo(secreto: string, codigo: string, ahoraSegundos = Date.now() / 1000): boolean {
  const limpio = codigo.replace(/\D/g, '')
  if (limpio.length !== DIGITOS) return false

  const escrito = Buffer.from(limpio)
  let valido = false
  for (let d = -TOLERANCIA_PASOS; d <= TOLERANCIA_PASOS; d++) {
    const esperado = Buffer.from(codigoEn(secreto, ahoraSegundos + d * PASO_SEGUNDOS))
    // Sin corto circuito: se recorren todos los pasos siempre, así el tiempo de
    // respuesta no delata cuál de ellos acertó.
    if (escrito.length === esperado.length && timingSafeEqual(escrito, esperado)) valido = true
  }
  return valido
}

/**
 * La dirección que se codifica en el QR. `issuer` es el nombre que le queda
 * a la cuenta en la app del teléfono.
 */
export function otpauthUrl(secreto: string, email: string, issuer = 'Finanzas'): string {
  const etiqueta = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({
    secret: secreto,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITOS),
    period: String(PASO_SEGUNDOS),
  })
  return `otpauth://totp/${etiqueta}?${params}`
}
