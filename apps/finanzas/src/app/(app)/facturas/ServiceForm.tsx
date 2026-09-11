import { saveServiceAction } from '@/app/actions/data'
import { BILLABLE_CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'

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
          {BILLABLE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-muted">
          “Servicios” son los medidos, que cambian todos los meses (luz, agua, gas). El resto entra en Gastos
          fijos, donde el importe que cargues rige de ese mes en adelante.
        </p>
      </div>
      <div className="sm:col-span-2">
        <label className="label" htmlFor="svc-match">
          Cómo aparece en el extracto
        </label>
        <input
          id="svc-match"
          name="match_pattern"
          className="input"
          placeholder="EMPRESA DE ENERGIA AI"
        />
        <p className="mt-1 text-xs text-muted">
          Un pedazo del texto con el que el banco lo nombra. Sirve para que al importar el extracto la factura
          quede pagada sola y con el importe real. Air-e, por ejemplo, se paga como “PAGO SV EMPRESA DE ENERGIA
          AI”, y Triple A como “PAGO PSE FIDUCIARIA BANCOLOM”: por el nombre no hay forma de adivinarlo.
        </p>
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
