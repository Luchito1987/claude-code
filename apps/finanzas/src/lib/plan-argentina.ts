/**
 * Plan de mudanza a Argentina.
 *
 * La pregunta que responde: ¿cuánto tiene que ganar Inés en Argentina para que
 * la familia viva allá y siga pagando lo que debe en Colombia? Y cómo baja ese
 * número a medida que se terminan los créditos.
 *
 * Los supuestos (costo de vida allá, tipo de cambio real, meta de ahorro,
 * fecha objetivo, pendientes) se guardan en settings y se editan desde la
 * pantalla o por API. Lo demás sale de lo que la app ya sabe: préstamos,
 * tarjetas, sueldo argentino y gastos fijos de Colombia.
 */

import { addMonths, financialMonth, todayISO, type ISODate } from './dates'
import { getSetting, listLoans, monthlyIncomeCents, monthlyProjection, setSetting } from './queries'

export interface PendientePlan {
  id: string
  texto: string
  hecho: boolean
}

export interface PlanArgentina {
  /** Pesos colombianos que se reciben por cada peso argentino al pasar plata. */
  fxCopPorArs: number
  /** Costo de vida mensual estimado allá, en centavos de ARS. */
  costoAR: { alquiler: number; mercado: number; colegios: number; servicios: number; otros: number }
  ahorroMetaCop: number
  ahorroActualCop: number
  fechaObjetivo: ISODate
  /** Lo que Inés cree que puede ganar allá por mes, en centavos de ARS. 0 = sin dato. */
  ingresoInesEstimadoArs: number
  pendientes: PendientePlan[]
}

const CLAVE = 'plan_argentina'

const PENDIENTES_INICIALES: PendientePlan[] = [
  { id: 'matricula-caba', texto: 'Inés: renovar la matrícula médica para trabajar en Capital (nacional)', hecho: false },
  { id: 'matricula-pba', texto: 'Inés: renovar la matrícula de la Provincia de Buenos Aires (Colegio de Médicos del distrito)', hecho: false },
  { id: 'ines-trabajos', texto: 'Inés: consultar en Acudir e Infant si la retoman y cuánto pagan hoy la guardia', hecho: false },
  { id: 'compra-cartera', texto: 'Compra de cartera de la Visa (y Falabella) a una tasa menor', hecho: false },
  { id: 'apostilla', texto: 'Apostillar los certificados escolares de Julieta (Biffi)', hecho: false },
  { id: 'vacunas', texto: 'Carnets de vacunación originales de Julieta y Máximo', hecho: false },
  { id: 'dni', texto: 'Revisar vencimiento de DNI y pasaportes de los 4', hecho: false },
  { id: 'garantia', texto: 'Garantía para alquilar: familiar con escritura o pre-aprobación de Finaer', hecho: false },
]

const DEFECTO: PlanArgentina = {
  fxCopPorArs: 1.65,
  costoAR: { alquiler: 120000000, mercado: 116431000, colegios: 23000000, servicios: 40500000, otros: 65000000 },
  ahorroMetaCop: 2750000000,
  ahorroActualCop: 0,
  fechaObjetivo: '2028-03-01',
  ingresoInesEstimadoArs: 0,
  pendientes: PENDIENTES_INICIALES,
}

export function leerPlan(): PlanArgentina {
  try {
    const guardado = JSON.parse(getSetting(CLAVE, '{}')) as Partial<PlanArgentina>
    return { ...DEFECTO, ...guardado, costoAR: { ...DEFECTO.costoAR, ...(guardado.costoAR ?? {}) } }
  } catch {
    return DEFECTO
  }
}

export function guardarPlan(cambios: Partial<PlanArgentina>): PlanArgentina {
  const actual = leerPlan()
  const nuevo: PlanArgentina = {
    ...actual,
    ...cambios,
    costoAR: { ...actual.costoAR, ...(cambios.costoAR ?? {}) },
    pendientes: cambios.pendientes ?? actual.pendientes,
  }
  setSetting(CLAVE, JSON.stringify(nuevo))
  return nuevo
}

export interface DeudaPlan {
  nombre: string
  moneda: 'COP' | 'ARS'
  cuotaCents: number
  cuotasQuedan: number
  /** Mes financiero de la última cuota. */
  terminaEn: string
}

export interface PlanCalculado {
  plan: PlanArgentina
  costoVidaArs: number
  /** Lo que hoy cuesta vivir en Colombia por mes (fijos + variable), sin deudas. */
  costoVidaCop: number
  sueldoLucianoArs: number
  deudas: DeudaPlan[]
  /** Tarjetas colombianas que se siguen pagando (estimado con el último pago). */
  tarjetasCop: number
  /** Por mes: cuánto tendría que ganar Inés en Argentina, en ARS. */
  necesitaInes: Array<{ periodo: string; ars: number; cop: number }>
  hoy: ISODate
}

export function calcularPlan(today: ISODate = todayISO()): PlanCalculado {
  const plan = leerPlan()
  const fx = plan.fxCopPorArs > 0 ? plan.fxCopPorArs : 1
  const costoVidaArs = Object.values(plan.costoAR).reduce((a, b) => a + b, 0)

  const deudas: DeudaPlan[] = (['COP', 'ARS'] as const).flatMap((moneda) =>
    listLoans(moneda)
      .filter((l) => l.active && l.installments_paid < l.installments_total)
      .map((l) => ({
        nombre: l.name,
        moneda,
        cuotaCents: l.installment_cents,
        cuotasQuedan: l.installments_total - l.installments_paid,
        terminaEn: financialMonth(addMonths(l.first_due_date, l.installments_total - 1)),
      })),
  )

  // La proyección de cada lado ya sabe qué cuotas siguen vivas cada mes
  // (préstamos, cuotas de tarjeta, tarjetas sin resumen estimadas).
  const proyCop = monthlyProjection(24, today, 'COP')
  const proyArs = monthlyProjection(24, today, 'ARS')
  const tarjetasCop = proyCop[0] ? proyCop[0].tarjetasCents : 0
  const costoVidaCop = proyCop[0] ? proyCop[0].serviciosCents + proyCop[0].variableCents : 0
  const sueldoLucianoArs = monthlyIncomeCents('ARS')

  const necesitaInes = proyCop.map((mesCop, i) => {
    const mesArs = proyArs[i]
    const deudaArs =
      (mesArs ? mesArs.prestamosCents + mesArs.tarjetasCents : 0) +
      Math.round((mesCop.prestamosCents + mesCop.tarjetasCents) / fx)
    const ars = Math.max(0, costoVidaArs + deudaArs - sueldoLucianoArs)
    return { periodo: mesCop.period, ars, cop: Math.round(ars * fx) }
  })

  return { plan, costoVidaArs, costoVidaCop, sueldoLucianoArs, deudas, tarjetasCop, necesitaInes, hoy: today }
}
