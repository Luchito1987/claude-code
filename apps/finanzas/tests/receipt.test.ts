import { describe, expect, it } from 'vitest'
import { parseReceipt } from '@/lib/parsers/receipt'
import { TICKETS_REALES } from './fixtures/tickets-reales'

// Ticket de súper típico: el subtotal y el IVA aparecen ANTES del total, y
// abajo el efectivo entregado y el cambio son números más grandes que la compra.
const EXITO = `
ALMACENES EXITO S.A.
NIT 890.900.608-9
CALLE 80 No 69-70
FACTURA DE VENTA No FE-4471

ARROZ DIANA 500G        4.500
LECHE COLANTA 1L        3.900
PAN BIMBO              12.300

SUBTOTAL               20.700
IVA 19%                 3.933
TOTAL A PAGAR          24.633
EFECTIVO               50.000
CAMBIO                 25.367
`

describe('ticket de supermercado', () => {
  const res = parseReceipt(EXITO)

  it('toma el total a pagar, no el subtotal ni el IVA', () => {
    expect(res.amountCents).toBe(2463300)
  })

  it('no se deja engañar por el efectivo ni el cambio, que son más grandes', () => {
    expect(res.amountCents).not.toBe(5000000)
    expect(res.amountCents).not.toBe(2536700)
  })

  it('marca que el importe salió de una línea de total', () => {
    expect(res.source).toBe('total')
  })

  it('saca el comercio de las primeras líneas, salteando el NIT', () => {
    expect(res.merchant).toBe('ALMACENES EXITO S.A.')
  })
})

describe('el NIT y el número de factura no se confunden con plata', () => {
  it('ignora identificadores aunque el número sea enorme', () => {
    const res = parseReceipt(`
      D1 TIENDAS
      NIT 900.373.115-2
      FACTURA No 88.412.905
      TOTAL 15.800
    `)
    expect(res.amountCents).toBe(1580000)
  })
})

describe('variantes de la palabra total', () => {
  const casos: Array<[string, number]> = [
    ['TOTAL VENTA 32.400', 3240000],
    ['VALOR A PAGAR 8.950', 895000],
    ['NETO A PAGAR 120.000', 12000000],
    ['TOTAL FACTURA 1.234.567', 123456700],
    ['TOTAL COMPRA 99.900', 9990000],
  ]

  for (const [linea, esperado] of casos) {
    it(`lee "${linea}"`, () => {
      expect(parseReceipt(`TIENDA X\n${linea}`).amountCents).toBe(esperado)
    })
  }
})

describe('ruido del OCR', () => {
  it('tolera que confunda la O con un cero', () => {
    // "T0TAL" con cero es el error más común en papel térmico.
    const res = parseReceipt('PANADERIA LA ESQUINA\nT0TAL A PAGAR 18.700')
    expect(res.amountCents).toBe(1870000)
  })

  it('busca en la línea siguiente cuando el total quedó solo', () => {
    // Pasa cuando el importe está alineado a la derecha y el OCR lo separa.
    const res = parseReceipt('SUPERTIENDA\nTOTAL A PAGAR\n45.900')
    expect(res.amountCents).toBe(4590000)
    expect(res.source).toBe('total')
  })

  it('no cruza a la línea siguiente si esa línea es el cambio', () => {
    const res = parseReceipt('TIENDA\nTOTAL\nCAMBIO 20.000')
    expect(res.amountCents).not.toBe(2000000)
  })

  it('descarta un token que quedó cortado con separador al final', () => {
    expect(parseReceipt('TIENDA\nTOTAL 45.900,').amountCents).toBe(4590000)
  })
})

describe('formato de plata colombiano', () => {
  it('el punto separa miles, no decimales', () => {
    // $45.900 son cuarenta y cinco mil, no cuarenta y cinco con noventa.
    expect(parseReceipt('X\nTOTAL 45.900').amountCents).toBe(4590000)
  })

  it('acepta también la forma con centavos', () => {
    expect(parseReceipt('X\nTOTAL 45.900,00').amountCents).toBe(4590000)
  })

  it('ignora cantidades chicas de la lista de ítems', () => {
    const res = parseReceipt('TIENDA\n2 x 50\nTOTAL 12.000')
    expect(res.amountCents).toBe(1200000)
  })
})

describe('fecha y categoría', () => {
  it('lee la fecha del ticket', () => {
    const res = parseReceipt('TIENDA\nFECHA 09/08/2026\nTOTAL 10.000')
    expect(res.date).toBe('2026-08-09')
  })

  it('propone una categoría a partir del comercio', () => {
    expect(parseReceipt('FARMACIA CRUZ VERDE\nTOTAL 25.000').category).toBe('farmacia')
  })

  it('cae en otros cuando el comercio no dice nada', () => {
    expect(parseReceipt('LOCAL 34\nTOTAL 25.000').category).toBe('otros')
  })
})

describe('cuando no se entiende nada', () => {
  it('sin ninguna línea de total, avisa que usó el número más grande', () => {
    const res = parseReceipt('TIENDA DEL BARRIO\nALGO 12.000\nOTRA COSA 30.000')
    expect(res.amountCents).toBe(3000000)
    expect(res.source).toBe('mayor')
  })

  it('con una foto ilegible devuelve null en vez de inventar', () => {
    const res = parseReceipt('~~~ ### ???')
    expect(res.amountCents).toBeNull()
    expect(res.source).toBe('ninguno')
  })

  it('un texto vacío no rompe', () => {
    expect(() => parseReceipt('')).not.toThrow()
    expect(parseReceipt('').amountCents).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tickets de verdad. Todo lo de arriba lo escribí yo imaginando cómo sale un
// ticket; esto es lo que el OCR realmente devolvió sobre siete fotos sacadas
// con el celular. Cada bug que arreglé abajo lo encontró una de estas fotos,
// no un caso inventado.
// ---------------------------------------------------------------------------

describe('fotos reales de tickets', () => {
  for (const t of TICKETS_REALES) {
    it(`saca el total de ${t.nombre}`, () => {
      expect(parseReceipt(t.texto).amountCents).toBe(t.totalCents)
    })
  }

  it('acierta la fecha cuando el encabezado sobrevivió al OCR', () => {
    const conFecha = TICKETS_REALES.filter((t) => t.fecha !== null)
    expect(conFecha.length).toBeGreaterThan(0)
    for (const t of conFecha) {
      expect(parseReceipt(t.texto).date).toBe(t.fecha)
    }
  })

  it('avisa cuál hay que revisar: el único sin línea de total legible', () => {
    // En el de Olímpica el OCR partió "SUBTOTAL/TOTAL" en algo ilegible, así
    // que el importe sale del número más grande y la pantalla lo marca.
    const porOrigen = TICKETS_REALES.map((t) => [t.nombre, parseReceipt(t.texto).source])
    expect(porOrigen.filter(([, s]) => s === 'mayor')).toEqual([['Olímpica', 'mayor']])
    expect(porOrigen.filter(([, s]) => s === 'ninguno')).toEqual([])
  })
})
