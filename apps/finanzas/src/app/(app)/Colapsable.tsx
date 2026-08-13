'use client'

import { useState, type ReactNode } from 'react'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

/**
 * Un bloque del mes: siempre se ve el título con su subtotal, y el detalle se
 * despliega al tocarlo.
 *
 * El control accesible es el botón del título, pero el `onClick` va en la fila
 * entera para poder tocar en cualquier parte: el click del botón burbujea hasta
 * acá, así que con mouse o con Enter se alterna una sola vez.
 */
export function FilaColapsable({
  titulo,
  total,
  estado,
  children,
  abiertoInicial = false,
}: {
  titulo: string
  total: string
  estado: string
  children: ReactNode
  abiertoInicial?: boolean
}) {
  const [open, setOpen] = useState(abiertoInicial)

  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer bg-edge/40 hover:bg-edge/70"
      >
        <td className="px-3 py-2" colSpan={2}>
          <button
            type="button"
            aria-expanded={open}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-100"
          >
            <Chevron open={open} />
            {titulo}
          </button>
        </td>
        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums">{total}</td>
        <td className="px-3 py-2 text-xs text-muted" colSpan={2}>
          {estado}
        </td>
      </tr>
      {open && children}
    </>
  )
}

/** Lo mismo para un panel suelto, donde no hay tabla que respetar. */
export function PanelColapsable({
  titulo,
  resumen,
  children,
  abiertoInicial = false,
}: {
  titulo: string
  resumen: string
  children: ReactNode
  abiertoInicial?: boolean
}) {
  const [open, setOpen] = useState(abiertoInicial)

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left hover:bg-edge/50"
      >
        <Chevron open={open} />
        <span className="text-sm font-semibold text-slate-100">{titulo}</span>
        <span className="ml-auto text-sm font-semibold tabular-nums">{resumen}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  )
}
