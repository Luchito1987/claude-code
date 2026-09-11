import { describe, expect, it } from 'vitest'
import { addDays, addMonths, billingWindowFor, currentWindow, diffDays, iso, weekStart } from '@/lib/dates'

describe('ventana de facturación 28 → 15', () => {
  it('el 28 abre la ventana del mes siguiente', () => {
    const w = currentWindow('2026-07-28')
    expect(w.period).toBe('2026-08')
    expect(w.start).toBe('2026-07-28')
    expect(w.end).toBe('2026-08-15')
    expect(w.open).toBe(true)
  })

  it('antes del 28 sigue vigente la ventana del mes en curso', () => {
    const w = currentWindow('2026-07-10')
    expect(w.period).toBe('2026-07')
    expect(w.start).toBe('2026-06-28')
    expect(w.end).toBe('2026-07-15')
    expect(w.open).toBe(true)
  })

  it('entre el 16 y el 27 la ventana está cerrada', () => {
    const w = currentWindow('2026-07-20')
    expect(w.period).toBe('2026-07')
    expect(w.open).toBe(false)
  })

  it('cruza el año correctamente', () => {
    const w = billingWindowFor('2027-01')
    expect(w.start).toBe('2026-12-28')
    expect(w.end).toBe('2027-01-15')
  })
})

describe('aritmética de fechas', () => {
  it('suma días cruzando meses y años', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('suma meses recortando al último día disponible', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('respeta los años bisiestos', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(iso(2028, 2, 31)).toBe('2028-02-29')
  })

  it('cuenta días entre fechas', () => {
    expect(diffDays('2026-07-01', '2026-07-31')).toBe(30)
    expect(diffDays('2026-07-31', '2026-07-01')).toBe(-30)
  })

  it('el lunes es el inicio de semana', () => {
    expect(weekStart('2026-07-31')).toBe('2026-07-27') // viernes -> lunes
    expect(weekStart('2026-07-27')).toBe('2026-07-27')
    expect(weekStart('2026-08-02')).toBe('2026-07-27') // domingo -> lunes previo
  })
})
