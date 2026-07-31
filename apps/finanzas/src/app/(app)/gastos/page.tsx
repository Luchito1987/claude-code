import { Badge, BarList, Empty, Panel, Table } from '@/components/ui'
import { CATEGORIES, CATEGORY_LABELS } from '@/lib/categories'
import { addDays, formatDate, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import { listAccounts, listCards, listTransactions, spendByCategory } from '@/lib/queries'
import { deleteTransactionAction, recategorizeAction, saveTransactionAction } from '@/app/actions/data'

export const dynamic = 'force-dynamic'

export default function GastosPage({ searchParams }: { searchParams: { cat?: string; dias?: string } }) {
  const today = todayISO()
  const days = Number(searchParams.dias ?? '30') || 30
  const from = addDays(today, -days)
  const category = searchParams.cat
  const txs = listTransactions({ from, to: today, category, limit: 300 })
  const categories = spendByCategory(from, today)
  const totalSpend = categories.reduce((a, c) => a + c.cents, 0)
  const accounts = listAccounts()
  const cards = listCards()

  return (
    <div className="space-y-6">
      <Panel
        title="Cargar un gasto"
        subtitle="Tickets de compra, gastos en efectivo, cualquier cosa que no venga en un extracto"
      >
        <form action={saveTransactionAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="tx-date">
              Fecha
            </label>
            <input id="tx-date" name="date" type="date" defaultValue={today} className="input" />
          </div>
          <div className="lg:col-span-2">
            <label className="label" htmlFor="tx-desc">
              Detalle
            </label>
            <input id="tx-desc" name="description" className="input" placeholder="Verdulería del barrio" required />
          </div>
          <div>
            <label className="label" htmlFor="tx-amount">
              Importe
            </label>
            <input id="tx-amount" name="amount" className="input" inputMode="decimal" placeholder="12.500,00" required />
          </div>
          <div>
            <label className="label" htmlFor="tx-cat">
              Categoría
            </label>
            <select id="tx-cat" name="category" className="input" defaultValue="">
              <option value="">Automática</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tx-method">
              Medio
            </label>
            <select id="tx-method" name="method" className="input" defaultValue="efectivo">
              <option value="efectivo">Efectivo</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="transferencia">Transferencia</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tx-account">
              Cuenta
            </label>
            <select id="tx-account" name="account_id" className="input" defaultValue="">
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tx-card">
              Tarjeta
            </label>
            <select id="tx-card" name="card_id" className="input" defaultValue="">
              <option value="">—</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="tx-dir">
              Tipo
            </label>
            <select id="tx-dir" name="direction" className="input" defaultValue="gasto">
              <option value="gasto">Gasto</option>
              <option value="ingreso">Ingreso</option>
            </select>
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full">
              Agregar
            </button>
          </div>
        </form>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={`Por categoría · ${days} días`} className="lg:col-span-1">
          {categories.length ? (
            <BarList
              items={categories.map((c) => ({
                label: CATEGORY_LABELS[c.category] ?? c.category,
                value: c.cents,
                hint: `${formatMoney(c.cents)} · ${Math.round((c.cents / totalSpend) * 100)}%`,
              }))}
            />
          ) : (
            <Empty>Sin gastos en el período.</Empty>
          )}
        </Panel>

        <Panel
          title="Movimientos"
          subtitle={category ? `Filtrado por ${CATEGORY_LABELS[category] ?? category}` : `Últimos ${days} días`}
          className="lg:col-span-2"
        >
          {txs.length ? (
            <Table
              head={
                <tr>
                  <th className="th">Fecha</th>
                  <th className="th">Detalle</th>
                  <th className="th">Categoría</th>
                  <th className="th text-right">Importe</th>
                  <th className="th" />
                </tr>
              }
            >
              {txs.map((t) => (
                <tr key={t.id}>
                  <td className="td whitespace-nowrap text-muted">{formatDate(t.date)}</td>
                  <td className="td">
                    <span className="line-clamp-1">{t.merchant || t.description}</span>
                    <span className="text-xs text-muted">
                      {t.method}
                      {t.installment ? ` · cuota ${t.installment}` : ''}
                      {t.source === 'import' ? ' · importado' : ''}
                    </span>
                  </td>
                  <td className="td">
                    <form action={recategorizeAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={t.id} />
                      <select
                        name="category"
                        defaultValue={t.category}
                        className="input py-1 text-xs"
                        aria-label="Categoría"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-[10px] text-muted" title="Aplicar a todos los movimientos de este comercio">
                        <input type="checkbox" name="remember" className="accent-brand" />
                        regla
                      </label>
                      <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                        ok
                      </button>
                    </form>
                  </td>
                  <td className={`td text-right tabular-nums ${t.amount_cents < 0 ? '' : 'text-good'}`}>
                    {formatMoney(t.amount_cents)}
                  </td>
                  <td className="td text-right">
                    <form action={deleteTransactionAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="btn-danger px-2 py-1 text-xs">
                        ×
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <Empty>Sin movimientos en el período.</Empty>
          )}
        </Panel>
      </div>
    </div>
  )
}
