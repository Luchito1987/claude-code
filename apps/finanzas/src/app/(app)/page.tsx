import Link from 'next/link'
import { Badge, BarList, Empty, Money, Panel, Stat, Table } from '@/components/ui'
import { CATEGORY_LABELS } from '@/lib/categories'
import { addDays, compare, formatDate, formatPeriod, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import {
  billingWindowView,
  buildProjection,
  currentBurnCents,
  listLoans,
  listServices,
  listTransactions,
  minBufferCents,
  monthlyIncomeCents,
  spendByCategory,
  totalCashCents,
  upcomingDues,
  listBills,
  listRappiOrders,
} from '@/lib/queries'
import { buildRecommendations } from '@/lib/recommendations'
import { analyzeRappi } from '@/lib/parsers/rappi'
import { WeeklyChart } from '@/components/WeeklyChart'

export const dynamic = 'force-dynamic'

export default function Dashboard() {
  const today = todayISO()
  const cash = totalCashCents()
  const buffer = minBufferCents()
  const projection = buildProjection(today)
  const win = billingWindowView(today)
  const dues = upcomingDues(30, today)
  const categories = spendByCategory(addDays(today, -30), today)
  const spend30 = categories.reduce((a, c) => a + c.cents, 0)
  const orders = listRappiOrders()

  const recos = buildRecommendations({
    today,
    projection,
    transactions: listTransactions({ from: addDays(today, -120) }),
    bills: listBills(),
    services: listServices(),
    loans: listLoans(),
    monthlyIncomeCents: monthlyIncomeCents(),
    minBufferCents: buffer,
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
    windowOpen: win.window.open,
    windowPeriod: win.window.period,
  })

  const empty = cash === 0 && !dues.length && !spend30

  return (
    <div className="space-y-6">
      {empty && (
        <div className="card border-brand/40 bg-brand/5">
          <h2 className="text-sm font-semibold">Todavía no hay datos</h2>
          <p className="mt-1 text-sm text-muted">
            Para que la proyección tenga sentido hacen falta tres cosas:{' '}
            <Link href="/config" className="text-brand underline">
              cargar las cuentas y el ingreso
            </Link>
            ,{' '}
            <Link href="/facturas" className="text-brand underline">
              dar de alta los servicios
            </Link>{' '}
            e{' '}
            <Link href="/importar" className="text-brand underline">
              importar un extracto
            </Link>
            .
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Efectivo disponible"
          value={formatMoney(cash)}
          hint={`Colchón objetivo ${formatMoney(buffer)}`}
          tone={cash < buffer ? 'warn' : 'good'}
        />
        <Stat
          label={`Piso proyectado (${projection.weeks.length} sem.)`}
          value={formatMoney(projection.lowestCents)}
          hint={`El ${formatDate(projection.lowestDate)}`}
          tone={projection.negativeDate ? 'bad' : projection.breachDate ? 'warn' : 'good'}
        />
        <Stat
          label="Compromisos del horizonte"
          value={formatMoney(projection.committedCents)}
          hint={`+ ${formatMoney(projection.projectedVariableCents)} de gasto variable`}
        />
        <Stat
          label="Consumo variable diario"
          value={formatMoney(currentBurnCents(today))}
          hint="Promedio de los últimos 90 días"
        />
      </div>

      <Panel
        title="Recomendaciones de la semana"
        subtitle="Reglas sobre tus propios datos, ordenadas por urgencia"
        action={
          <Link href="/reportes" className="text-xs text-brand hover:underline">
            Exportar informe →
          </Link>
        }
      >
        {recos.length ? (
          <ul className="space-y-3">
            {recos.slice(0, 6).map((r) => (
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
        ) : (
          <Empty>Sin alertas: cargá datos o volvé cuando haya movimientos.</Empty>
        )}
      </Panel>

      <Panel
        title="Proyección semanal"
        subtitle={`De hoy al ${projection.horizonEnd}. La línea punteada es el colchón mínimo.`}
      >
        <WeeklyChart
          weeks={projection.weeks.map((w) => ({
            start: w.start,
            label: formatDate(w.start),
            closing: w.closingCents,
            inflow: w.inflowCents,
            outflow: w.outflowCents,
          }))}
          buffer={buffer}
        />
        <Table
          head={
            <tr>
              <th className="th">Semana</th>
              <th className="th text-right">Entra</th>
              <th className="th text-right">Sale</th>
              <th className="th text-right">Cierre</th>
            </tr>
          }
        >
          {projection.weeks.map((w) => (
            <tr key={w.start}>
              <td className="td">
                {formatDate(w.start)} – {formatDate(w.end)}
              </td>
              <td className="td text-right text-good">{formatMoney(w.inflowCents)}</td>
              <td className="td text-right text-bad">{formatMoney(w.outflowCents)}</td>
              <td className={`td text-right font-medium ${w.closingCents < 0 ? 'text-bad' : w.closingCents < buffer ? 'text-warn' : ''}`}>
                {formatMoney(w.closingCents)}
              </td>
            </tr>
          ))}
        </Table>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={`Facturas de ${formatPeriod(win.window.period)}`}
          subtitle={`Ventana ${win.window.start} → ${win.window.end}${win.window.open ? ' · abierta' : ''}`}
          action={
            <Link href="/facturas" className="text-xs text-brand hover:underline">
              Ver todas →
            </Link>
          }
        >
          {win.bills.length ? (
            <>
              <ul className="space-y-1.5">
                {win.bills.slice(0, 8).map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{b.name}</span>
                    {b.estimated === 1 && <Badge tone="neutral">est.</Badge>}
                    {b.status === 'pagado' ? (
                      <Badge tone="good">pagado</Badge>
                    ) : compare(b.due_date, today) < 0 ? (
                      <Badge tone="bad">vencida</Badge>
                    ) : (
                      <span className="text-xs text-muted">{formatDate(b.due_date)}</span>
                    )}
                    <span className="w-24 text-right tabular-nums">{formatMoney(b.amount_cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-edge pt-2 text-sm">
                Pendiente del período: <strong className="tabular-nums">{formatMoney(win.pendingCents)}</strong>
              </p>
            </>
          ) : (
            <Empty>
              Sin servicios cargados.{' '}
              <Link href="/facturas" className="text-brand underline">
                Dar de alta
              </Link>
            </Empty>
          )}
        </Panel>

        <Panel title="Próximos 30 días" subtitle="Facturas, resúmenes de tarjeta y cuotas">
          {dues.length ? (
            <ul className="space-y-1.5">
              {dues.slice(0, 10).map((d, i) => (
                <li key={`${d.date}-${i}`} className="flex items-center gap-2 text-sm">
                  <span className="w-14 shrink-0 text-xs text-muted">{formatDate(d.date)}</span>
                  <span className="flex-1 truncate">{d.label}</span>
                  {compare(d.date, today) < 0 ? (
                    <Badge tone="bad">vencido</Badge>
                  ) : (
                    <Badge tone={d.kind === 'tarjeta' ? 'info' : d.kind === 'prestamo' ? 'warn' : 'neutral'}>
                      {d.kind}
                    </Badge>
                  )}
                  <span className="w-24 text-right tabular-nums">{formatMoney(d.cents)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nada por vencer en los próximos 30 días.</Empty>
          )}
        </Panel>
      </div>

      <Panel title="En qué se fue la plata" subtitle="Últimos 30 días">
        {categories.length ? (
          <BarList
            items={categories.slice(0, 8).map((c) => ({
              label: CATEGORY_LABELS[c.category] ?? c.category,
              value: c.cents,
              hint: `${formatMoney(c.cents)} · ${Math.round((c.cents / spend30) * 100)}%`,
            }))}
          />
        ) : (
          <Empty>
            Sin movimientos.{' '}
            <Link href="/importar" className="text-brand underline">
              Importar un extracto
            </Link>
          </Empty>
        )}
      </Panel>
    </div>
  )
}
