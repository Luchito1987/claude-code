import { Badge, Empty, Panel, Table } from '@/components/ui'
import { formatDate, formatMonthShort, formatPeriod, monthRange, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { buildProjection, cardInstallments, minBufferCents, monthlyProjection } from '@/lib/queries'
import { WeeklyChart } from '@/components/WeeklyChart'
import { monedaActual } from '@/lib/vista'

export const dynamic = 'force-dynamic'

export default function ProyeccionPage() {
  const today = todayISO()
  const moneda = monedaActual()
  const meses = monthlyProjection(6, today, moneda)
  const cuotas = cardInstallments(today)
  const semanal = buildProjection(today)
  const buffer = minBufferCents()

  const totalSalidas = meses.reduce((a, m) => a + m.totalCents, 0)
  const totalIngresos = meses.reduce((a, m) => a + m.ingresosCents, 0)
  const peor = meses.reduce((a, m) => (m.netoCents < a.netoCents ? m : a), meses[0])
  const maxTotal = Math.max(...meses.map((m) => m.totalCents), 1)

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Gasto proyectado · 6 meses</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(totalSalidas, moneda)}</p>
          <p className="mt-1 text-xs text-muted">Promedio {formatMoney(Math.round(totalSalidas / meses.length), moneda)}/mes</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Ingresos proyectados</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(totalIngresos, moneda)}</p>
          <p className="mt-1 text-xs text-muted">Con los ingresos fijos cargados</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Mes más ajustado</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${peor.netoCents < 0 ? 'text-bad' : 'text-good'}`}
          >
            {formatMoney(peor.netoCents, moneda)}
          </p>
          <p className="mt-1 text-xs text-muted">{formatPeriod(peor.period)}</p>
        </div>
      </div>

      <Panel
        title="Gastos por mes"
        subtitle="Cada mes va del 28 al 27. Servicios, cuotas de préstamo, cuotas y resúmenes de tarjeta, más el gasto variable estimado."
      >
        <Table
          head={
            <tr>
              <th className="th">Mes</th>
              <th className="th text-right">Servicios</th>
              <th className="th text-right">Préstamos</th>
              <th className="th text-right">Tarjetas</th>
              <th className="th text-right">Variable</th>
              <th className="th text-right">Total</th>
              <th className="th text-right">Ingresos</th>
              <th className="th text-right">Neto</th>
            </tr>
          }
        >
          {meses.map((m) => (
            <tr key={m.period}>
              <td className="td whitespace-nowrap font-medium">{formatMonthShort(m.period)}</td>
              <td className="td text-right tabular-nums">
                {formatMoney(m.serviciosCents, moneda)}
                {m.serviciosEstimados && <span className="ml-1 text-xs text-muted">est.</span>}
              </td>
              <td className="td text-right tabular-nums">{formatMoney(m.prestamosCents, moneda)}</td>
              <td className="td text-right tabular-nums">
                {formatMoney(m.tarjetasCents, moneda)}
                {m.tarjetasEstimadas && <span className="ml-1 text-xs text-muted">est.</span>}
              </td>
              <td className="td text-right tabular-nums text-muted">{formatMoney(m.variableCents, moneda)}</td>
              <td className="td text-right font-medium tabular-nums">{formatMoney(m.totalCents, moneda)}</td>
              <td className="td text-right tabular-nums text-good">{formatMoney(m.ingresosCents, moneda)}</td>
              <td className={`td text-right font-medium tabular-nums ${m.netoCents < 0 ? 'text-bad' : 'text-good'}`}>
                {formatMoney(m.netoCents, moneda)}
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          “est.” marca lo que todavía es estimación: servicios sin factura confirmada y cuotas de tarjeta proyectadas
          desde el último resumen importado. Cuando llega el resumen real, reemplaza a la estimación.
        </p>
      </Panel>

      <Panel title="De qué está hecho cada mes" subtitle="El detalle detrás de cada total">
        <div className="space-y-4">
          {meses.map((m) => {
            const { start, end } = monthRange(m.period)
            const partes = [
              { label: 'Servicios', cents: m.serviciosCents, tone: 'bg-brand' },
              { label: 'Préstamos', cents: m.prestamosCents, tone: 'bg-warn' },
              { label: 'Tarjetas', cents: m.tarjetasCents, tone: 'bg-bad' },
              { label: 'Variable', cents: m.variableCents, tone: 'bg-edge' },
            ].filter((p) => p.cents > 0)

            return (
              <div key={m.period} className="rounded-lg border border-edge p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium">
                    {formatPeriod(m.period)}{' '}
                    <span className="text-xs font-normal text-muted">
                      {formatDate(start)} – {formatDate(end)}
                    </span>
                  </h3>
                  <span className="text-sm tabular-nums">{formatMoney(m.totalCents, moneda)}</span>
                </div>

                <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-ink">
                  {partes.map((p) => (
                    <div
                      key={p.label}
                      className={p.tone}
                      style={{ width: `${(p.cents / m.totalCents) * 100}%` }}
                      title={`${p.label}: ${formatMoney(p.cents, moneda)}`}
                    />
                  ))}
                </div>

                <div className="mt-2 grid gap-3 text-xs sm:grid-cols-3">
                  <div>
                    <p className="mb-1 font-medium text-muted">Servicios</p>
                    <ul className="space-y-0.5">
                      {m.detalle.servicios.slice(0, 6).map((s, i) => (
                        <li key={`${s.label}-${i}`} className="flex justify-between gap-2">
                          <span className="truncate">{s.label}</span>
                          <span className="tabular-nums text-muted">{formatMoney(s.cents, moneda)}</span>
                        </li>
                      ))}
                      {!m.detalle.servicios.length && <li className="text-muted">—</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-muted">Préstamos</p>
                    <ul className="space-y-0.5">
                      {m.detalle.prestamos.map((p, i) => (
                        <li key={`${p.label}-${i}`} className="flex justify-between gap-2">
                          <span className="truncate">{p.label}</span>
                          <span className="tabular-nums text-muted">{formatMoney(p.cents, moneda)}</span>
                        </li>
                      ))}
                      {!m.detalle.prestamos.length && <li className="text-muted">—</li>}
                    </ul>
                  </div>
                  <div>
                    <p className="mb-1 font-medium text-muted">Tarjetas</p>
                    <ul className="space-y-0.5">
                      {m.detalle.tarjetas.slice(0, 6).map((t, i) => (
                        <li key={`${t.label}-${i}`} className="flex justify-between gap-2">
                          <span className="truncate">{t.label}</span>
                          <span className="tabular-nums text-muted">{formatMoney(t.cents, moneda)}</span>
                        </li>
                      ))}
                      {m.detalle.tarjetas.length > 6 && (
                        <li className="text-muted">… {m.detalle.tarjetas.length - 6} más</li>
                      )}
                      {!m.detalle.tarjetas.length && <li className="text-muted">—</li>}
                    </ul>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel
        title="Cuotas de tarjeta comprometidas"
        subtitle="Lo que ya se compró y todavía falta pagar, mes por mes"
      >
        {cuotas.length ? (
          <Table
            head={
              <tr>
                <th className="th">Mes</th>
                <th className="th">Compra</th>
                <th className="th">Cuota</th>
                <th className="th text-right">Importe</th>
              </tr>
            }
          >
            {cuotas.slice(0, 40).map((c, i) => (
              <tr key={`${c.label}-${c.period}-${i}`}>
                <td className="td whitespace-nowrap text-muted">{formatMonthShort(c.period)}</td>
                <td className="td">{c.label}</td>
                <td className="td">
                  <Badge tone="neutral">
                    {c.number}/{c.total}
                  </Badge>
                </td>
                <td className="td text-right tabular-nums">{formatMoney(c.amountCents, moneda)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>
            Sin cuotas pendientes. Aparecen solas cuando importás un resumen de tarjeta con compras en cuotas.
          </Empty>
        )}
      </Panel>

      <Panel
        title="Semana a semana"
        subtitle={`Detalle fino de los próximos ${semanal.weeks.length * 7} días, para ver los picos dentro del mes`}
      >
        <WeeklyChart
          weeks={semanal.weeks.map((w) => ({
            start: w.start,
            label: formatDate(w.start),
            closing: w.closingCents,
            inflow: w.inflowCents,
            outflow: w.outflowCents,
          }))}
          buffer={buffer}
        />
      </Panel>
    </div>
  )
}
