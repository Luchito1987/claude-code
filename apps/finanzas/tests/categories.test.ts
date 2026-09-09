/**
 * Las descripciones son literales de los extractos de Bancolombia. La app
 * arrancó con reglas argentinas y contra estos datos clasificaba casi todo como
 * "otros", que es la categoría que sí cuenta como gasto variable: el tablero
 * mostraba $29.549.492 de gasto variable en un mes donde el gasto variable real
 * era $1.064.820.
 */

import { describe, expect, it } from 'vitest'
import { categorize, NON_VARIABLE_CATEGORIES, VARIABLE_CATEGORIES } from '@/lib/categories'

const esVariable = (desc: string): boolean =>
  !NON_VARIABLE_CATEGORIES.includes(categorize(desc) as never)

describe('Bancolombia: lo que mueve plata pero no es consumo', () => {
  it('el pago de la tarjeta no es un gasto variable', () => {
    expect(categorize('PAGO SUC VIRT TC VISA')).toBe('pago_tarjeta')
    expect(categorize('PAGO SUC VIRT TC MASTER PESOS')).toBe('pago_tarjeta')
    expect(esVariable('PAGO SUC VIRT TC VISA')).toBe(false)
  })

  it('la tarjeta Falabella se paga por PSE y no es una compra de ropa', () => {
    // La regla de indumentaria tiene FALABELLA: sin ganarle de mano, un pago de
    // $2.051.200 entraba como gasto en ropa.
    expect(categorize('PAGO PSE BANCO FALABELLA S A')).toBe('pago_tarjeta')
    expect(categorize('COMPRA EN FALABELLA')).toBe('indumentaria')
  })

  it('los intereses de mora son costo de la tarjeta', () => {
    expect(categorize('MORA TARJETA VISA PESOS')).toBe('pago_tarjeta')
    expect(categorize('MORA TARJETA MASTER PESOS')).toBe('pago_tarjeta')
  })

  it('la cuota del préstamo, con sus dos nombres', () => {
    expect(categorize('PAGO CREDITO SUC VIRTUAL')).toBe('prestamos')
    expect(categorize('DEBITO POR ABONO CARTERA')).toBe('prestamos')
  })

  it('el 4x1000 y el IVA del banco son impuestos, no consumo', () => {
    expect(categorize('IMPTO GOBIERNO 4X1000')).toBe('impuestos')
    expect(categorize('CXC IMPTO GOBIERNO 4X1000 MON')).toBe('impuestos')
    expect(categorize('COBRO IVA PAGOS AUTOMATICOS')).toBe('impuestos')
    expect(categorize('IVA CUOTA PLAN CANAL NEGOCIOS')).toBe('impuestos')
  })

  it('las comisiones del banco tampoco', () => {
    expect(categorize('C MANEJO TARJ DEB 6993 07 26')).toBe('impuestos')
    expect(categorize('CUOTA MANEJO TRJ DEB')).toBe('impuestos')
    expect(categorize('SERVICIO PAGO A PROVEEDORES')).toBe('impuestos')
  })

  it('mover plata entre cuentas propias no es gastarla', () => {
    // El bulto del problema: $17.310.000 de un mes eran esto.
    expect(categorize('PAGO A PROVE Luciano Blanco')).toBe('transferencias')
    expect(categorize('PAGO DE PROV DRA. INES PETRO')).toBe('transferencias')
    expect(categorize('TRANSFERENCIAS A NEQUI')).toBe('transferencias')
    expect(categorize('TRANSFERENCIA CTA SUC VIRTUAL')).toBe('transferencias')
  })

  it('los intereses de la caja de ahorro entran, no salen', () => {
    expect(categorize('ABONO INTERESES AHORROS')).toBe('ingresos')
    expect(categorize('REINTEGRO COMPRA')).toBe('ingresos')
  })
})

describe('comercios colombianos', () => {
  it('reconoce las cadenas de supermercado', () => {
    expect(categorize('COMPRA EN  EXITO WOW')).toBe('supermercado')
    expect(categorize('COMPRA EN  SAO 094 VI')).toBe('supermercado')
    expect(categorize('COMPRA CARULLA')).toBe('supermercado')
  })

  it('MULTICINES es entretenimiento, aunque \\bCINE no lo agarre', () => {
    expect(categorize('COMPRA EN  MULTICINES')).toBe('entretenimiento')
    expect(categorize('ROYAL FILMS')).toBe('entretenimiento')
  })

  it('el extracto trunca el detalle de Google', () => {
    expect(categorize('COMPRA EN  GOOGLE You')).toBe('entretenimiento')
    expect(categorize('COMPRA EN  GOOGLE Spo')).toBe('entretenimiento')
  })

  it('restaurantes, hogar y salud', () => {
    expect(categorize('COMPRA EN  FRISBY Q62')).toBe('restaurante')
    expect(categorize('COMPRA EN  PEPE GANGA')).toBe('hogar')
    expect(categorize('COMPRA EN  MINISO VIV')).toBe('hogar')
    expect(categorize('CLINICA VETERINARIA DON P')).toBe('salud')
  })

  it('Rappi sigue siendo delivery', () => {
    expect(categorize('COMPRA EN  RAPPI COLO')).toBe('delivery')
    expect(categorize('COMPRA EN RAPPI COLOMBIA*DL')).toBe('delivery')
  })

  it('lo que sí es consumo queda como gasto variable', () => {
    for (const d of ['COMPRA EN  EXITO WOW', 'COMPRA EN  FRISBY Q62', 'COMPRA EN  RAPPI COLO']) {
      expect(esVariable(d)).toBe(true)
      expect(VARIABLE_CATEGORIES).toContain(categorize(d))
    }
  })
})

describe('las reglas argentinas siguen funcionando', () => {
  it('no se rompió nada de lo que ya andaba', () => {
    expect(categorize('COMPRA CARREFOUR')).toBe('supermercado')
    expect(categorize('PAGO TARJETA VISA')).toBe('pago_tarjeta')
    expect(categorize('EDENOR SA')).toBe('servicios')
    expect(categorize('NETFLIX.COM')).toBe('entretenimiento')
    expect(categorize('YPF SERVICIO')).toBe('combustible')
    expect(categorize('CUOTA PRESTAMO PERSONAL')).toBe('prestamos')
  })

  it('lo que no reconoce sigue cayendo en otros', () => {
    expect(categorize('COMPRA EN  INNOVATION')).toBe('otros')
    expect(categorize('PAGO QR La Tiendecita')).toBe('otros')
  })
})

describe('las reglas del usuario le ganan a las de fábrica', () => {
  it('una regla propia redefine un comercio', () => {
    const reglas = [{ pattern: 'INNOVATION', category: 'educacion', priority: 1 }]
    expect(categorize('COMPRA EN  INNOVATION', reglas)).toBe('educacion')
  })
})
