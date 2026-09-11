import { Badge, Empty, Panel, Table } from '@/components/ui'
import { formatDate, todayISO } from '@/lib/dates'
import { formatMoney, pct } from '@/lib/money'
import { listLoans, loanProgress, monthlyIncomeCents } from '@/lib/queries'
import {
  deleteLoanAction,
  payInstallmentAction,
  saveLoanAction,
  saveMatchPatternAction,
} from '@/app/actions/data'

export const dynamic = 'force-dynamic'

export default function PrestamosPage() {
  const loans = listLoans()
  const income = monthlyIncomeCents()
  const monthly = loans
    .filter((l) => l.active && l.installments_paid < l.installments_total)
    .reduce((a, l) => a + l.installment_cents, 0)
  const outstanding = loans.reduce((a, l) => a + loanProgress(l).outstandingCents, 0)

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Cuotas por mes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(monthly)}</p>
          {income > 0 && (
            <p className="mt-1 text-xs text-muted">{pct(monthly, income)}% del ingreso mensual</p>
          )}
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Cuotas pendientes (capital + interés)</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(outstanding)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Préstamos vigentes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">
            {loans.filter((l) => l.active && l.installments_paid < l.installments_total).length}
          </p>
        </div>
      </div>

      <Panel title="Préstamos vigentes" subtitle="Las cuotas pendientes entran automáticamente en la proyección de caja">
        {loans.length ? (
          <Table
            head={
              <tr>
                <th className="th">Préstamo</th>
                <th className="th text-right">Cuota</th>
                <th className="th">Avance</th>
                <th className="th">Próxima</th>
                <th className="th text-right">Pendiente</th>
                <th className="th">Cómo aparece en el extracto</th>
                <th className="th" />
              </tr>
            }
          >
            {loans.map((l) => {
              const p = loanProgress(l)
              return (
                <tr key={l.id}>
                  <td className="td">
                    <span className="font-medium">{l.name}</span>
                    {l.lender && <span className="ml-2 text-xs text-muted">{l.lender}</span>}
                    {p.remaining === 0 && (
                      <span className="ml-2">
                        <Badge tone="good">terminado</Badge>
                      </span>
                    )}
                  </td>
                  <td className="td text-right tabular-nums">{formatMoney(l.installment_cents)}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 rounded-full bg-edge">
                        <div className="h-1.5 rounded-full bg-brand" style={{ width: `${p.progress * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted">
                        {l.installments_paid}/{l.installments_total}
                      </span>
                    </div>
                  </td>
                  <td className="td text-muted">{p.nextDue ? formatDate(p.nextDue) : '—'}</td>
                  <td className="td text-right tabular-nums">{formatMoney(p.outstandingCents)}</td>
                  <td className="td">
                    <form action={saveMatchPatternAction} className="flex gap-1">
                      <input type="hidden" name="kind" value="prestamo" />
                      <input type="hidden" name="id" value={l.id} />
                      <input
                        name="match_pattern"
                        className="input py-1 text-xs"
                        defaultValue={l.match_pattern}
                        placeholder="PAGO CREDITO SUC VIRTUAL"
                        aria-label={`Cómo aparece la cuota de ${l.name} en el extracto`}
                      />
                      <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                        Guardar
                      </button>
                    </form>
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-2">
                      {p.remaining > 0 && (
                        <form action={payInstallmentAction}>
                          <input type="hidden" name="id" value={l.id} />
                          <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                            Pagué una cuota
                          </button>
                        </form>
                      )}
                      <form action={deleteLoanAction}>
                        <input type="hidden" name="id" value={l.id} />
                        <button type="submit" className="btn-danger px-2 py-1 text-xs">
                          Borrar
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              )
            })}
          </Table>
        ) : (
          <Empty>Sin préstamos cargados.</Empty>
        )}
      </Panel>

      <Panel title="Dar de alta un préstamo">
        <form action={saveLoanAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="label" htmlFor="ln-name">
              Nombre
            </label>
            <input id="ln-name" name="name" className="input" placeholder="Préstamo personal" required />
          </div>
          <div>
            <label className="label" htmlFor="ln-lender">
              Entidad
            </label>
            <input id="ln-lender" name="lender" className="input" placeholder="Banco Nación" />
          </div>
          <div>
            <label className="label" htmlFor="ln-principal">
              Capital
            </label>
            <input id="ln-principal" name="principal" className="input" inputMode="decimal" />
          </div>
          <div>
            <label className="label" htmlFor="ln-installment">
              Valor de la cuota
            </label>
            <input id="ln-installment" name="installment" className="input" inputMode="decimal" required />
          </div>
          <div>
            <label className="label" htmlFor="ln-total">
              Cuotas totales
            </label>
            <input id="ln-total" name="installments_total" type="number" min={1} defaultValue={12} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="ln-paid">
              Cuotas pagadas
            </label>
            <input id="ln-paid" name="installments_paid" type="number" min={0} defaultValue={0} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="ln-first">
              Vencimiento de la 1ª cuota
            </label>
            <input id="ln-first" name="first_due_date" type="date" defaultValue={todayISO()} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="ln-rate">
              TNA (%)
            </label>
            <input id="ln-rate" name="rate_annual" type="number" step="0.01" defaultValue={0} className="input" />
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked className="accent-brand" />
              Vigente
            </label>
            <button type="submit" className="btn-primary">
              Agregar
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs text-muted">
          Las cuotas se proyectan mes a mes desde el vencimiento de la primera. Marcar “pagué una cuota” corre la
          próxima al mes siguiente.
        </p>
      </Panel>
    </div>
  )
}
