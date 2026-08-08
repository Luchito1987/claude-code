import Link from 'next/link'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { formatDate, formatMonthShort, formatPeriod, todayISO } from '@/lib/dates'
import { formatMoney, pct } from '@/lib/money'
import { debts } from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default function DeudasPage() {
  const today = todayISO()
  const d = debts(today)
  const maxMes = Math.max(...d.porMes.map((m) => m.cents), 1)
  const sinDeuda = d.totalCents === 0

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Deuda total</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(d.totalCents)}</p>
          <p className="mt-1 text-xs text-muted">Tarjetas + préstamos, todo lo que falta pagar</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Sale este mes</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-warn">{formatMoney(d.proximoMesCents)}</p>
          <p className="mt-1 text-xs text-muted">
            {d.ingresoMensualCents
              ? `${d.pesoSobreIngreso}% del ingreso (${formatMoney(d.ingresoMensualCents)})`
              : 'Cargá tus ingresos para ver el peso'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Promedio mensual</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(d.promedioMensualCents)}</p>
          <p className="mt-1 text-xs text-muted">Mientras dure la deuda</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Termina en</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {d.mesesRestantes ? `${d.mesesRestantes} mes${d.mesesRestantes === 1 ? '' : 'es'}` : '—'}
          </p>
          <p className="mt-1 text-xs text-muted">
            {d.ultimoMes ? `Última cuota en ${formatPeriod(d.ultimoMes)}` : 'Sin deudas cargadas'}
          </p>
        </div>
      </div>

      {sinDeuda && (
        <div className="card border-brand/40 bg-brand/5">
          <p className="text-sm text-slate-300">
            No hay deuda cargada. Las de tarjeta aparecen al{' '}
            <Link href="/importar" className="text-brand underline">
              importar un resumen
            </Link>{' '}
            (las cuotas se proyectan solas), y los préstamos se dan de alta en{' '}
            <Link href="/prestamos" className="text-brand underline">
              Préstamos
            </Link>
            .
          </p>
        </div>
      )}

      {d.ingresoMensualCents > 0 && d.proximoMesCents > 0 && (
        <Panel title="Qué parte del sueldo se lleva la deuda" subtitle="Sobre el ingreso mensual cargado">
          <div className="flex h-6 overflow-hidden rounded-lg bg-ink">
            <div
              className={`${d.pesoSobreIngreso > 40 ? 'bg-bad' : d.pesoSobreIngreso > 25 ? 'bg-warn' : 'bg-brand'}`}
              style={{ width: `${Math.min(100, d.pesoSobreIngreso)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>
              Deuda {formatMoney(d.proximoMesCents)} · {d.pesoSobreIngreso}%
            </span>
            <span>
              Queda {formatMoney(Math.max(0, d.ingresoMensualCents - d.proximoMesCents))} para todo lo demás
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-300">
            {d.pesoSobreIngreso > 40
              ? 'Por encima del 40% del ingreso, cualquier imprevisto entra directo a la tarjeta y agranda la deuda del mes siguiente.'
              : d.pesoSobreIngreso > 25
                ? 'Entre el 25% y el 40% el mes se banca, pero queda poco margen para gastos no previstos.'
                : 'Por debajo del 25% la carga de deuda es manejable con este ingreso.'}
          </p>
        </Panel>
      )}

      <Panel title="Por tarjeta" subtitle="Resumen a vencer más las cuotas que ya están comprometidas">
        {d.cards.length ? (
          <Table
            head={
              <tr>
                <th className="th">Tarjeta</th>
                <th className="th text-right">Resumen a vencer</th>
                <th className="th text-right">Cuotas futuras</th>
                <th className="th">Termina</th>
                <th className="th text-right">Total</th>
              </tr>
            }
          >
            {d.cards.map((c) => (
              <tr key={c.cardId}>
                <td className="td font-medium">{c.name}</td>
                <td className="td text-right tabular-nums">
                  {c.resumenCents ? formatMoney(c.resumenCents) : '—'}
                  {c.resumenDue && <span className="ml-2 text-xs text-muted">{formatDate(c.resumenDue)}</span>}
                </td>
                <td className="td text-right tabular-nums">
                  {c.cuotasCents ? formatMoney(c.cuotasCents) : '—'}
                  {c.cuotasCount > 0 && <span className="ml-2 text-xs text-muted">{c.cuotasCount} cuota(s)</span>}
                </td>
                <td className="td text-muted">{c.ultimoMes ? formatMonthShort(c.ultimoMes) : '—'}</td>
                <td className="td text-right font-medium tabular-nums">{formatMoney(c.totalCents)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>Sin tarjetas cargadas.</Empty>
        )}
      </Panel>

      <Panel title="Por préstamo" subtitle="Cuotas que faltan por cada préstamo vigente">
        {d.loans.length ? (
          <Table
            head={
              <tr>
                <th className="th">Préstamo</th>
                <th className="th text-right">Cuota</th>
                <th className="th">Faltan</th>
                <th className="th">Termina</th>
                <th className="th text-right">Saldo</th>
              </tr>
            }
          >
            {d.loans.map((l) => (
              <tr key={l.loanId}>
                <td className="td">
                  <span className="font-medium">{l.name}</span>
                  {l.lender && <span className="ml-2 text-xs text-muted">{l.lender}</span>}
                </td>
                <td className="td text-right tabular-nums">{formatMoney(l.installmentCents)}</td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 rounded-full bg-edge">
                      <div
                        className="h-1.5 rounded-full bg-brand"
                        style={{ width: `${((l.total - l.remaining) / l.total) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted">
                      {l.remaining} de {l.total}
                    </span>
                  </div>
                </td>
                <td className="td text-muted">{l.ultimoMes ? formatMonthShort(l.ultimoMes) : '—'}</td>
                <td className="td text-right font-medium tabular-nums">{formatMoney(l.totalCents)}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>Sin préstamos vigentes.</Empty>
        )}
      </Panel>

      {d.porMes.length > 0 && (
        <Panel title="Cómo se descarga la deuda" subtitle="Cuánto sale de deuda cada mes hasta terminarla">
          <ul className="space-y-2">
            {d.porMes.map((m) => (
              <li key={m.period}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>{formatMonthShort(m.period)}</span>
                  <span className="tabular-nums text-muted">
                    {formatMoney(m.cents)}
                    {d.ingresoMensualCents > 0 && (
                      <span className="ml-2">{pct(m.cents, d.ingresoMensualCents)}% del ingreso</span>
                    )}
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-edge">
                  <div
                    className={`h-1.5 rounded-full ${
                      d.ingresoMensualCents && m.cents / d.ingresoMensualCents > 0.4 ? 'bg-bad' : 'bg-brand'
                    }`}
                    style={{ width: `${Math.max(2, (m.cents / maxMes) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Los meses que siguen bajan a medida que se terminan las cuotas. Si aparece un mes más alto que el actual es
            porque hay cuotas que arrancan más adelante.
          </p>
        </Panel>
      )}
    </div>
  )
}
