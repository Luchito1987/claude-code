'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { importRappiAction, type ImportState } from '@/app/actions/import'

const initial: ImportState = {}

const EJEMPLO = `Pedido #98765432
Fecha: 12/07/2026
Restaurante: Mostaza Cabildo
Productos $ 14.300,00
Costo de envío $ 1.900,00
Tarifa de servicio $ 850,00
Propina $ 1.000,00
Total $ 18.050,00`

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Procesando…' : 'Importar pedidos'}
    </button>
  )
}

export function RappiImportForm() {
  const [state, action] = useFormState(importRappiAction, initial)

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="rp-file">
          Archivo (.csv o .txt con los mails)
        </label>
        <input id="rp-file" name="file" type="file" accept=".csv,.txt,.eml,text/csv,text/plain" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="rp-text">
          …o pegá los mails de confirmación
        </label>
        <textarea id="rp-text" name="text" rows={8} className="input font-mono text-xs" placeholder={EJEMPLO} />
        <p className="mt-1 text-xs text-muted">
          Podés pegar varios pedidos seguidos: se separan por el número de pedido o por una línea en blanco.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Submit />
        {state.ok && <span className="text-sm text-good">{state.ok}</span>}
        {state.error && <span className="text-sm text-bad">{state.error}</span>}
      </div>
      {state.detail?.length ? (
        <ul className="list-inside list-disc space-y-0.5 text-xs text-muted">
          {state.detail.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </form>
  )
}
