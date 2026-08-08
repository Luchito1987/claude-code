import { describe, expect, it } from 'vitest'
import { parseStatement, parseDate, fingerprint } from '@/lib/parsers/statement'
import { parseCsv, detectDelimiter } from '@/lib/parsers/csv'

describe('parseCsv', () => {
  it('respeta comillas, comillas escapadas y saltos de línea', () => {
    const rows = parseCsv('a,b\n"uno, dos",3\n"con ""comillas""",4\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['uno, dos', '3'],
      ['con "comillas"', '4'],
    ])
  })

  it('detecta el separador', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
  })
})

describe('parseDate', () => {
  it('lee los formatos habituales', () => {
    expect(parseDate('05/07/2026')).toBe('2026-07-05')
    expect(parseDate('5-7-26')).toBe('2026-07-05')
    expect(parseDate('2026-07-05')).toBe('2026-07-05')
    expect(parseDate('05 JUL 2026')).toBe('2026-07-05')
  })

  it('usa el año de referencia cuando el extracto no lo trae', () => {
    expect(parseDate('05 JUL', 2026)).toBe('2026-07-05')
  })

  it('devuelve null si no hay fecha', () => {
    expect(parseDate('TOTAL DEL RESUMEN')).toBeNull()
  })
})

const CSV_CUENTA = `Movimientos de la cuenta
Fecha;Descripcion;Debito;Credito
05/07/2026;COMPRA 1234 COTO CICSA;38.900,00;
06/07/2026;ACREDITACION HABERES;;1.850.000,00
07/07/2026;RAPPI*BURGER KING;12.450,00;
TOTALES;;51.350,00;1.850.000,00`

describe('extracto de cuenta', () => {
  const res = parseStatement(CSV_CUENTA, { kind: 'account' })

  it('encuentra el encabezado aunque haya líneas antes', () => {
    expect(res.strategy).toBe('csv')
    expect(res.rows).toHaveLength(3)
  })

  it('combina las columnas de débito y crédito con el signo correcto', () => {
    expect(res.rows[0].amountCents).toBe(-3890000)
    expect(res.rows[1].amountCents).toBe(185000000)
    expect(res.rows[2].amountCents).toBe(-1245000)
  })

  it('categoriza por comercio', () => {
    expect(res.rows[0].category).toBe('supermercado')
    expect(res.rows[1].category).toBe('ingresos')
    expect(res.rows[2].category).toBe('delivery')
    expect(res.rows[2].rappi).toBe(true)
  })
})

const CSV_TARJETA = `Fecha,Detalle,Cuota,Importe
05/07/2026,NETFLIX.COM,,7.999,00
06/07/2026,ZARA ARGENTINA,3/6,25.000,00`

describe('resumen de tarjeta', () => {
  it('invierte el signo: los consumos son egresos', () => {
    const res = parseStatement(CSV_TARJETA, { kind: 'card' })
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].amountCents).toBeLessThan(0)
    expect(res.rows[0].category).toBe('entretenimiento')
    expect(res.rows[1].installment).toBe('3/6')
  })
})

describe('texto pegado de un PDF', () => {
  const text = `05/07/2026  COMPRA 4321 CARREFOUR EXPRESS   -38.900,00
06/07/2026  RAPPI*MOSTAZA 3/6                   -12.450,00
línea de basura sin importe
07/07/2026  YPF FULL                             -25.000,00`

  const res = parseStatement(text, { kind: 'account' })

  it('cae al parseo por líneas y saltea lo que no reconoce', () => {
    expect(res.strategy).toBe('text')
    expect(res.rows).toHaveLength(3)
    expect(res.skipped).toBe(1)
  })

  it('limpia el nombre del comercio', () => {
    expect(res.rows[0].merchant).toContain('CARREFOUR')
    expect(res.rows[0].merchant).not.toContain('4321')
  })

  it('detecta la cuota', () => {
    expect(res.rows[1].installment).toBe('3/6')
  })
})

describe('fingerprint', () => {
  const row = {
    date: '2026-07-05',
    description: 'COTO',
    merchant: 'COTO',
    amountCents: -1000,
    category: 'supermercado',
    installment: '',
    currency: 'ARS',
    rappi: false,
    raw: '',
  }

  it('es estable para el mismo movimiento y origen', () => {
    expect(fingerprint(row, 'a')).toBe(fingerprint({ ...row, raw: 'otro' }, 'a'))
  })

  it('cambia si cambia el importe o el origen', () => {
    expect(fingerprint(row, 'a')).not.toBe(fingerprint({ ...row, amountCents: -2000 }, 'a'))
    expect(fingerprint(row, 'a')).not.toBe(fingerprint(row, 'b'))
  })
})

describe('nombre del comercio', () => {
  it('saca la marca de cuota que agrega el banco', () => {
    const res = parseStatement('09/07/2026  ZARA ARGENTINA 3/6   25.000,00', { kind: 'card' })
    expect(res.rows[0].merchant).toBe('ZARA ARGENTINA')
    // La cuota no se pierde: viaja en su propio campo.
    expect(res.rows[0].installment).toBe('3/6')
  })
})
