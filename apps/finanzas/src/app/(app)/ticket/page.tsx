import Link from 'next/link'
import { Badge, Empty, Panel } from '@/components/ui'
import { CATEGORY_LABELS, MANUAL_EXPENSE_CATEGORIES } from '@/lib/categories'
import { todayISO } from '@/lib/dates'
import { listAccounts } from '@/lib/queries'
import { readReceiptAction, saveReceiptAction } from '@/app/actions/receipt'
import { PhotoInput, ReadButton } from './PhotoForm'

export const dynamic = 'force-dynamic'

const ERRORES: Record<string, string> = {
  'sin-foto': 'No llegó ninguna foto. Probá de nuevo.',
  formato: 'Ese archivo no es una imagen. Sacá la foto con la cámara.',
  pesada: 'La foto pesa más de 15 MB. Sacala de nuevo con menos resolución.',
  ocr: 'No se pudo leer la foto, pero quedó guardada. Cargá el importe a mano.',
  'faltan-datos': 'Faltó el importe o el detalle.',
}

export default function TicketPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>
}) {
  const cuentas = listAccounts()
  const { foto, monto, detalle, fecha, categoria, origen, error, ok } = searchParams
  const yaLeido = Boolean(foto)

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {ok && (
        <div className="card border-good/40 bg-good/5">
          <p className="text-sm font-medium text-good">Gasto guardado y descontado del disponible.</p>
          <div className="mt-2 flex gap-3 text-xs">
            <Link href="/ticket" className="text-brand underline">
              Cargar otro ticket
            </Link>
            <Link href="/" className="text-brand underline">
              Volver al tablero
            </Link>
          </div>
        </div>
      )}

      {error && ERRORES[error] && (
        <div className="card border-bad/40 bg-bad/5">
          <p className="text-sm text-bad">{ERRORES[error]}</p>
        </div>
      )}

      {!yaLeido ? (
        <Panel
          title="Foto del ticket"
          subtitle="Sacale una foto al ticket y se lee el importe solo. La foto no sale de tu red: se procesa acá."
        >
          <form action={readReceiptAction} className="space-y-3">
            <PhotoInput />
            <ReadButton />
            <p className="text-xs text-muted">
              Que se vea la línea del total y sin sombra encima. Tarda unos segundos en leerla.
            </p>
          </form>
        </Panel>
      ) : (
        <Panel
          title="Revisá lo que se leyó"
          subtitle="Corregí lo que haga falta antes de guardar. Nada se descuenta hasta que confirmes."
          action={
            <Link href="/ticket" className="text-xs text-brand hover:underline">
              Otra foto →
            </Link>
          }
        >
          <form action={saveReceiptAction} className="space-y-3">
            <input type="hidden" name="foto" value={foto} />

            <div>
              <label className="label" htmlFor="tk-monto">
                Importe
                {origen === 'mayor' && (
                  <span className="ml-2 normal-case">
                    <Badge tone="warn">revisalo</Badge>
                  </span>
                )}
                {origen === 'ninguno' && (
                  <span className="ml-2 normal-case">
                    <Badge tone="bad">no se leyó</Badge>
                  </span>
                )}
              </label>
              <input
                id="tk-monto"
                name="amount"
                className="input py-3 text-lg"
                inputMode="decimal"
                defaultValue={monto ?? ''}
                placeholder="24.633"
                required
                autoFocus={!monto}
              />
              {origen === 'mayor' && (
                <p className="mt-1 text-xs text-warn">
                  No se encontró una línea que dijera “total”, así que se tomó el número más grande del ticket.
                </p>
              )}
            </div>

            <div>
              <label className="label" htmlFor="tk-detalle">
                Detalle
              </label>
              <input
                id="tk-detalle"
                name="description"
                className="input py-3"
                defaultValue={detalle ?? ''}
                placeholder="Supermercado"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="tk-fecha">
                  Fecha
                </label>
                <input
                  id="tk-fecha"
                  name="date"
                  type="date"
                  className="input py-3"
                  defaultValue={fecha ?? todayISO()}
                />
              </div>
              <div>
                <label className="label" htmlFor="tk-cat">
                  Categoría
                </label>
                <select id="tk-cat" name="category" className="input py-3" defaultValue={categoria ?? 'otros'}>
                  {MANUAL_EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="label" htmlFor="tk-cuenta">
                Sale de
              </label>
              <select
                id="tk-cuenta"
                name="account_id"
                className="input py-3"
                defaultValue={cuentas[0]?.id ?? ''}
              >
                <option value="">No mover saldo</option>
                {cuentas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <button type="submit" className="btn-primary w-full py-3 text-base">
              Guardar y descontar
            </button>
          </form>
        </Panel>
      )}

      {!yaLeido && !ok && (
        <Empty>
          También podés cargarlo a mano desde{' '}
          <Link href="/" className="text-brand underline">
            el tablero
          </Link>
          .
        </Empty>
      )}
    </div>
  )
}
