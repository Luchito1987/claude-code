/**
 * El extracto de cuenta de ahorros de Bancolombia, bajado en Excel.
 *
 * Es el documento que trae el saldo y por eso el que ancla cada cuenta, pero
 * no entraba: exceljs no abre el archivo, y aun abierto, el lector genérico no
 * encuentra la tabla debajo del bloque de cliente y resumen. Los datos de acá
 * son inventados; lo que se conserva tal cual es la forma del archivo, que es
 * lo que rompía todo.
 */

import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseBancolombiaExtracto, usToCents } from '@/lib/parsers/bancolombia-extracto'
import { parseUploadedFile } from '@/lib/parsers/input'
import { readWorkbook } from '@/lib/parsers/xlsx'

const OPTS = { kind: 'account' as const, currency: 'COP' as const }

/**
 * Arma un .xlsx con las mañas del generador de Bancolombia: el libro declarado
 * por extensión y no por ruta, una ruta absoluta en las relaciones, prefijo de
 * espacio de nombres en cada etiqueta, celdas sin referencia ("A1") y una fila
 * vacía auto-cerrada. Excel lo abre; exceljs, no.
 */
async function xlsxBancolombia(filas: string[][]): Promise<Buffer> {
  const zip = new JSZip()
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml" />' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml" /></Types>',
  )
  zip.file(
    '_rels/.rels',
    '﻿<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/xl/workbook.xml" Id="R1" /></Relationships>',
  )
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="utf-8"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets>' +
      '<x:sheet name="Table1" sheetId="1" r:id="Rhoja" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" /></x:sheets></x:workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '﻿<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="Rhoja" /></Relationships>',
  )
  const cuerpo = filas
    .map((f) => `<x:row>${f.map((c) => `<x:c t="str"><x:v>${esc(c)}</x:v></x:c>`).join('')}</x:row>`)
    .join('')
  zip.file(
    'xl/worksheets/sheet1.xml',
    '<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
      `<x:row />${cuerpo}</x:sheetData></x:worksheet>`,
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** Un extracto trimestral completo, con su bloque de encabezado. */
function extracto(desde: string, hasta: string, anterior: string, actual: string, movimientos: string[][]) {
  return [
    ['Información Cliente:', '', ''],
    ['CLIENTE', 'DIRECCIÓN', 'CIUDAD'],
    ['PERSONA DE EJEMPLO', 'CALLE 1 2 3', 'BARRANQUILLA'],
    ['Información General:'],
    ['DESDE', 'HASTA', 'TIPO CUENTA', 'NRO CUENTA', 'SUCURSAL'],
    [desde, hasta, 'CUENTA DE AHORROS', '00000000000', 'SUCURSAL EJEMPLO'],
    ['Resumen:'],
    ['SALDO ANTERIOR', 'TOTAL ABONOS', 'TOTAL CARGOS', 'SALDO ACTUAL', 'SALDO PROMEDIO'],
    [anterior, '0', '0', actual, '0'],
    ['Movimientos:'],
    ['FECHA', 'DESCRIPCIÓN', 'SUCURSAL', 'DCTO.', 'VALOR', 'SALDO'],
    ...movimientos,
  ]
}

const TRIMESTRE = extracto('2026/06/30', '2026/09/30', '1,000,000.00', '2,486,000.10', [
  ['1/07', 'ABONO INTERESES AHORROS', '', '', '.10', '1,000,000.10'],
  ['1/07', 'TRANSFERENCIAS A NEQUI', '', '', '-14,000.00', '986,000.10'],
  ['15/08', 'PAGO DE PROV EMPRESA EJEMPLO', '', '', '3,500,000.00', '4,486,000.10'],
  ['30/09', 'TRANSFERENCIA CTA SUC VIRTUAL', '', '', '-2,000,000.00', '2,486,000.10'],
])

describe('el archivo de Excel', () => {
  it('exceljs solo no lo abre: por eso existe el lector de respaldo', async () => {
    // Si algún día exceljs lo abre, este archivo de prueba dejó de representar
    // al de Bancolombia y los tests de abajo no estarían probando nada nuevo.
    await expect(new ExcelJS.Workbook().xlsx.load((await xlsxBancolombia([['A']])) as never)).rejects.toThrow()
  })

  it('se abre aunque exceljs no pueda', async () => {
    const [hoja] = await readWorkbook(await xlsxBancolombia([['A', 'B'], ['1', '2']]))
    expect(hoja.name).toBe('Table1')
    expect(hoja.rows).toEqual([['A', 'B'], ['1', '2']])
  })

  it('la fila vacía auto-cerrada no se traga la siguiente', async () => {
    const [hoja] = await readWorkbook(await xlsxBancolombia([['primera'], ['segunda']]))
    expect(hoja.rows.map((r) => r[0])).toEqual(['primera', 'segunda'])
  })

  it('respeta los caracteres escapados', async () => {
    const [hoja] = await readWorkbook(await xlsxBancolombia([['COMPRA EN  A&B <SAS>']]))
    expect(hoja.rows[0][0]).toBe('COMPRA EN  A&B <SAS>')
  })
})

describe('el extracto', () => {
  it('lee todos los movimientos con su fecha completa', () => {
    const r = parseBancolombiaExtracto(TRIMESTRE, OPTS)!
    expect(r.rows.map((x) => [x.date, x.amountCents])).toEqual([
      ['2026-07-01', 10],
      ['2026-07-01', -1_400_000],
      ['2026-08-15', 350_000_000],
      ['2026-09-30', -200_000_000],
    ])
  })

  it('ancla el saldo del resumen a la fecha de corte', () => {
    const r = parseBancolombiaExtracto(TRIMESTRE, OPTS)!
    expect(r.finalBalanceCents).toBe(248_600_010)
    expect(r.finalBalanceDate).toBe('2026-09-30')
    expect(r.warnings).toEqual([])
  })

  it('un trimestre que cruza diciembre pasa al año siguiente', () => {
    const r = parseBancolombiaExtracto(
      extracto('2026/12/31', '2027/03/31', '0', '-5,000.00', [
        ['31/12', 'IMPTO GOBIERNO 4X1000', '', '', '-2,000.00', '-2,000.00'],
        ['3/01', 'IMPTO GOBIERNO 4X1000', '', '', '-3,000.00', '-5,000.00'],
      ]),
      OPTS,
    )!
    expect(r.rows.map((x) => x.date)).toEqual(['2026-12-31', '2027-01-03'])
  })

  it('avisa cuando los movimientos no explican el saldo', () => {
    // Falta una fila: el saldo anterior más lo leído no da el actual.
    const roto = TRIMESTRE.filter((f) => f[1] !== 'TRANSFERENCIAS A NEQUI')
    const r = parseBancolombiaExtracto(roto, OPTS)!
    expect(r.warnings.join(' ')).toMatch(/no cierra/)
  })

  it('no reclama una tabla que no es suya', () => {
    expect(parseBancolombiaExtracto([['FECHA', 'DESCRIPCION', 'VALOR'], ['2026-07-01', 'X', '1']], OPTS)).toBeNull()
  })

  it('entra de punta a punta por el mismo camino que usa la app', async () => {
    const r = await parseUploadedFile('68100000000_SEP2026.xlsx', await xlsxBancolombia(TRIMESTRE), OPTS)
    expect(r.rows).toHaveLength(4)
    expect(r.finalBalanceCents).toBe(248_600_010)
  })
})

describe('los importes en formato estadounidense', () => {
  it.each([
    ['-1,500,000.00', -150_000_000],
    ['.10', 10],
    ['1,835,914.66', 183_591_466],
    ['', null],
    ['ABC', null],
  ])('%s', (texto, esperado) => expect(usToCents(texto)).toBe(esperado))
})
