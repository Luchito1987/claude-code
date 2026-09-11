'use client'

import { useFormState, useFormStatus } from 'react-dom'
import { confirmarTotpAction, desactivarTotpAction, type FormState } from '@/app/actions/auth'

const initial: FormState = {}

function Boton({ children }: { children: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary" disabled={pending}>
      {pending ? 'Un momento…' : children}
    </button>
  )
}

function CampoCodigo({ id }: { id: string }) {
  return (
    <input
      id={id}
      name="codigo"
      className="input tracking-[0.3em]"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      placeholder="000000"
      required
    />
  )
}

/** Paso final del alta: el código prueba que el teléfono quedó bien configurado. */
export function ConfirmarTotp({ qr, secreto }: { qr: string; secreto: string }) {
  const [state, action] = useFormState(confirmarTotpAction, initial)

  return (
    <div className="grid gap-4 sm:grid-cols-[auto,1fr]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Código QR para la app de autenticación" className="h-44 w-44 rounded-lg bg-white p-2" />
      <div>
        <p className="text-sm text-slate-300">
          Escaneá el código con Google Authenticator, Authy o la app que uses. Si no podés escanear, cargá esta
          clave a mano:
        </p>
        <code className="mt-2 block break-all rounded-lg bg-ink p-2 text-xs tracking-wider text-slate-200">
          {secreto}
        </code>
        <form action={action} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <label className="label" htmlFor="totp-alta">
              Escribí el código que muestra
            </label>
            <CampoCodigo id="totp-alta" />
          </div>
          <Boton>Activar</Boton>
        </form>
        {state.error && <p className="mt-2 text-sm text-bad">{state.error}</p>}
        {state.ok && <p className="mt-2 text-sm text-good">{state.ok}</p>}
        <p className="mt-2 text-xs text-muted">
          Guardá la clave en un lugar seguro. Si perdés el teléfono y no la tenés, hay que apagar el segundo
          factor desde la base de datos del servidor.
        </p>
      </div>
    </div>
  )
}

export function DesactivarTotp() {
  const [state, action] = useFormState(desactivarTotpAction, initial)

  return (
    <div>
      <p className="text-sm text-good">El ingreso pide contraseña y código del teléfono.</p>
      <form action={action} className="mt-3 flex items-end gap-2">
        <div className="flex-1 sm:max-w-xs">
          <label className="label" htmlFor="totp-baja">
            Para desactivarlo, escribí un código
          </label>
          <CampoCodigo id="totp-baja" />
        </div>
        <button type="submit" className="btn-danger">
          Desactivar
        </button>
      </form>
      <p className="mt-1 text-xs text-muted">
        Se pide el código para que nadie que se siente frente a una sesión abierta pueda sacarlo de un clic.
      </p>
      {state.error && <p className="mt-2 text-sm text-bad">{state.error}</p>}
      {state.ok && <p className="mt-2 text-sm text-good">{state.ok}</p>}
    </div>
  )
}
