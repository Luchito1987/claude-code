import { describe, expect, it } from 'vitest'
import { extractPdfText, isPdf } from '@/lib/parsers/pdf'
import { parseUploadedFile } from '@/lib/parsers/input'
import { categorize } from '@/lib/categories'

interface Fragmento {
  text: string
  x: number
  y: number
}

/**
 * Arma un PDF mínimo con fragmentos de texto en posiciones dadas.
 *
 * Se construye a mano en vez de guardar un binario en el repo: así el test dice
 * exactamente qué contiene el PDF que prueba, y de paso ejercita lo que importa
 * — que los fragmentos sueltos vuelvan a ser renglones.
 */
function pdfConTexto(fragmentos: Fragmento[]): Buffer {
  const contenido = fragmentos
    .map((f) => `BT /F1 10 Tf ${f.x} ${f.y} Td (${f.text.replace(/([()\\])/g, '\\$1')}) Tj ET`)
    .join('\n')

  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${contenido.length} >>\nstream\n${contenido}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objetos.forEach((cuerpo, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${cuerpo}\nendobj\n`
  })

  const inicioXref = pdf.length
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`

  return Buffer.from(pdf, 'latin1')
}

/** Un renglón de tabla: cada celda en su columna, todas a la misma altura. */
function renglon(y: number, celdas: Array<[number, string]>): Fragmento[] {
  return celdas.map(([x, text]) => ({ text, x, y }))
}

const RESUMEN = pdfConTexto([
  { text: 'TUYA S.A. - TARJETA EXITO', x: 40, y: 800 },
  { text: 'Fecha de corte: 25/08/2026   Fecha limite de pago: 10/09/2026', x: 40, y: 780 },
  ...renglon(750, [
    [40, 'Fecha'],
    [110, 'Descripcion'],
    [380, 'Cuota'],
    [460, 'Valor'],
  ]),
  ...renglon(730, [
    [40, '02/08/2026'],
    [110, 'ALMACENES EXITO S.A. BQUILLA'],
    [380, '1/1'],
    [460, '312.450,00'],
  ]),
  ...renglon(710, [
    [40, '11/08/2026'],
    [110, 'ALKOSTO BARRANQUILLA'],
    [380, '4/12'],
    [460, '189.750,00'],
  ]),
  ...renglon(690, [
    [40, '21/08/2026'],
    [110, 'FALABELLA COLOMBIA'],
    [380, '2/6'],
    [460, '156.200,00'],
  ]),
  ...renglon(660, [
    [40, 'TOTAL A PAGAR'],
    [460, '658.400,00'],
  ]),
])

describe('isPdf', () => {
  it('reconoce la extensión sin importar mayúsculas', () => {
    expect(isPdf('resumen.pdf')).toBe(true)
    expect(isPdf('RESUMEN.PDF')).toBe(true)
    expect(isPdf('resumen.pdf.csv')).toBe(false)
  })
})

describe('extraer el texto de un resumen en PDF', () => {
  it('rearma un renglón por movimiento a partir de las coordenadas', async () => {
    const { text, pages, hasTextLayer } = await extractPdfText(RESUMEN)
    expect(pages).toBe(1)
    expect(hasTextLayer).toBe(true)

    const lineas = text.split('\n')
    expect(lineas[0]).toBe('TUYA S.A. - TARJETA EXITO')
    expect(lineas).toContain('02/08/2026 ALMACENES EXITO S.A. BQUILLA 1/1 312.450,00')
    expect(lineas).toContain('11/08/2026 ALKOSTO BARRANQUILLA 4/12 189.750,00')
  })

  it('respeta el orden de arriba hacia abajo', async () => {
    const { text } = await extractPdfText(RESUMEN)
    const lineas = text.split('\n')
    expect(lineas.findIndex((l) => l.includes('02/08'))).toBeLessThan(
      lineas.findIndex((l) => l.includes('21/08')),
    )
  })

  it('avisa cuando el PDF no tiene texto, como un escaneo', async () => {
    const vacio = pdfConTexto([])
    const res = await extractPdfText(vacio)
    expect(res.hasTextLayer).toBe(false)
    expect(res.pages).toBe(1)
  })
})

describe('importar el PDF como resumen de tarjeta', () => {
  const opts = { kind: 'card' as const, fallbackYear: 2026 }

  it('carga los consumos como egresos y llega al total del resumen', async () => {
    const res = await parseUploadedFile('resumen.pdf', RESUMEN, opts)
    expect(res.pdfPages).toBe(1)
    expect(res.rows).toHaveLength(3)
    expect(res.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(-65840000)
  })

  it('conserva el plan de cuotas de cada compra', async () => {
    const res = await parseUploadedFile('resumen.pdf', RESUMEN, opts)
    expect(res.rows.map((r) => r.installment)).toEqual(['1/1', '4/12', '2/6'])
  })

  it('categoriza los comercios en vez de dejarlos en otros', async () => {
    const res = await parseUploadedFile('resumen.pdf', RESUMEN, opts)
    expect(res.rows.map((r) => r.category)).toEqual(['supermercado', 'hogar', 'indumentaria'])
  })

  it('muestra lo que leyó cuando no reconoce ningún movimiento', async () => {
    const aviso = pdfConTexto([
      { text: 'Estimado cliente, su resumen estara disponible el mes proximo.', x: 40, y: 800 },
    ])
    const res = await parseUploadedFile('aviso.pdf', aviso, opts)
    expect(res.rows).toHaveLength(0)
    expect(res.warnings.join(' ')).toMatch(/ninguna línea tiene fecha e importe/)
    expect(res.warnings.join(' ')).toMatch(/Estimado cliente/)
  })

  it('un escaneo explica que hay que pedir el PDF digital o usar la foto', async () => {
    const res = await parseUploadedFile('escaneo.pdf', pdfConTexto([]), opts)
    expect(res.rows).toHaveLength(0)
    expect(res.warnings.join(' ')).toMatch(/escaneo o una foto/)
  })
})

describe('comercios de Colombia', () => {
  it('deja de mandar todo a "otros"', () => {
    expect(categorize('ALMACENES EXITO S.A. BQUILLA')).toBe('supermercado')
    expect(categorize('DROGUERIA CAFAM CRA 53')).toBe('farmacia')
    expect(categorize('ESTACION TEXACO NORTE')).toBe('combustible')
    expect(categorize('ALKOSTO BARRANQUILLA')).toBe('hogar')
    expect(categorize('EPM ENERGIA')).toBe('servicios')
    expect(categorize('TRANSMILENIO RECARGA')).toBe('transporte')
    expect(categorize('FRISBY POLLO')).toBe('restaurante')
  })

  it('el pago del resumen de Tuya no es un consumo', () => {
    expect(categorize('PAGO TUYA S.A.')).toBe('pago_tarjeta')
  })
})
