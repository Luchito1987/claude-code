'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { registerAction, type FormState } from '@/app/actions/auth'

const initial: FormState = {}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full" disabled={pending}>
      {pending ? 'Creando…' : 'Crear usuario'}
    </button>
  )
}

export function UserForm() {
  const [state, action] = useFormState(registerAction, initial)

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-4">
      <div>
        <label className="label" htmlFor="usr-name">
          Nombre
        </label>
        <input id="usr-name" name="name" className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="usr-email">
          Email
        </label>
        <input id="usr-email" name="email" type="email" className="input" required />
      </div>
      <div>
        <label className="label" htmlFor="usr-pass">
          Contraseña
        </label>
        <input id="usr-pass" name="password" type="password" className="input" minLength={10} required />
      </div>
      <div className="flex items-end">
        <Submit />
      </div>
      {(state.error || state.ok) && (
        <p className={`sm:col-span-4 text-sm ${state.error ? 'text-bad' : 'text-good'}`}>{state.error ?? state.ok}</p>
      )}
    </form>
  )
}
