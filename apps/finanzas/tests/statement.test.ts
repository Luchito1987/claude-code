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

// Extracto colombiano (Tuya/Alkosto, Éxito) en cuotas: trae el precio total
// de la compra ("Valor Transacción") y lo que se cobra este ciclo ("Cuota a
// pagar del mes") en columnas separadas, con fecha AAAA/MM/DD.
const CSV_TARJETA_CUOTAS_CO = `Fecha\tDescripción\tValor Transacción\tSaldo Pendiente\tCuota a pagar del mes\tTasa de Interés de la transacción\tTasa de Interés Efectiva Anual\tCuotas cobradas/totales
2025/11/22\tCOMPRA NACIONAL | HOMECENTER BARRANQUILL\t613.000,00\t79.666,79\t39.833,40\t1,87%\t24,97%\t4/6
2026/02/16\tCOMPRA NACIONAL | COLEGIO BIFFI LA SALLE\t2.175.289,00\t1.812.740,83\t362.548,17\t1,89%\t25,20%\t1/6`

describe('resumen de tarjeta colombiano con cuotas separadas del precio total', () => {
  const res = parseStatement(CSV_TARJETA_CUOTAS_CO, { kind: 'card' })

  it('usa la cuota del mes como importe, no el precio total de la compra', () => {
    expect(res.rows).toHaveLength(2)
    expect(res.rows[0].amountCents).toBe(-3983340)
    expect(res.rows[1].amountCents).toBe(-36254817)
  })

  it('toma el progreso de cuotas ("4/6"), no el monto de la columna vecina', () => {
    expect(res.rows[0].installment).toBe('4/6')
    expect(res.rows[1].installment).toBe('1/6')
  })

  it('lee la fecha AAAA/MM/DD sin confundir el año con el día', () => {
    expect(res.rows[0].date).toBe('2025-11-22')
    expect(res.rows[1].date).toBe('2026-02-16')
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

// Extracto de cuenta de ahorros de Bancolombia: trae el saldo corrido después
// de cada movimiento, que es de dónde sale el saldo real de la cuenta.
const BANCOLOMBIA = `FECHA,DESCRIPCION,SUCURSAL,DOCUMENTO,VALOR,SALDO
2026/08/05,ABONO NOMINA EMPRESA SAS,0000,1234567,"4.500.000,00","5.120.400,00"
2026/08/07,COMPRA EXITO WOW BQUILLA,0362,8452268,"-155.300,00","4.965.100,00"
2026/08/09,COMPRA PDV EXITO BARRANQUI,0041,1663865,"-80.830,00","4.884.270,00"
2026/08/10,TRANSFERENCIA A NEQUI,0000,9988776,"-200.000,00","4.684.270,00"`

describe('extracto de Bancolombia', () => {
  const res = parseStatement(BANCOLOMBIA, { kind: 'account' })

  it('lee los movimientos con su signo', () => {
    expect(res.rows).toHaveLength(4)
    expect(res.rows[0].amountCents).toBe(450000000)
    expect(res.rows[1].amountCents).toBe(-15530000)
  })

  it('toma el saldo del movimiento más nuevo, no el de la última fila', () => {
    expect(res.finalBalanceCents).toBe(468427000)
    expect(res.finalBalanceDate).toBe('2026-08-10')
  })

  it('no confunde la columna de saldo con la del importe', () => {
    // "VALOR" es el movimiento y "SALDO" el acumulado: si se cruzaran, el
    // primer movimiento daría cinco millones en vez de cuatro y medio.
    expect(res.rows[0].amountCents).not.toBe(512040000)
  })
})

describe('el saldo se toma por fecha, no por posición en el archivo', () => {
  it('funciona con el extracto ordenado del más nuevo al más viejo', () => {
    const alReves = `FECHA,DESCRIPCION,VALOR,SALDO
2026/08/10,TRANSFERENCIA,"-200.000,00","4.684.270,00"
2026/08/09,COMPRA,"-80.830,00","4.884.270,00"
2026/08/05,ABONO,"4.500.000,00","5.120.400,00"`
    const res = parseStatement(alReves, { kind: 'account' })
    expect(res.finalBalanceCents).toBe(468427000)
    expect(res.finalBalanceDate).toBe('2026-08-10')
  })

  it('con dos movimientos el mismo día gana el que cierra el día', () => {
    const mismoDia = `FECHA,DESCRIPCION,VALOR,SALDO
2026/08/10,PRIMERO,"-1.000,00","900.000,00"
2026/08/10,SEGUNDO,"-2.000,00","898.000,00"`
    expect(parseStatement(mismoDia, { kind: 'account' }).finalBalanceCents).toBe(89800000)
  })
})

describe('saldo ausente o engañoso', () => {
  it('sin columna de saldo no inventa uno', () => {
    const sinSaldo = `FECHA,DESCRIPCION,VALOR
2026/08/09,COMPRA,"-80.830,00"`
    const res = parseStatement(sinSaldo, { kind: 'account' })
    expect(res.finalBalanceCents).toBeUndefined()
  })

  it('ignora una columna de saldo anterior, que es el saldo de apertura', () => {
    const soloAnterior = `FECHA,DESCRIPCION,VALOR,SALDO ANTERIOR
2026/08/09,COMPRA,"-80.830,00","1.000.000,00"`
    const res = parseStatement(soloAnterior, { kind: 'account' })
    expect(res.finalBalanceCents).toBeUndefined()
  })

  it('con saldo anterior y saldo, se queda con el saldo', () => {
    const ambos = `FECHA,DESCRIPCION,VALOR,SALDO ANTERIOR,SALDO
2026/08/09,COMPRA,"-80.830,00","1.000.000,00","919.170,00"`
    expect(parseStatement(ambos, { kind: 'account' }).finalBalanceCents).toBe(91917000)
  })

  it('acepta un saldo en cero sin tratarlo como ausente', () => {
    const enCero = `FECHA,DESCRIPCION,VALOR,SALDO
2026/08/09,RETIRO TOTAL,"-500.000,00","0,00"`
    expect(parseStatement(enCero, { kind: 'account' }).finalBalanceCents).toBe(0)
  })
})

describe('movimientos idénticos repetidos el mismo día', () => {
  const fila = (n: number) => ({
    date: '2026-07-31',
    description: 'SERVICIO PAGO A PROVEEDORES',
    merchant: 'SERVICIO PAGO A PROVEEDORES',
    amountCents: -399000,
    category: 'otros',
    installment: '',
    currency: 'ARS',
    rappi: false,
    raw: String(n),
  })

  it('cada repetición tiene su propia huella', () => {
    // Un extracto real traía seis cobros iguales el mismo día, uno por cada
    // pago hecho. Con una sola huella para los seis, cinco cobros de verdad
    // desaparecían al importar.
    const huellas = new Set([0, 1, 2, 3, 4, 5].map((n) => fingerprint(fila(n), 'account:x', n)))
    expect(huellas.size).toBe(6)
  })

  it('la primera repetición conserva la huella de siempre', () => {
    // Si cambiara, todo lo ya importado se reimportaría duplicado.
    expect(fingerprint(fila(0), 'account:x', 0)).toBe(fingerprint(fila(0), 'account:x'))
  })

  it('reimportar el mismo archivo da las mismas huellas', () => {
    const unaPasada = () => [0, 1, 2].map((n) => fingerprint(fila(n), 'account:x', n))
    expect(unaPasada()).toEqual(unaPasada())
  })

  it('sigue distinguiendo cuentas distintas', () => {
    expect(fingerprint(fila(0), 'account:a', 0)).not.toBe(fingerprint(fila(0), 'account:b', 0))
  })
})
