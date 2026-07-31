import { saveServiceAction } from '@/app/actions/data'
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'

export function ServiceForm() {
  return (
    <form action={saveServiceAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <label className="label" htmlFor="svc-name">
          Nombre
        </label>
        <input id="svc-name" name="name" className="input" placeholder="Luz" required />
      </div>
      <div>
        <label className="label" htmlFor="svc-provider">
          Proveedor
        </label>
        <input id="svc-provider" name="provider" className="input" placeholder="Edenor" />
      </div>
      <div>
        <label className="label" htmlFor="svc-amount">
          Importe esperado
        </label>
        <input id="svc-amount" name="expected_amount" className="input" placeholder="0 = promedio" inputMode="decimal" />
      </div>
      <div>
        <label className="label" htmlFor="svc-due">
          Día de vencimiento
        </label>
        <input id="svc-due" name="due_day" type="number" min={1} max={31} defaultValue={10} className="input" />
      </div>
      <div>
        <label className="label" htmlFor="svc-cat">
          Categoría
        </label>
        <select id="svc-cat" name="category" className="input" defaultValue="servicios">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="svc-notes">
          Notas
        </label>
        <input id="svc-notes" name="notes" className="input" placeholder="Nº de cliente, link de pago…" />
      </div>
      <div className="flex items-end gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked className="accent-brand" />
          Activo
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="autodebit" className="accent-brand" />
          Débito automático
        </label>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <button type="submit" className="btn-primary">
          Agregar servicio
        </button>
      </div>
    </form>
  )
}
