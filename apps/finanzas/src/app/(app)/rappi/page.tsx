import { BarList, Empty, Panel, Stat, Table } from '@/components/ui'
import { addDays, formatDate, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { analyzeRappi } from '@/lib/parsers/rappi'
import { listRappiOrders, listTransactions } from '@/lib/queries'
import { RappiImportForm } from './RappiImportForm'

export const dynamic = 'force-dynamic'

export default function RappiPage() {
  const today = todayISO()
  const orders = listRappiOrders()
  const cardCharges = listTransactions({ from: addDays(today, -365) }).filter((t) =>
    /rappi/i.test(t.description),
  )

  const a = analyzeRappi(
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
  const chargesTotal = cardCharges.reduce((sum, t) => sum + -t.amount_cents, 0)

  return (
    <div className="space-y-6">
      <div className="card border-brand/40 bg-brand/5">
        <h2 className="text-sm font-semibold">Sobre la conexión con Rappi</h2>
        <p className="mt-1 text-sm text-slate-300">
          Rappi no publica una API abierta ni un export del historial, así que no hay forma legítima de que la app se
          conecte con tu usuario y baje los pedidos sola: haría falta guardar tus credenciales y simular la app, que es
          justo lo que sus términos prohíben. Lo que sí funciona, y da el mismo resultado:
        </p>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-300">
          <li>
            <strong>Los consumos de la tarjeta</strong> se detectan solos: todo lo que diga <code>RAPPI</code> en el
            resumen cae en la categoría delivery. Eso ya te da el total gastado, sin cargar nada.
          </li>
          <li>
            <strong>Los mails de confirmación</strong> traen el detalle (comercio, envío, tarifa de servicio, propina).
            Buscá <code>de:rappi</code> en el mail, copiá los pedidos y pegalos abajo — o armá una regla que los
            reenvíe a una casilla y los pegás todos juntos una vez por mes.
          </li>
          <li>
            <strong>Un CSV</strong> con columnas de fecha y total (más envío, servicio y propina si las tenés) también
            se importa tal cual.
          </li>
        </ol>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pedidos cargados" value={String(a.orders)} hint="Con detalle de items" />
        <Stat label="Total en pedidos" value={formatMoney(a.totalCents)} />
        <Stat label="Ticket promedio" value={formatMoney(a.avgTicketCents)} />
        <Stat
          label="Envío + servicio + propina"
          value={formatMoney(a.overheadCents)}
          hint={`${a.overheadPct}% de lo que gastás`}
          tone={a.overheadPct > 20 ? 'warn' : 'neutral'}
        />
      </div>

      {chargesTotal > 0 && (
        <Panel title="Detectado en tus tarjetas" subtitle="Consumos con “RAPPI” en el detalle, último año">
          <p className="text-sm">
            {cardCharges.length} consumo(s) por <strong className="tabular-nums">{formatMoney(chargesTotal)}</strong>.
            {a.orders > 0 && (
              <>
                {' '}
                Tenés detalle cargado de {a.orders} pedido(s) ({formatMoney(a.totalCents)}); el resto figura solo como
                importe.
              </>
            )}
          </p>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Por mes" subtitle={a.monthlyRunRateCents ? `Ritmo actual: ${formatMoney(a.monthlyRunRateCents)}/mes` : undefined}>
          {a.perMonth.length ? (
            <BarList
              items={a.perMonth.map((m) => ({
                label: m.period,
                value: m.totalCents,
                hint: `${formatMoney(m.totalCents)} · ${m.orders} pedidos`,
              }))}
            />
          ) : (
            <Empty>Sin pedidos cargados.</Empty>
          )}
        </Panel>

        <Panel title="Por día de la semana" subtitle="Dónde está el hábito">
          {a.orders ? (
            <BarList
              items={a.byWeekday.map((d) => ({
                label: d.day,
                value: d.totalCents,
                hint: `${formatMoney(d.totalCents)} · ${d.orders}`,
              }))}
            />
          ) : (
            <Empty>Sin pedidos cargados.</Empty>
          )}
        </Panel>
      </div>

      {a.topStores.length > 0 && (
        <Panel title="Comercios más pedidos">
          <Table
            head={
              <tr>
                <th className="th">Comercio</th>
                <th className="th text-right">Pedidos</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Promedio</th>
              </tr>
            }
          >
            {a.topStores.map((s) => (
              <tr key={s.store}>
                <td className="td">{s.store}</td>
                <td className="td text-right tabular-nums">{s.orders}</td>
                <td className="td text-right tabular-nums">{formatMoney(s.totalCents)}</td>
                <td className="td text-right tabular-nums">{formatMoney(Math.round(s.totalCents / s.orders))}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}

      <Panel title="Importar pedidos">
        <RappiImportForm />
      </Panel>

      {orders.length > 0 && (
        <Panel title="Últimos pedidos">
          <Table
            head={
              <tr>
                <th className="th">Fecha</th>
                <th className="th">Comercio</th>
                <th className="th text-right">Productos</th>
                <th className="th text-right">Envío</th>
                <th className="th text-right">Servicio</th>
                <th className="th text-right">Propina</th>
                <th className="th text-right">Total</th>
              </tr>
            }
          >
            {orders.slice(0, 40).map((o) => (
              <tr key={o.id}>
                <td className="td whitespace-nowrap text-muted">{formatDate(o.date)}</td>
                <td className="td">{o.store}</td>
                <td className="td text-right tabular-nums">{formatMoney(o.products_cents)}</td>
                <td className="td text-right tabular-nums">{formatMoney(o.delivery_cents)}</td>
                <td className="td text-right tabular-nums">{formatMoney(o.service_cents)}</td>
                <td className="td text-right tabular-nums">{formatMoney(o.tip_cents)}</td>
                <td className="td text-right font-medium tabular-nums">{formatMoney(o.total_cents)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </div>
  )
}
