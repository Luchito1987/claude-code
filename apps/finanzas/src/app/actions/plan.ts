'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { guardarPlan, leerPlan } from '@/lib/plan-argentina'
import { toCents } from '@/lib/money'

function requireUser() {
  const user = currentUser()
  if (!user) redirect('/login')
  return user
}

const num = (form: FormData, k: string) => String(form.get(k) ?? '').trim()

export async function togglePendienteAction(form: FormData): Promise<void> {
  requireUser()
  const id = num(form, 'id')
  const plan = leerPlan()
  guardarPlan({ pendientes: plan.pendientes.map((p) => (p.id === id ? { ...p, hecho: !p.hecho } : p)) })
  revalidatePath('/plan')
}

export async function agregarPendienteAction(form: FormData): Promise<void> {
  requireUser()
  const texto = num(form, 'texto')
  if (!texto) return
  const plan = leerPlan()
  guardarPlan({ pendientes: [...plan.pendientes, { id: `p-${Date.now()}`, texto, hecho: false }] })
  revalidatePath('/plan')
}

export async function guardarSupuestosAction(form: FormData): Promise<void> {
  requireUser()
  const cents = (k: string) => (num(form, k) ? Math.abs(toCents(num(form, k))) : undefined)
  const plan = leerPlan()
  const fx = Number(num(form, 'fx').replace(',', '.'))
  guardarPlan({
    fxCopPorArs: fx > 0 ? fx : plan.fxCopPorArs,
    ingresoInesEstimadoArs: cents('ines') ?? plan.ingresoInesEstimadoArs,
    ahorroMetaCop: cents('ahorroMeta') ?? plan.ahorroMetaCop,
    ahorroActualCop: cents('ahorroActual') ?? plan.ahorroActualCop,
    fechaObjetivo: /^\d{4}-\d{2}-\d{2}$/.test(num(form, 'fecha')) ? num(form, 'fecha') : plan.fechaObjetivo,
    costoAR: {
      alquiler: cents('alquiler') ?? plan.costoAR.alquiler,
      mercado: cents('mercado') ?? plan.costoAR.mercado,
      colegios: cents('colegios') ?? plan.costoAR.colegios,
      servicios: cents('servicios') ?? plan.costoAR.servicios,
      otros: cents('otros') ?? plan.costoAR.otros,
    },
  })
  revalidatePath('/plan')
}
