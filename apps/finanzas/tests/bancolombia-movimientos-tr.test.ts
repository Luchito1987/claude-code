import { describe, expect, it } from 'vitest'
import { detectLayout, parseBancolombia, splitLine } from '@/lib/parsers/bancolombia'

/**
 * Estructura del "Desc_Movimientos_TR-<cuenta>-<fecha>.CSV" (movimientos del
 * día de la cuenta de la empresa), con datos inventados.
 */
const TR = [
  '10000003,12102026,12102026,"N","PAGO A PROVE Persona Ejemplo",442,99900001234,7,.00,-500000.00,0,"",',
  '10000002,12102026,12102026,"N","PAGO PSE GASES DEL CARIBE S A",442,99900001234,7,.00,-103829.00,0,"733346146",',
  '10000001,11102026,11102026,"N","ABONO, CON COMA",442,99900001234,7,.00,250000.50,0,"",',
  '',
].join('\r\n')

describe('movimientos del día (Desc_Movimientos_TR)', () => {
  it('se reconoce como mensual y dice dónde está la cuenta', () => {
    const l = detectLayout(TR)
    expect(l?.name).toBe('mensual')
    expect(splitLine(TR.split('\r\n')[0])[l!.account]).toBe('99900001234')
  })

  it('lee fecha, descripción sin comillas e importe con signo', () => {
    const r = parseBancolombia(TR)
    expect(r.rows.map((x) => [x.date, x.description, x.amountCents])).toEqual([
      ['2026-10-12', 'PAGO A PROVE Persona Ejemplo', -50000000],
      ['2026-10-12', 'PAGO PSE GASES DEL CARIBE S A', -10382900],
      ['2026-10-11', 'ABONO, CON COMA', 25000050],
    ])
    expect(r.finalBalanceCents).toBeUndefined()
  })
})
