'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { useState } from 'react'
import { importStatementAction, type ImportState } from '@/app/actions/import'

const initial: ImportState = {}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Procesando…' : 'Importar'}
    </button>
  )
}

export function ImportForm({
  accounts,
  cards,
}: {
  accounts: Array<{ id: string; name: string }>
  cards: Array<{ id: string; name: string }>
}) {
  const [state, action] = useFormState(importStatementAction, initial)
  const [kind, setKind] = useState<'account' | 'card' | 'gastos'>('account')
  const targets = kind === 'card' ? cards : accounts

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="imp-kind">
            Tipo de extracto
          </label>
          <select
            id="imp-kind"
            name="kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as 'account' | 'card' | 'gastos')}
          >
            <option value="account">Cuenta (caja de ahorro / corriente)</option>
            <option value="card">Resumen de tarjeta de crédito</option>
            <option value="gastos">Planilla propia de gastos</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="imp-target">
            {kind === 'card' ? 'Tarjeta' : 'Cuenta'}
          </label>
          <select id="imp-target" name="target" className="input" required>
            <option value="">Elegir…</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {!targets.length && (
            <p className="mt-1 text-xs text-warn">
              Primero cargá {kind === 'card' ? 'una tarjeta' : 'una cuenta'} en Configuración.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="imp-file">
          Archivo (.csv, .tsv, .txt, .xlsx)
        </label>
        <input
          id="imp-file"
          name="file"
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,text/csv,text/plain"
          className="input"
        />
      </div>

      <div>
        <label className="label" htmlFor="imp-text">
          …o pegá el texto del extracto
        </label>
        <textarea
          id="imp-text"
          name="text"
          rows={6}
          className="input font-mono text-xs"
          placeholder={'05/07/2026  RAPPI*BURGER  -12.450,00\n06/07/2026  COTO CICSA  -38.900,00'}
        />
        <p className="mt-1 text-xs text-muted">
          Sirve para PDF: abrí el resumen, seleccioná el detalle de movimientos y pegalo acá.
        </p>
        {kind === 'gastos' && (
          <p className="mt-2 rounded-lg border border-edge bg-ink p-2 text-xs text-slate-300">
            En una planilla de gastos los importes van positivos y se cargan como egresos. Si tenés una columna
            “Categoría”, se respeta la tuya en lugar de adivinarla por el comercio.
          </p>
        )}
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
