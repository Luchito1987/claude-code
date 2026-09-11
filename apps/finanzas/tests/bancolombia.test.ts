import { describe, expect, it } from 'vitest'
import { detectLayout, isBancolombiaCsv, parseBancolombia } from '@/lib/parsers/bancolombia'
import { parseStatement } from '@/lib/parsers/statement'

/**
 * Estructura exacta del CSV que baja la Sucursal Virtual de Bancolombia, con
 * los datos cambiados: no tiene sentido meter movimientos reales en el repo.
 *
 * Lo que sí se conserva, porque es lo que rompe a un lector genérico: sin fila
 * de encabezados, fecha pegada, el punto como decimal, las filas de SALDO
 * mezcladas entre los movimientos, y el SALDO DIA impreso antes de los
 * movimientos del día aunque sea el cierre.
 */
const EXTRACTO = [
  '20260701, 999-000000-00, 1, 7, 442, 0, SALDO INICIAL, 000000, .00, 0, C, , , , ,',
  '20260702, 999-000000-00, 4, 7, 442, 0, SALDO DIA, 000000, 950000.00, 442, C, , , , ,',
  '20260702, 999-000000-00, 2, 7, 442, 2142, PAGO INTERBANC EJEMPLO, 000000, 1000000.00, 442, C, , , , ,',
  '20260702, 999-000000-00, 3, 7, 442, 9086, PAGO SV GASES DEL CARIBE S.A., 000000, -50000.00, 442, D, , , , ,',
  '20260703, 999-000000-00, 6, 7, 442, 0, SALDO DIA, 000000, 750000.00, 442, C, , , , ,',
  '20260703, 999-000000-00, 5, 7, 442, 3339, IMPTO GOBIERNO 4X1000, 000000, -200000.00, 442, D, , , , ,',
  '20260703, 999-000000-00, 7, 7, 442, 0, SALDO FINAL, 000000, 750000.00, 442, C, , , , ,',
].join('\r\n')

describe('reconocer el formato', () => {
  it('lo detecta sin depender del nombre del archivo', () => {
    expect(isBancolombiaCsv(EXTRACTO)).toBe(true)
  })

  it('no confunde un CSV normal con encabezados', () => {
    const normal = 'FECHA,DESCRIPCION,VALOR,SALDO\n2026/08/09,COMPRA,"-80.830,00","4.884.270,00"'
    expect(isBancolombiaCsv(normal)).toBe(false)
  })

  it('no se activa con texto suelto', () => {
    expect(isBancolombiaCsv('05/07/2026 COMPRA CARREFOUR -38.900,00')).toBe(false)
  })

  it('parseStatement lo enruta solo', () => {
    // Sin esto el archivo entero se descarta: el detector genérico busca una
    // fila de encabezados que en Bancolombia no existe.
    expect(parseStatement(EXTRACTO, { kind: 'account' }).rows).toHaveLength(3)
  })
})

describe('movimientos', () => {
  const res = parseBancolombia(EXTRACTO)

  it('deja afuera las filas de saldo, que no son plata que se movió', () => {
    expect(res.rows).toHaveLength(3)
    expect(res.rows.map((r) => r.description)).not.toContain('SALDO DIA')
    expect(res.rows.map((r) => r.description)).not.toContain('SALDO INICIAL')
    expect(res.rows.map((r) => r.description)).not.toContain('SALDO FINAL')
  })

  it('lee la fecha pegada AAAAMMDD', () => {
    expect(res.rows[0].date).toBe('2026-07-02')
  })

  it('trata el punto como decimal, no como separador de miles', () => {
    // -50000.00 son cincuenta mil pesos. Si se leyera como miles darían cinco
    // millones, y el extracto entero quedaría cien veces inflado.
    expect(res.rows[1].amountCents).toBe(-5000000)
    expect(res.rows[0].amountCents).toBe(100000000)
  })

  it('respeta el signo de cada movimiento', () => {
    expect(res.rows.filter((r) => r.amountCents > 0)).toHaveLength(1)
    expect(res.rows.filter((r) => r.amountCents < 0)).toHaveLength(2)
  })
})

describe('saldo de la cuenta', () => {
  it('sale del SALDO FINAL', () => {
    expect(parseBancolombia(EXTRACTO).finalBalanceCents).toBe(75000000)
  })

  it('sin SALDO FINAL usa el cierre del último día', () => {
    const sinFinal = EXTRACTO.split('\r\n').filter((l) => !l.includes('SALDO FINAL')).join('\r\n')
    expect(parseBancolombia(sinFinal).finalBalanceCents).toBe(75000000)
  })

  it('no toma el SALDO INICIAL, que es el de apertura', () => {
    expect(parseBancolombia(EXTRACTO).finalBalanceCents).not.toBe(0)
  })

  it('el SALDO DIA es el cierre aunque venga impreso antes de los movimientos', () => {
    // En el archivo real la fila de SALDO DIA aparece primero pero su número de
    // secuencia es el más alto del día: es el cierre, no la apertura.
    const soloUnDia = EXTRACTO.split('\r\n').filter((l) => l.startsWith('20260702')).join('\r\n')
    expect(parseBancolombia(soloUnDia).finalBalanceCents).toBe(95000000)
  })
})

describe('coherencia contable', () => {
  it('la suma de los movimientos llega al saldo final', () => {
    // Arrancando de un saldo inicial en cero, sumar todo lo que entró y salió
    // tiene que dar el saldo que informa el banco. Si una fila de SALDO se
    // colara como movimiento, o se perdiera uno, esta cuenta no cerraría.
    const res = parseBancolombia(EXTRACTO)
    const suma = res.rows.reduce((a, r) => a + r.amountCents, 0)
    expect(suma).toBe(res.finalBalanceCents)
  })
})

describe('archivos rotos', () => {
  it('una línea con menos columnas se ignora sin romper', () => {
    const roto = `${EXTRACTO}\r\n20260704, 999-000000-00, 8`
    const res = parseBancolombia(roto)
    expect(res.rows).toHaveLength(3)
    expect(res.skipped).toBeGreaterThan(0)
  })

  it('un archivo vacío no rompe', () => {
    expect(() => parseBancolombia('')).not.toThrow()
    expect(parseBancolombia('').rows).toHaveLength(0)
  })
})

/**
 * El otro archivo: el informe del mes en curso. Cambia todo respecto del
 * consolidado —nueve columnas, la fecha al revés (DDMMAAAA), y ninguna fila de
 * saldo— y encima se superpone con él, porque arrastra los últimos días del mes
 * anterior.
 */
const MENSUAL = [
  '99900000000,442,7,10082026,,-14224.26,3339,IMPTO GOBIERNO 4X1000,00',
  '99900000000,976,7,09082026,,-80830.00,5380,COMPRA EN  EXITO WOW,00',
  '99900000000,442,7,09082026,,15.54,2999,ABONO INTERESES AHORROS,00',
  '99900000000,976,7,08082026,,-201800.00,5380,COMPRA EN  PEPE GANGA,00',
  '99900000000,442,7,31072026,,-3990.00,1371,SERVICIO PAGO A PROVEEDORES,00',
].join('\r\n')

describe('informe del mes en curso', () => {
  const res = parseBancolombia(MENSUAL)

  it('se reconoce como su propio formato', () => {
    expect(detectLayout(MENSUAL)?.name).toBe('mensual')
    expect(detectLayout(EXTRACTO)?.name).toBe('consolidado')
  })

  it('lee la fecha al revés que el consolidado, sin confundirse', () => {
    // 10082026 es el 10 de agosto. Leído como AAAAMMDD daría el año 1008.
    expect(res.rows[0].date).toBe('2026-08-10')
    expect(res.rows.at(-1)!.date).toBe('2026-07-31')
  })

  it('no informa saldo, porque el archivo no lo trae', () => {
    expect(res.finalBalanceCents).toBeUndefined()
  })

  it('lee todos los movimientos', () => {
    expect(res.rows).toHaveLength(5)
    expect(res.rows.find((r) => r.description.includes('PEPE GANGA'))?.amountCents).toBe(-20180000)
  })
})

describe('los dos formatos no se pisan', () => {
  it('cada archivo cae en su lector aunque los dos sean de Bancolombia', () => {
    expect(parseBancolombia(EXTRACTO).finalBalanceCents).toBe(75000000)
    expect(parseBancolombia(MENSUAL).finalBalanceCents).toBeUndefined()
  })
})
