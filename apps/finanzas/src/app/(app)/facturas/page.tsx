import { Badge, Empty, Panel, Table } from '@/components/ui'
import { compare, formatDate, formatPeriod, nextPeriod, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { billingWindowView, listBills, listServices } from '@/lib/queries'
import {
  deleteServiceAction,
  generateBillsAction,
  saveServiceAction,
  toggleBillPaidAction,
  updateBillAction,
} from '@/app/actions/data'
import { ServiceForm } from './ServiceForm'

export const dynamic = 'force-dynamic'

export default function FacturasPage({ searchParams }: { searchParams: { period?: string } }) {
  const today = todayISO()
  const view = billingWindowView(today)
  const period = searchParams.period ?? view.window.period
  const bills = listBills(period)
  const services = listServices()
  const total = bills.reduce((a, b) => a + b.amount_cents, 0)
  const pending = bills.filter((b) => b.status !== 'pagado').reduce((a, b) => a + b.amount_cents, 0)

  return (
    <div className="space-y-6">
      <Panel
        title={`Facturas de ${formatPeriod(period)}`}
        subtitle={
          `Ventana de consulta ${view.window.start} → ${view.window.end}. ` +
          (view.window.open
            ? 'Está abierta: es el momento de entrar a cada proveedor y confirmar los importes.'
            : 'Fuera de la ventana: los importes que figuran son estimados.')
        }
        action={
          <form action={generateBillsAction} className="flex items-center gap-2">
            <input type="hidden" name="period" value={nextPeriod(period)} />
            <button type="submit" className="btn-ghost text-xs">
              Generar {formatPeriod(nextPeriod(period))}
            </button>
          </form>
        }
      >
        {bills.length ? (
          <Table
            head={
              <tr>
                <th className="th">Servicio</th>
                <th className="th">Vence</th>
                <th className="th text-right">Importe</th>
                <th className="th">Estado</th>
                <th className="th" />
              </tr>
            }
          >
            {bills.map((b) => {
              const overdue = b.status !== 'pagado' && compare(b.due_date, today) < 0
              return (
                <tr key={b.id}>
                  <td className="td">
                    <span className="font-medium">{b.name}</span>
                    {b.estimated === 1 && (
                      <span className="ml-2">
                        <Badge tone="neutral">estimado</Badge>
                      </span>
                    )}
                  </td>
                  <td className="td text-muted">{formatDate(b.due_date)}</td>
                  <td className="td text-right tabular-nums">{formatMoney(b.amount_cents)}</td>
                  <td className="td">
                    {b.status === 'pagado' ? (
                      <Badge tone="good">pagado</Badge>
                    ) : overdue ? (
                      <Badge tone="bad">vencida</Badge>
                    ) : (
                      <Badge tone="neutral">pendiente</Badge>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <form action={updateBillAction} className="flex items-center gap-1">
                        <input type="hidden" name="id" value={b.id} />
                        <input
                          name="amount"
                          defaultValue={(b.amount_cents / 100).toFixed(2)}
                          className="input w-28 py-1 text-right"
                          aria-label={`Importe de ${b.name}`}
                        />
                        <input
                          name="due_date"
                          type="date"
                          defaultValue={b.due_date}
                          className="input w-36 py-1"
                          aria-label={`Vencimiento de ${b.name}`}
                        />
                        <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                          Confirmar
                        </button>
                      </form>
                      <form action={toggleBillPaidAction}>
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="paid" value={b.status === 'pagado' ? '0' : '1'} />
                        <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                          {b.status === 'pagado' ? 'Reabrir' : 'Pagada'}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <Empty>Sin facturas para este período. Cargá servicios abajo y se generan solas.</Empty>
        )}
        <p className="mt-3 border-t border-edge pt-3 text-sm">
          Total del período <strong className="tabular-nums">{formatMoney(total)}</strong> · pendiente{' '}
          <strong className="tabular-nums">{formatMoney(pending)}</strong>
        </p>
      </Panel>

      <Panel
        title="Servicios"
        subtitle="Cada servicio genera una factura por mes con vencimiento en el día indicado. Si no ponés un importe fijo, se estima con el promedio de las últimas tres."
      >
        <ServiceForm />
        {services.length ? (
          <div className="mt-4">
            <Table
              head={
                <tr>
                  <th className="th">Servicio</th>
                  <th className="th">Proveedor</th>
                  <th className="th">Vence</th>
                  <th className="th text-right">Esperado</th>
                  <th className="th" />
                </tr>
              }
            >
              {services.map((s) => (
                <tr key={s.id}>
                  <td className="td">
                    {s.name}
                    {!s.active && (
                      <span className="ml-2">
                        <Badge tone="neutral">inactivo</Badge>
                      </span>
                    )}
                    {s.autodebit === 1 && (
                      <span className="ml-2">
                        <Badge tone="info">débito automático</Badge>
                      </span>
                    )}
                  </td>
                  <td className="td text-muted">{s.provider || '—'}</td>
                  <td className="td text-muted">día {s.due_day}</td>
                  <td className="td text-right tabular-nums">
                    {s.expected_amount_cents ? formatMoney(s.expected_amount_cents) : 'promedio'}
                  </td>
                  <td className="td text-right">
                    <form action={deleteServiceAction}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="btn-danger px-2 py-1 text-xs">
                        Borrar
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        ) : (
          <Empty>Todavía no cargaste servicios.</Empty>
        )}
      </Panel>
    </div>
  )
}
