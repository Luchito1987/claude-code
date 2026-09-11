'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { loginAction, registerAction, type FormState } from '@/app/actions/auth'

const initial: FormState = {}

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Un momento…' : children}
    </button>
  )
}

export function LoginForm({ bootstrap }: { bootstrap: boolean }) {
  const [state, action] = useFormState(bootstrap ? registerAction : loginAction, initial)

  return (
    <form action={action} className="card mt-6 space-y-4">
      {bootstrap && (
        <div>
          <label className="label" htmlFor="name">
            Nombre
          </label>
          <input id="name" name="name" className="input" autoComplete="name" required />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input id="email" name="email" type="email" className="input" autoComplete="email" required />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          className="input"
          autoComplete={bootstrap ? 'new-password' : 'current-password'}
          required
          minLength={bootstrap ? 10 : undefined}
          defaultValue={state.pideCodigo ? undefined : ''}
        />
        {bootstrap && <p className="mt-1 text-xs text-muted">Mínimo 10 caracteres.</p>}
      </div>
      {state.pideCodigo && (
        <div className="rounded-lg border border-brand/40 bg-brand/10 p-3">
          <label className="label" htmlFor="codigo">
            Código del teléfono
          </label>
          <input
            id="codigo"
            name="codigo"
            className="input tracking-[0.3em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            placeholder="000000"
            autoFocus
            required
          />
          <p className="mt-1 text-xs text-muted">
            Los seis dígitos que muestra ahora tu app de autenticación. Cambian cada treinta segundos.
          </p>
        </div>
      )}
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      <Submit>{bootstrap ? 'Crear usuario y entrar' : state.pideCodigo ? 'Confirmar' : 'Entrar'}</Submit>
    </form>
  )
}
