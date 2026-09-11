/**
 * El segundo factor.
 *
 * Lo que más importa acá no es que funcione en el caso feliz sino que no se
 * afloje: una ventana de tolerancia amplia de más, o una comparación que corte
 * en la primera diferencia, convierten el segundo factor en un adorno.
 *
 * Los vectores del RFC 6238 son la prueba de que la implementación es la
 * estándar y no una parecida: si coinciden, Google Authenticator va a generar
 * exactamente los mismos números.
 */

import { describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, codigoEn, generarSecreto, otpauthUrl, verificarCodigo } from '@/lib/totp'

// "12345678901234567890" en ASCII, el secreto de los vectores del RFC.
const SECRETO_RFC = base32Encode(Buffer.from('12345678901234567890'))

describe('vectores del RFC 6238', () => {
  // Tabla del apéndice B del RFC, columna SHA1.
  const casos: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ]

  for (const [t, esperado] of casos) {
    it(`t=${t} da ${esperado}`, () => {
      expect(codigoEn(SECRETO_RFC, t)).toBe(esperado)
    })
  }
})

describe('base32', () => {
  it('ida y vuelta deja el mismo contenido', () => {
    const original = Buffer.from('un secreto cualquiera')
    expect(base32Decode(base32Encode(original)).toString()).toBe('un secreto cualquiera')
  })

  it('tolera espacios y minúsculas, que es como se copia a mano', () => {
    const s = base32Encode(Buffer.from('hola'))
    const escritoAMano = s.toLowerCase().replace(/(.{4})/g, '$1 ')
    expect(base32Decode(escritoAMano).toString()).toBe('hola')
  })
})

describe('verificar un código', () => {
  const secreto = generarSecreto()
  const AHORA = 1_700_000_000

  it('acepta el código del momento', () => {
    expect(verificarCodigo(secreto, codigoEn(secreto, AHORA), AHORA)).toBe(true)
  })

  it('acepta el anterior y el siguiente, por el reloj corrido del teléfono', () => {
    expect(verificarCodigo(secreto, codigoEn(secreto, AHORA - 30), AHORA)).toBe(true)
    expect(verificarCodigo(secreto, codigoEn(secreto, AHORA + 30), AHORA)).toBe(true)
  })

  it('rechaza los de más atrás y más adelante: la ventana no se estira', () => {
    expect(verificarCodigo(secreto, codigoEn(secreto, AHORA - 90), AHORA)).toBe(false)
    expect(verificarCodigo(secreto, codigoEn(secreto, AHORA + 90), AHORA)).toBe(false)
  })

  it('rechaza un código de otro secreto', () => {
    expect(verificarCodigo(secreto, codigoEn(generarSecreto(), AHORA), AHORA)).toBe(false)
  })

  it('rechaza basura sin romperse', () => {
    for (const malo of ['', '12345', '1234567', 'abcdef', '  ', '000000x']) {
      expect(verificarCodigo(secreto, malo, AHORA)).toBe(false)
    }
  })

  it('ignora espacios, que es como los muestra el teléfono', () => {
    const c = codigoEn(secreto, AHORA)
    expect(verificarCodigo(secreto, `${c.slice(0, 3)} ${c.slice(3)}`, AHORA)).toBe(true)
  })
})

describe('secretos', () => {
  it('cada uno es distinto y del largo que pide el RFC', () => {
    const a = generarSecreto()
    const b = generarSecreto()
    expect(a).not.toBe(b)
    expect(base32Decode(a)).toHaveLength(20)
  })

  it('sólo usa el alfabeto base32, así se puede tipear a mano', () => {
    expect(generarSecreto()).toMatch(/^[A-Z2-7]+$/)
  })
})

describe('el QR', () => {
  it('arma una dirección otpauth que el teléfono entiende', () => {
    const url = otpauthUrl('JBSWY3DPEHPK3PXP', 'luciano@ejemplo.com')
    expect(url.startsWith('otpauth://totp/')).toBe(true)
    expect(url).toContain('secret=JBSWY3DPEHPK3PXP')
    expect(url).toContain('issuer=Finanzas')
    expect(url).toContain('period=30')
    // El email va escapado: si no, el ":" y el "@" rompen la etiqueta.
    expect(url).toContain('Finanzas%3Aluciano%40ejemplo.com')
  })
})
