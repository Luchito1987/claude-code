/**
 * Extracto de la tarjeta CMR de Banco Falabella.
 *
 * Lo difícil de este no es la tabla sino el PDF: el diseño simula negrita
 * dibujando el texto dos veces y espacia letras y dígitos, así que extraído
 * llega irreconocible. Estos tests fijan la normalización, que es de donde
 * salen los errores caros: un importe mal pegado no da error, da otro número.
 */

import { describe, expect, it } from 'vitest'
import {
  colapsarDuplicado,
  isFalabellaStatement,
  juntarLetrasSueltas,
  juntarNumeros,
  normalizarLinea,
  parseFalabella,
} from '@/lib/parsers/falabella'
import { parseStatement } from '@/lib/parsers/statement'

/** Recorte del extracto real de agosto de 2026, con su formato tal cual sale del PDF. */
const EXTRACTO = `Extracto de Tarjeta de Crédito CMR Fechas importantes
N úm e r o de ta r je ta C M R :N úm e r o de ta r je ta C M R :5282 09** **** 3837
Tu f e ch a de co r te f ue :Tu f e ch a de co r te f ue :
2 4 a go 2 0 2 62 4 a go 2 0 2 6
P a ga a n te s de lP a ga a n te s de l
Resumen de tu producto 10 SEP 202610 SEP 2026
Detalle de tu pago mínimo
+C o n s um o s de l m e s f a ctur a do s :+C o n s um o s de l m e s f a ctur a do s : $ 165.390,47
+In te r e s e s co r r i e n te s :+In te r e s e s co r r i e n te s : $ 7.735,84
+C uo ta de m a n e jo :+C uo ta de m a n e jo : $31.990,00
+S e gur o de vi da de udo r :+S e gur o de vi da de udo r : $2.990,00
Tu p a go m ín i m o e s :Tu p a go m ín i m o e s :
$ 208.106,31
Tu p a go to ta l e s :Tu p a go to ta l e s :
$ 208.106,31
Detalle de tus movimientos
25/06/2026 RAPPI COLOMBIA*DL CR 7 127 TT $97.200,00 2 de 2 $0,00
04/08/2026 P A G O TA R JETA C M RP A G O TA R JETA C M R TT -$ 1. 40 9 . 10 8, 0 0-$ 1. 40 9 . 10 8, 0 0
12/08/2026 MOVISTAR PAGOSEPAYCO TV 60 TT $59.400,00 1 de 1 29,64% $ 59 . 39 9 , 47$ 59 . 39 9 , 47 $0,00
12/08/2026 MOVISTAR PAGOSEPAYCO TV 60 TT $105.991,00 1 de 1 29,64% $ 10 5. 9 9 1, 0 0$ 10 5. 9 9 1, 0 0 $0,00`

describe('deshacer lo que el diseño del PDF rompió', () => {
  it('colapsa el texto dibujado dos veces', () => {
    expect(colapsarDuplicado('P a ga a n te s de lP a ga a n te s de l')).toBe('P a ga a n te s de l')
    expect(colapsarDuplicado('-$1.409.108,00-$1.409.108,00')).toBe('-$1.409.108,00')
  })

  it('no toca repeticiones que son del propio dato', () => {
    // "60 60" podría ser un plan y "00" un importe: no son duplicaciones.
    expect(colapsarDuplicado('TV 60')).toBe('TV 60')
    expect(colapsarDuplicado('$0,00')).toBe('$0,00')
  })

  it('junta los dígitos separados sin comerse lo que sigue', () => {
    expect(juntarNumeros('-$ 1. 40 9 . 10 8, 0 0')).toBe('-$1.409.108,00')
    // El error que hubo: "$97.200,00 2 de 2" quedaba "$97.200,002 de 2" y el
    // plan de cuotas desaparecía dentro del importe.
    expect(juntarNumeros('$97.200,00 2 de 2')).toBe('$97.200,00 2 de 2')
    expect(juntarNumeros('$ 59 . 39 9 , 47 1 de 1')).toBe('$59.399,47 1 de 1')
  })

  it('junta las letras sueltas sólo cuando son varias', () => {
    expect(juntarLetrasSueltas('P A G O TA R JETA C M R')).toBe('PAGOTARJETACMR')
    expect(juntarLetrasSueltas('RAPPI COLOMBIA*DL CR 7 127')).toBe('RAPPI COLOMBIA*DL CR 7 127')
  })

  it('una línea completa queda legible', () => {
    expect(normalizarLinea('04/08/2026 P A G O TA R JETA C M RP A G O TA R JETA C M R TT -$ 1. 40 9 . 10 8, 0 0-$ 1. 40 9 . 10 8, 0 0'))
      .toBe('04/08/2026 P A G O TA R JETA C M R TT -$1.409.108,00')
  })
})

describe('reconocer el extracto', () => {
  it('lo distingue por sus marcas', () => {
    expect(isFalabellaStatement(EXTRACTO)).toBe(true)
    expect(isFalabellaStatement('Extracto Tarjeta de Crédito TUYA S.A.')).toBe(false)
  })

  it('parseStatement lo despacha solo', () => {
    const res = parseStatement(EXTRACTO, { kind: 'card' })
    expect(res.statementDueDate).toBe('2026-09-10')
    expect(res.statementMinimumCents).toBe(20810631)
  })
})

describe('qué se lee de cada fila', () => {
  const res = parseFalabella(EXTRACTO)

  it('toma la cuota del mes y no el valor de la compra', () => {
    // La compra fue de $105.991 y la cuota de este mes también, pero la de
    // $59.400 se cobra a $59.399,47: es ese el número que importa.
    const movistar = res.rows.filter((r) => r.description.includes('MOVISTAR'))
    expect(movistar.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([-10599100, -5939947])
  })

  it('el pago entra en positivo y como pago de tarjeta', () => {
    const pago = res.rows.find((r) => r.amountCents > 0)!
    expect(pago.amountCents).toBe(140910800)
    expect(pago.category).toBe('pago_tarjeta')
  })

  it('descarta los planes ya terminados, que no cobran nada este mes', () => {
    expect(res.rows.some((r) => r.description.includes('RAPPI'))).toBe(false)
  })

  it('trae los cargos del recuadro que no bajan a la tabla', () => {
    for (const [texto, cents] of [
      ['Intereses corrientes', -773584],
      ['Cuota de manejo', -3199000],
      ['Seguro de vida deudor', -299000],
    ] as const) {
      expect(res.rows.find((r) => r.description === texto)?.amountCents, texto).toBe(cents)
    }
  })

  it('la suma de cargos da exactamente el pago mínimo del extracto', () => {
    const cargos = res.rows.filter((r) => r.amountCents < 0).reduce((a, r) => a + -r.amountCents, 0)
    expect(cargos).toBe(res.meta.minimumCents)
    expect(res.warnings).toHaveLength(0)
  })
})

describe('fechas del extracto', () => {
  const res = parseFalabella(EXTRACTO)

  it('lee el corte y el vencimiento pese al espaciado', () => {
    expect(res.meta.closingDate).toBe('2026-08-24')
    expect(res.meta.dueDate).toBe('2026-09-10')
  })
})
