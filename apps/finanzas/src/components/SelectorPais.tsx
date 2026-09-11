import { setVistaAction } from '@/app/actions/data'
import { PAISES } from '@/lib/vista'
import type { CodigoPais } from '@/lib/vista'

/**
 * Conmuta entre el bolsillo colombiano y el argentino.
 *
 * Va en el encabezado y no escondido en Configuración porque no es un ajuste
 * que se toca una vez: es el contexto de todo lo que se está mirando, y hay que
 * poder verlo de un vistazo para no leer un número creyendo que es de la otra
 * moneda.
 */
export function SelectorPais({ actual }: { actual: CodigoPais }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-edge p-0.5">
      {PAISES.map((p) => (
        <form key={p.codigo} action={setVistaAction}>
          <input type="hidden" name="pais" value={p.codigo} />
          <button
            type="submit"
            aria-current={p.codigo === actual ? 'true' : undefined}
            title={`Ver ${p.nombre} (${p.moneda})`}
            className={`rounded-md px-2 py-1 text-xs transition-colors ${
              p.codigo === actual ? 'bg-edge text-slate-100' : 'text-muted hover:text-slate-200'
            }`}
          >
            {p.codigo}
          </button>
        </form>
      ))}
    </div>
  )
}
