'use client'

import { useState } from 'react'

/**
 * Un número que se copia de un toque, para pegarlo en la página de la empresa
 * (el contrato de la luz en la de Air-e, por ejemplo). El número queda también
 * seleccionable, por si el navegador no deja escribir en el portapapeles.
 */
export function CopiarTexto({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <button
      type="button"
      title="Copiar"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(texto)
          setCopiado(true)
          setTimeout(() => setCopiado(false), 1500)
        } catch {
          // Sin permiso para el portapapeles: queda el número seleccionable.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-xs hover:bg-black/5 focus-visible:outline focus-visible:outline-1"
    >
      <span className="select-all tabular-nums">{texto}</span>
      <span className="text-muted" aria-live="polite">
        {copiado ? 'copiado' : 'copiar'}
      </span>
    </button>
  )
}
