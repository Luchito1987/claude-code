import Link from 'next/link'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'
import { addDays, compare, formatDate, formatPeriod, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import {
  buildProjection,
  listAccounts,
  listBills,
  listCards,
  listLoans,
  listRappiOrders,
  listServices,
  listTransactions,
  minBufferCents,
  monthSummary,
  monthlyIncomeCents,
} from '@/lib/queries'
import { buildRecommendations } from '@/lib/recommendations'
import { analyzeRappi } from '@/lib/parsers/rappi'
import { saveTransactionAction, toggleBillPaidAction, toggleMonthItemPaidAction } from '@/app/actions/data'

export const dynamic = 'force-dynamic'

export default function Tablero() {
  const today = todayISO()
  const mes = monthSummary(today)
  const cuentas = listAccounts()
  const pendientes = mes.items.filter((i) => !i.paid)
  const pagados = mes.items.filter((i) => i.paid)

  return (
    <div className="space-y-6">
      {/* Los tres números que se miran primero. */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Dinero disponible</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(mes.availableCents)}</p>
          <p className="mt-1 text-xs text-muted">
            {cuentas.length ? cuentas.map((c) => c.name).join(' · ') : 'Sin cuentas cargadas'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Falta pagar en {formatPeriod(mes.period)}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-warn">{formatMoney(mes.pendingCents)}</p>
          <p className="mt-1 text-xs text-muted">
            {pendientes.length} pendiente(s)
            {pagados.length ? ` · ${formatMoney(mes.paidCents)} ya pagado` : ''}
          </p>
        </div>
        <div
          className={`card ${mes.netCents < 0 ? 'border-bad/50' : 'border-good/40'}`}
        >
          <p className="text-xs uppercase tracking-wide text-muted">Neto después de pagar</p>
          <p
            className={`mt-1 text-3xl font-semibold tabular-nums ${mes.netCents < 0 ? 'text-bad' : 'text-good'}`}
          >
            {formatMoney(mes.netCents)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {mes.netCents < 0
              ? `Faltan ${formatMoney(-mes.netCents)} para cubrir el mes`
              : 'Queda disponible después de los compromisos'}
          </p>
        </div>
      </section>

      <Panel
        title={`Pagos de ${formatPeriod(mes.period)}`}
        subtitle={`El mes va del ${mes.start} al ${mes.end}. El 28 cierra y se arma la lista del mes siguiente.`}
        action={
          <Link href="/proyeccion" className="text-xs text-brand hover:underline">
            Ver 6 meses →
          </Link>
        }
      >
        {mes.items.length ? (
          <Table
            head={
              <tr>
                <th className="th">Concepto</th>
                <th className="th">Vence</th>
                <th className="th text-right">Importe</th>
                <th className="th">Estado</th>
                <th className="th" />
              </tr>
            }
          >
            {mes.items.map((item) => {
              const vencido = !item.paid && compare(item.dueDate, today) < 0
              return (
                <tr key={`${item.kind}-${item.refId}`} className={item.paid ? 'opacity-55' : ''}>
                  <td className="td">
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-2 text-xs text-muted">{item.detail}</span>
                  </td>
                  <td className="td whitespace-nowrap text-muted">{formatDate(item.dueDate)}</td>
                  <td className="td text-right tabular-nums">{formatMoney(item.cents)}</td>
                  <td className="td">
                    {item.paid ? (
                      <Badge tone="good">pagado</Badge>
                    ) : vencido ? (
                      <Badge tone="bad">vencido</Badge>
                    ) : item.estimated ? (
                      <Badge tone="neutral">estimado</Badge>
                    ) : (
                      <Badge tone="neutral">pendiente</Badge>
                    )}
                  </td>
                  <td className="td text-right">
                    {item.kind === 'factura' ? (
                      <form action={toggleBillPaidAction}>
                        <input type="hidden" name="id" value={item.refId} />
                        <input type="hidden" name="paid" value={item.paid ? '0' : '1'} />
                        <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                          {item.paid ? 'Reabrir' : 'Pagado'}
                        </button>
                      </form>
                    ) : (
                      <form action={toggleMonthItemPaidAction}>
                        <input type="hidden" name="kind" value={item.kind} />
                        <input type="hidden" name="refId" value={item.refId} />
                        <input type="hidden" name="period" value={mes.period} />
                        <input type="hidden" name="amount" value={(item.cents / 100).toFixed(2)} />
                        <input type="hidden" name="paid" value={item.paid ? '0' : '1'} />
                        <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                          {item.paid ? 'Reabrir' : 'Pagado'}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <Empty>
            Sin pagos cargados para este mes.{' '}
            <Link href="/facturas" className="text-brand underline">
              Dar de alta servicios
            </Link>
          </Empty>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <MovimientoRapido tipo="gasto" cuentas={cuentas} />
        <MovimientoRapido tipo="ingreso" cuentas={cuentas} />
      </div>

      <Recomendaciones today={today} />
    </div>
  )
}

/** Alta rápida de un gasto o un ingreso del mes, sin salir del tablero. */
function MovimientoRapido({
  tipo,
  cuentas,
}: {
  tipo: 'gasto' | 'ingreso'
  cuentas: Array<{ id: string; name: string }>
}) {
  const esGasto = tipo === 'gasto'
  const cards = listCards()

  return (
    <Panel
      title={esGasto ? 'Registrar un gasto' : 'Registrar un ingreso'}
      subtitle={
        esGasto
          ? 'Tickets, compras en efectivo, cualquier salida que no venga en un extracto'
          : 'Un cobro extra, una venta, un reintegro'
      }
    >
      <form action={saveTransactionAction} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="direction" value={esGasto ? 'gasto' : 'ingreso'} />
        <div>
          <label className="label" htmlFor={`${tipo}-fecha`}>
            Fecha
          </label>
          <input id={`${tipo}-fecha`} name="date" type="date" defaultValue={todayISO()} className="input" />
        </div>
        <div>
          <label className="label" htmlFor={`${tipo}-monto`}>
            Importe
          </label>
          <input
            id={`${tipo}-monto`}
            name="amount"
            className="input"
            inputMode="decimal"
            placeholder="12.500,00"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor={`${tipo}-detalle`}>
            Detalle
          </label>
          <input
            id={`${tipo}-detalle`}
            name="description"
            className="input"
            placeholder={esGasto ? 'Verdulería del barrio' : 'Trabajo extra'}
            required
          />
        </div>
        {esGasto && (
          <div>
            <label className="label" htmlFor={`${tipo}-cat`}>
              Categoría
            </label>
            <select id={`${tipo}-cat`} name="category" className="input" defaultValue="">
              <option value="">Automática</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="label" htmlFor={`${tipo}-cuenta`}>
            {esGasto ? 'Sale de' : 'Entra en'}
          </label>
          <select id={`${tipo}-cuenta`} name="account_id" className="input" defaultValue={cuentas[0]?.id ?? ''}>
            <option value="">No mover saldo</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {esGasto && (
          <div>
            <label className="label" htmlFor={`${tipo}-tarjeta`}>
              ¿Con tarjeta?
            </label>
            <select id={`${tipo}-tarjeta`} name="card_id" className="input" defaultValue="">
              <option value="">No, efectivo o débito</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="sm:col-span-2 flex items-center gap-3">
          <button type="submit" className="btn-primary">
            {esGasto ? 'Agregar gasto' : 'Agregar ingreso'}
          </button>
          <span className="text-xs text-muted">
            {esGasto
              ? 'Si elegís una cuenta, se descuenta del disponible. Lo de tarjeta impacta recién al vencer el resumen.'
              : 'Si elegís una cuenta, se suma al disponible.'}
          </span>
        </div>
      </form>
    </Panel>
  )
}

function Recomendaciones({ today }: { today: string }) {
  const projection = buildProjection(today)
  const orders = listRappiOrders()
  const recos = buildRecommendations({
    today,
    projection,
    transactions: listTransactions({ from: addDays(today, -120) }),
    bills: listBills(),
    services: listServices(),
    loans: listLoans(),
    monthlyIncomeCents: monthlyIncomeCents(),
    minBufferCents: minBufferCents(),
    rappi: orders.length
      ? analyzeRappi(
          orders.map((o) => ({
            date: o.date,
            store: o.store,
            totalCents: o.total_cents,
            productsCents: o.products_cents,
            deliveryCents: o.delivery_cents,
            serviceCents: o.service_cents,
            tipCents: o.tip_cents,
            itemsCount: o.items_count,
            vertical: o.vertical,
            raw: '',
          })),
        )
      : undefined,
    windowOpen: true,
    windowPeriod: '',
  })

  if (!recos.length) return null

  return (
    <Panel
      title="Recomendaciones de la semana"
      subtitle="Reglas sobre tus propios datos, ordenadas por urgencia"
      action={
        <Link href="/reportes" className="text-xs text-brand hover:underline">
          Exportar informe →
        </Link>
      }
    >
      <ul className="space-y-3">
        {recos.slice(0, 4).map((r) => (
          <li key={r.id} className="rounded-lg border border-edge p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  r.severity === 'critica'
                    ? 'bad'
                    : r.severity === 'alta'
                      ? 'warn'
                      : r.severity === 'media'
                        ? 'info'
                        : 'neutral'
                }
              >
                {r.severity}
              </Badge>
              <h3 className="text-sm font-medium">{r.title}</h3>
              {r.impactCents > 0 && (
                <span className="ml-auto text-xs tabular-nums text-muted">{formatMoney(r.impactCents)}</span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-slate-300">{r.body}</p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
