import { Empty, Panel, Table } from '@/components/ui'
import { formatPeriod } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { calcularPlan } from '@/lib/plan-argentina'
import { agregarPendienteAction, guardarSupuestosAction, togglePendienteAction } from '@/app/actions/plan'

export const dynamic = 'force-dynamic'

const ars = (c: number) => formatMoney(c, 'ARS')
const cop = (c: number) => formatMoney(c, 'COP')
const pesos = (c: number) => (c / 100).toLocaleString('es-AR', { maximumFractionDigits: 0 })

export default function PlanArgentinaPage() {
  const p = calcularPlan()
  const { plan } = p
  const fx = plan.fxCopPorArs
  const hoy = p.necesitaInes[0]
  const costoArCop = Math.round(p.costoVidaArs * fx)
  const ahorroPct = plan.ahorroMetaCop ? Math.min(100, Math.round((plan.ahorroActualCop / plan.ahorroMetaCop) * 100)) : 0
  const meses = Math.max(
    0,
    (Number(plan.fechaObjetivo.slice(0, 4)) - Number(p.hoy.slice(0, 4))) * 12 +
      Number(plan.fechaObjetivo.slice(5, 7)) -
      Number(p.hoy.slice(5, 7)),
  )
  const hechos = plan.pendientes.filter((x) => x.hecho).length

  // Sólo los meses donde cambia lo que necesita Inés: ahí se terminó algo.
  const cambios = p.necesitaInes.filter((m, i) => i === 0 || m.ars !== p.necesitaInes[i - 1].ars)
  const ines = plan.ingresoInesEstimadoArs

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Inés tendría que ganar allá</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-warn">{ars(hoy?.ars ?? 0)}</p>
          <p className="mt-1 text-xs text-muted">por mes hoy · ≈ {cop(hoy?.cop ?? 0)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Costo de vida por mes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{cop(costoArCop)}</p>
          <p className="mt-1 text-xs text-muted">en Argentina ({ars(p.costoVidaArs)}) · hoy en Colombia {cop(p.costoVidaCop)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Ahorro para instalarse</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{ahorroPct}%</p>
          <div className="mt-2 h-1.5 rounded-full bg-edge">
            <div className="h-1.5 rounded-full bg-brand" style={{ width: `${ahorroPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {cop(plan.ahorroActualCop)} de {cop(plan.ahorroMetaCop)}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Fecha objetivo</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPeriod(plan.fechaObjetivo.slice(0, 7))}</p>
          <p className="mt-1 text-xs text-muted">
            faltan {meses} meses · pendientes {hechos}/{plan.pendientes.length}
          </p>
        </div>
      </section>

      <Panel
        title="Cuánto tiene que ganar Inés en Argentina"
        subtitle={`Costo de vida allá + cuotas de Colombia y Argentina − sueldo de Luciano (${ars(p.sueldoLucianoArs)}). Baja cada vez que se termina una deuda. Cambio: 1 ARS = ${fx} COP.`}
      >
        <Table
          head={
            <tr>
              <th className="th">Desde</th>
              <th className="th text-right">Inés necesita (ARS)</th>
              <th className="th text-right">En COP</th>
              {ines > 0 && <th className="th text-right">Con lo que estima ganar</th>}
            </tr>
          }
        >
          {cambios.map((m) => (
            <tr key={m.periodo}>
              <td className="td">{formatPeriod(m.periodo)}</td>
              <td className="td text-right tabular-nums">{ars(m.ars)}</td>
              <td className="td text-right tabular-nums text-muted">{cop(m.cop)}</td>
              {ines > 0 && (
                <td className={`td text-right tabular-nums ${ines >= m.ars ? 'text-good' : 'text-bad'}`}>
                  {ines >= m.ars ? `sobra ${ars(ines - m.ars)}` : `falta ${ars(m.ars - ines)}`}
                </td>
              )}
            </tr>
          ))}
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Deudas que siguen y cuándo terminan" subtitle="Se pagan vivan donde vivan">
          {p.deudas.length ? (
            <Table
              head={
                <tr>
                  <th className="th">Deuda</th>
                  <th className="th text-right">Cuota</th>
                  <th className="th text-right">Quedan</th>
                  <th className="th">Termina</th>
                </tr>
              }
            >
              {[...p.deudas]
                .sort((a, b) => a.terminaEn.localeCompare(b.terminaEn))
                .map((d) => (
                  <tr key={d.nombre}>
                    <td className="td">{d.nombre}</td>
                    <td className="td text-right tabular-nums">{formatMoney(d.cuotaCents, d.moneda)}</td>
                    <td className="td text-right tabular-nums">{d.cuotasQuedan}</td>
                    <td className="td whitespace-nowrap">{formatPeriod(d.terminaEn)}</td>
                  </tr>
                ))}
            </Table>
          ) : (
            <Empty>Sin préstamos activos.</Empty>
          )}
          {p.tarjetasCop > 0 && (
            <p className="mt-2 text-xs text-muted">
              Más tarjetas en Colombia: ≈ {cop(p.tarjetasCop)} por mes (Visa y Rappi, estimado con el último pago).
            </p>
          )}
        </Panel>

        <Panel title="Pendientes" subtitle="Lo que hay que resolver antes de viajar">
          <ul className="space-y-1.5">
            {plan.pendientes.map((x) => (
              <li key={x.id}>
                <form action={togglePendienteAction} className="flex items-start gap-2">
                  <input type="hidden" name="id" value={x.id} />
                  <button
                    type="submit"
                    className={`mt-0.5 h-4 w-4 shrink-0 rounded border ${x.hecho ? 'border-good bg-good' : 'border-edge'}`}
                    aria-label={x.hecho ? 'Marcar pendiente' : 'Marcar hecho'}
                  />
                  <span className={`text-sm ${x.hecho ? 'text-muted line-through' : ''}`}>{x.texto}</span>
                </form>
              </li>
            ))}
          </ul>
          <form action={agregarPendienteAction} className="mt-3 flex gap-2">
            <input name="texto" className="input flex-1" placeholder="Agregar pendiente" />
            <button type="submit" className="btn-ghost px-3 py-1 text-xs">
              Agregar
            </button>
          </form>
        </Panel>
      </div>

      <Panel title="Supuestos" subtitle="Los números con los que se calcula el plan. Corregilos cuando tengas datos reales.">
        <form action={guardarSupuestosAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['ines', 'Inés estima ganar allá (ARS/mes)', plan.ingresoInesEstimadoArs],
              ['alquiler', 'Alquiler (ARS/mes)', plan.costoAR.alquiler],
              ['mercado', 'Mercado (ARS/mes)', plan.costoAR.mercado],
              ['colegios', 'Colegios (ARS/mes)', plan.costoAR.colegios],
              ['servicios', 'Servicios y transporte (ARS/mes)', plan.costoAR.servicios],
              ['otros', 'Ropa, farmacia, salidas, imprevistos (ARS/mes)', plan.costoAR.otros],
              ['ahorroMeta', 'Meta de ahorro para instalarse (COP)', plan.ahorroMetaCop],
              ['ahorroActual', 'Ahorrado hasta hoy (COP)', plan.ahorroActualCop],
            ] as const
          ).map(([name, label, valor]) => (
            <div key={name}>
              <label className="label" htmlFor={`plan-${name}`}>
                {label}
              </label>
              <input id={`plan-${name}`} name={name} className="input" inputMode="decimal" defaultValue={pesos(valor)} />
            </div>
          ))}
          <div>
            <label className="label" htmlFor="plan-fx">
              COP por cada ARS (lo que te dan al pasar plata)
            </label>
            <input id="plan-fx" name="fx" className="input" inputMode="decimal" defaultValue={String(fx)} />
          </div>
          <div>
            <label className="label" htmlFor="plan-fecha">
              Fecha objetivo
            </label>
            <input id="plan-fecha" name="fecha" type="date" className="input" defaultValue={plan.fechaObjetivo} />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full">
              Guardar
            </button>
          </div>
        </form>
      </Panel>
    </div>
  )
}
