import { describe, expect, it, beforeAll } from 'vitest'
import ExcelJS from 'exceljs'
import { parseUploadedFile } from '@/lib/parsers/input'
import { readWorkbook } from '@/lib/parsers/xlsx'
import { mapCategoryName } from '@/lib/categories'

/** Planilla de gastos como la lleva una persona: importes positivos. */
async function planillaDeGastos(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const hoja = wb.addWorksheet('Julio 2026')
  hoja.addRow(['Control de gastos - Julio'])
  hoja.addRow([])
  hoja.addRow(['Fecha', 'Concepto', 'Categoria', 'Importe', 'Medio'])
  hoja.addRow([new Date(Date.UTC(2026, 6, 3)), 'Supermercado Coto', 'Comida', 47320.5, 'Débito'])
  hoja.addRow([new Date(Date.UTC(2026, 6, 8)), 'Edenor factura luz', 'Servicios', 42180, 'Débito'])
  hoja.addRow([new Date(Date.UTC(2026, 6, 22)), 'Colegio Martina', 'Educación', 210000, 'Transferencia'])
  hoja.addRow([])
  hoja.addRow(['', 'TOTAL', '', { formula: 'SUM(D4:D6)', result: 299500.5 }, ''])

  // Segunda hoja con forma de matriz: no es una lista de movimientos.
  const resumen = wb.addWorksheet('Resumen anual')
  resumen.addRow(['Categoria', 'Ene', 'Feb'])
  resumen.addRow(['Comida', 180000, 195000])

  // exceljs declara su propio tipo Buffer; en runtime es el de Node.
  return (await wb.xlsx.writeBuffer()) as unknown as Buffer
}

let planilla: Buffer

beforeAll(async () => {
  planilla = await planillaDeGastos()
})

describe('lectura de planillas', () => {
  it('devuelve todas las hojas con las celdas como texto', async () => {
    const hojas = await readWorkbook(planilla)
    expect(hojas.map((h) => h.name)).toEqual(['Julio 2026', 'Resumen anual'])
  })

  it('descarta las filas vacías que arrastra Excel', async () => {
    const [hoja] = await readWorkbook(planilla)
    // Título, encabezado, 3 movimientos y la fila de total: sin los huecos.
    expect(hoja.rows).toHaveLength(6)
  })

  it('normaliza las fechas de Excel a ISO sin correrse un día', async () => {
    const [hoja] = await readWorkbook(planilla)
    const fechas = hoja.rows.map((r) => r[0])
    expect(fechas).toContain('2026-07-03')
    expect(fechas).toContain('2026-07-22')
  })

  it('toma el resultado de las fórmulas, no la fórmula', async () => {
    const [hoja] = await readWorkbook(planilla)
    expect(hoja.rows[hoja.rows.length - 1]).toContain('299500.5')
  })
})

describe('importar una planilla de gastos', () => {
  it('elige la hoja que tiene la tabla de movimientos', async () => {
    const res = await parseUploadedFile('gastos.xlsx', planilla, { kind: 'gastos' })
    expect(res.sheetName).toBe('Julio 2026')
    expect(res.rows).toHaveLength(3)
  })

  it('carga los importes positivos como egresos', async () => {
    const res = await parseUploadedFile('gastos.xlsx', planilla, { kind: 'gastos' })
    expect(res.rows.map((r) => r.amountCents)).toEqual([-4732050, -4218000, -21000000])
  })

  it('respeta la categoría que puso el usuario en su planilla', async () => {
    const res = await parseUploadedFile('gastos.xlsx', planilla, { kind: 'gastos' })
    expect(res.rows.map((r) => r.category)).toEqual(['supermercado', 'servicios', 'educacion'])
  })

  it('como extracto de cuenta, en cambio, respeta el signo del archivo', async () => {
    const res = await parseUploadedFile('gastos.xlsx', planilla, { kind: 'account' })
    expect(res.rows[0].amountCents).toBe(4732050)
  })

  it('un archivo de texto sigue el camino de siempre', async () => {
    const csv = Buffer.from('Fecha,Detalle,Importe\n05/07/2026,COTO CICSA,-1.000,00\n', 'utf8')
    const res = await parseUploadedFile('extracto.csv', csv, { kind: 'account' })
    expect(res.sheetName).toBeUndefined()
    expect(res.rows).toHaveLength(1)
  })

  it('explica qué encontró cuando ninguna hoja sirve', async () => {
    const wb = new ExcelJS.Workbook()
    const hoja = wb.addWorksheet('Notas')
    hoja.addRow(['esto', 'no', 'es', 'una', 'tabla'])
    hoja.addRow(['de', 'movimientos', '', '', ''])
    const buf = (await wb.xlsx.writeBuffer()) as unknown as Buffer

    const res = await parseUploadedFile('notas.xlsx', buf, { kind: 'gastos' })
    expect(res.rows).toHaveLength(0)
    expect(res.warnings.join(' ')).toMatch(/ninguna tiene una tabla/)
    expect(res.warnings.join(' ')).toMatch(/Notas/)
  })
})

describe('mapCategoryName', () => {
  it('traduce los nombres que usa la gente en sus planillas', () => {
    expect(mapCategoryName('Comida')).toBe('supermercado')
    expect(mapCategoryName('Auto')).toBe('combustible')
    expect(mapCategoryName('Deudas')).toBe('prestamos')
    expect(mapCategoryName('Educación')).toBe('educacion')
    expect(mapCategoryName('Ocio')).toBe('entretenimiento')
  })

  it('acepta el nombre exacto de una categoría de la app', () => {
    expect(mapCategoryName('delivery')).toBe('delivery')
  })

  it('devuelve null cuando no hay equivalente, para no forzar una mala', () => {
    expect(mapCategoryName('Varios de la abuela')).toBeNull()
    expect(mapCategoryName('')).toBeNull()
  })
})
