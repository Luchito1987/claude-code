'use client'

import { useFormStatus } from 'react-dom'

/**
 * El OCR tarda unos segundos y el botón queda mudo mientras tanto, así que
 * desde el celular parece que no pasó nada y se toca dos veces. Este botón
 * avisa y se bloquea.
 */
export function ReadButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" className="btn-primary w-full py-3 text-base" disabled={pending}>
      {pending ? 'Leyendo el ticket…' : 'Leer el ticket'}
    </button>
  )
}

/** Al elegir la foto manda solo: un paso menos con el teléfono en la mano. */
export function PhotoInput() {
  return (
    <input
      type="file"
      name="photo"
      accept="image/*"
      capture="environment"
      required
      className="input py-3 file:mr-3 file:rounded-md file:border-0 file:bg-edge file:px-3 file:py-1.5 file:text-sm file:text-slate-200"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    />
  )
}
