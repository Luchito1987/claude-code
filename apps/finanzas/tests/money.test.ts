import { describe, expect, it } from 'vitest'
import { toCents, fromCents, pct } from '@/lib/money'

describe('toCents', () => {
  it('lee el formato local argentino', () => {
    expect(toCents('1.234,56')).toBe(123456)
    expect(toCents('12.500')).toBe(1250000)
    expect(toCents('0,50')).toBe(50)
  })

  it('lee el formato anglosajón', () => {
    expect(toCents('1,234.56')).toBe(123456)
    expect(toCents('1234.5')).toBe(123450)
  })

  it('limpia símbolos y espacios', () => {
    expect(toCents('$ 1.234,56')).toBe(123456)
    expect(toCents('ARS 900,00')).toBe(90000)
    expect(toCents('  12,00  ')).toBe(1200)
  })

  it('reconoce las tres formas de negativo que usan los bancos', () => {
    expect(toCents('-1.000,00')).toBe(-100000)
    expect(toCents('(1.000,00)')).toBe(-100000)
    expect(toCents('1.000,00-')).toBe(-100000)
  })

  it('no se confunde con miles de tres dígitos', () => {
    // 1.234 son mil doscientos treinta y cuatro pesos, no 1,234.
    expect(toCents('1.234')).toBe(123400)
  })

  it('devuelve 0 ante basura', () => {
    expect(toCents('')).toBe(0)
    expect(toCents('n/d')).toBe(0)
  })

  it('acepta números', () => {
    expect(toCents(12.5)).toBe(1250)
    expect(fromCents(1250)).toBe(12.5)
  })
})

describe('pct', () => {
  it('redondea a un decimal y tolera el cero', () => {
    expect(pct(1, 3)).toBe(33.3)
    expect(pct(5, 0)).toBe(0)
  })
})
