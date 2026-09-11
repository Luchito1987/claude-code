import { Empty, Panel, Table } from '@/components/ui'
import { getDb } from '@/db/client'
import { currentUser } from '@/lib/auth'
import { formatMoney } from '@/lib/money'
import { horizonWeeks, listAccounts, listCards, listIncomes, listUserRules, minBufferCents } from '@/lib/queries'
import {
  deleteAccountAction,
  deleteCardAction,
  deleteIncomeAction,
  deleteRuleAction,
  saveAccountAction,
  saveCardAction,
  saveIncomeAction,
  saveMatchPatternAction,
  saveSettingsAction,
} from '@/app/actions/data'
import { deleteUserAction } from '@/app/actions/auth'
import { UserForm } from './UserForm'

export const dynamic = 'force-dynamic'

export default function ConfigPage() {
  const me = currentUser()
  const accounts = listAccounts()
  const cards = listCards()
  const incomes = listIncomes()
  const rules = getDb().prepare('SELECT id, pattern, category FROM category_rules ORDER BY pattern').all() as Array<{
    id: string
    pattern: string
    category: string
  }>
  const users = getDb().prepare('SELECT id, name, email FROM users ORDER BY name').all() as Array<{
    id: string
    name: string
    email: string
  }>

  return (
    <div className="space-y-6">
      <Panel title="Parámetros de la proyección">
        <form action={saveSettingsAction} className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="cfg-buffer">
              Colchón mínimo
            </label>
            <input
              id="cfg-buffer"
              name="min_buffer"
              className="input"
              inputMode="decimal"
              defaultValue={(minBufferCents() / 100).toFixed(2)}
            />
            <p className="mt-1 text-xs text-muted">Piso que no querés perforar. Dispara las alertas.</p>
          </div>
          <div>
            <label className="label" htmlFor="cfg-horizon">
              Semanas a proyectar
            </label>
            <input
              id="cfg-horizon"
              name="horizon_weeks"
              type="number"
              min={2}
              max={26}
              className="input"
              defaultValue={horizonWeeks()}
            />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary">
              Guardar
            </button>
          </div>
        </form>
      </Panel>

      <Panel title="Cuentas" subtitle="El saldo de estas cuentas es el punto de partida de la proyección">
        <form action={saveAccountAction} className="grid gap-3 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="acc-name">
              Nombre
            </label>
            <input id="acc-name" name="name" className="input" placeholder="Caja de ahorro Galicia" required />
          </div>
          <div>
            <label className="label" htmlFor="acc-kind">
              Tipo
            </label>
            <select id="acc-kind" name="kind" className="input" defaultValue="caja_ahorro">
              <option value="caja_ahorro">Caja de ahorro</option>
              <option value="cuenta_corriente">Cuenta corriente</option>
              <option value="billetera">Billetera virtual</option>
              <option value="efectivo">Efectivo</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="acc-balance">
              Saldo actual
            </label>
            <input id="acc-balance" name="balance" className="input" inputMode="decimal" defaultValue="0" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full">
              Agregar
            </button>
          </div>
        </form>

        {accounts.length ? (
          <div className="mt-4 space-y-2">
            {accounts.map((a) => (
              <form key={a.id} action={saveAccountAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={a.id} />
                <input type="hidden" name="kind" value={a.kind} />
                <div className="flex-1 min-w-[10rem]">
                  <label className="label" htmlFor={`acc-n-${a.id}`}>
                    {a.kind.replace('_', ' ')}
                  </label>
                  <input id={`acc-n-${a.id}`} name="name" defaultValue={a.name} className="input" />
                </div>
                <div className="w-40">
                  <label className="label" htmlFor={`acc-b-${a.id}`}>
                    Saldo
                  </label>
                  <input
                    id={`acc-b-${a.id}`}
                    name="balance"
                    defaultValue={(a.balance_cents / 100).toFixed(2)}
                    className="input text-right"
                    inputMode="decimal"
                  />
                </div>
                <button type="submit" className="btn-ghost">
                  Actualizar
                </button>
                <button type="submit" formAction={deleteAccountAction} className="btn-danger">
                  Borrar
                </button>
              </form>
            ))}
            <p className="pt-2 text-sm">
              Total disponible:{' '}
              <strong className="tabular-nums">
                {formatMoney(accounts.reduce((s, a) => s + a.balance_cents, 0))}
              </strong>
            </p>
          </div>
        ) : (
          <Empty>Sin cuentas cargadas.</Empty>
        )}
      </Panel>

      <Panel
        title="Tarjetas de crédito"
        subtitle="El día de cierre y el de vencimiento definen en qué semana impacta cada resumen. El patrón del extracto hace que el resumen se marque pagado solo al importar la cuenta"
      >
        <form action={saveCardAction} className="grid gap-3 sm:grid-cols-5">
          <div>
            <label className="label" htmlFor="cd-name">
              Nombre
            </label>
            <input id="cd-name" name="name" className="input" placeholder="Visa Galicia" required />
          </div>
          <div>
            <label className="label" htmlFor="cd-issuer">
              Banco
            </label>
            <input id="cd-issuer" name="issuer" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="cd-close">
              Cierra el día
            </label>
            <input id="cd-close" name="closing_day" type="number" min={1} max={28} defaultValue={25} className="input" />
          </div>
          <div>
            <label className="label" htmlFor="cd-due">
              Vence el día
            </label>
            <input id="cd-due" name="due_day" type="number" min={1} max={28} defaultValue={5} className="input" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primary w-full">
              Agregar
            </button>
          </div>
        </form>

        {cards.length ? (
          <div className="mt-4">
            <Table
              head={
                <tr>
                  <th className="th">Tarjeta</th>
                  <th className="th">Banco</th>
                  <th className="th">Cierre</th>
                  <th className="th">Vencimiento</th>
                  <th className="th">Cómo aparece el pago en el extracto</th>
                  <th className="th" />
                </tr>
              }
            >
              {cards.map((c) => (
                <tr key={c.id}>
                  <td className="td">{c.name}</td>
                  <td className="td text-muted">{c.issuer || '—'}</td>
                  <td className="td text-muted">día {c.closing_day}</td>
                  <td className="td text-muted">día {c.due_day}</td>
                  <td className="td">
                    <form action={saveMatchPatternAction} className="flex gap-1">
                      <input type="hidden" name="kind" value="tarjeta" />
                      <input type="hidden" name="id" value={c.id} />
                      <input
                        name="match_pattern"
                        className="input py-1 text-xs"
                        defaultValue={c.match_pattern}
                        placeholder="PAGO SUC VIRT TC VISA"
                        aria-label={`Cómo aparece el pago de ${c.name} en el extracto`}
                      />
                      <button type="submit" className="btn-ghost px-2 py-1 text-xs">
                        Guardar
                      </button>
                    </form>
                  </td>
                  <td className="td text-right">
                    <form action={deleteCardAction}>
                      <input type="hidden" name="id" value={c.id} />
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
          <Empty>Sin tarjetas cargadas.</Empty>
        )}
      </Panel>

      <Panel title="Ingresos" subtitle="Sueldos y entradas fijas: definen cuándo entra la plata en la proyección">
        <form action={saveIncomeAction} className="grid gap-3 sm:grid-cols-5">
          <div>
            <label className="label" htmlFor="in-name">
              Concepto
            </label>
            <input id="in-name" name="name" className="input" placeholder="Sueldo" required />
          </div>
          <div>
            <label className="label" htmlFor="in-owner">
              De quién
            </label>
            <input id="in-owner" name="owner" className="input" placeholder="Luciano" />
          </div>
          <div>
            <label className="label" htmlFor="in-amount">
              Importe
            </label>
            <input id="in-amount" name="amount" className="input" inputMode="decimal" required />
          </div>
          <div>
            <label className="label" htmlFor="in-day">
              Día del mes
            </label>
            <input id="in-day" name="day_of_month" type="number" min={1} max={31} defaultValue={1} className="input" />
          </div>
          <div className="flex items-end gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked className="accent-brand" />
              Activo
            </label>
            <button type="submit" className="btn-primary">
              Agregar
            </button>
          </div>
        </form>

        {incomes.length ? (
          <div className="mt-4">
            <Table
              head={
                <tr>
                  <th className="th">Concepto</th>
                  <th className="th">De quién</th>
                  <th className="th">Día</th>
                  <th className="th text-right">Importe</th>
                  <th className="th" />
                </tr>
              }
            >
              {incomes.map((i) => (
                <tr key={i.id}>
                  <td className="td">{i.name}</td>
                  <td className="td text-muted">{i.owner || '—'}</td>
                  <td className="td text-muted">{i.day_of_month}</td>
                  <td className="td text-right tabular-nums">{formatMoney(i.amount_cents)}</td>
                  <td className="td text-right">
                    <form action={deleteIncomeAction}>
                      <input type="hidden" name="id" value={i.id} />
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
          <Empty>Sin ingresos cargados.</Empty>
        )}
      </Panel>

      <Panel
        title="Usuarios"
        subtitle="No hay registro abierto: los usuarios solo se crean desde acá, con una sesión iniciada"
      >
        <UserForm />
        <div className="mt-4 space-y-2">
          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{u.name}</span>
              <span className="text-muted">{u.email}</span>
              {u.id === me?.id ? (
                <span className="ml-auto text-xs text-muted">vos</span>
              ) : (
                <form action={deleteUserAction} className="ml-auto">
                  <input type="hidden" name="userId" value={u.id} />
                  <button type="submit" className="btn-danger px-2 py-1 text-xs">
                    Quitar
                  </button>
                </form>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {rules.length > 0 && (
        <Panel title="Reglas de categorización" subtitle="Se crean al corregir la categoría de un movimiento marcando “regla”">
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center gap-3 text-sm">
                <code className="rounded bg-ink px-1.5 py-0.5 text-xs">{r.pattern}</code>
                <span className="text-muted">→ {r.category}</span>
                <form action={deleteRuleAction} className="ml-auto">
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="btn-danger px-2 py-1 text-xs">
                    Quitar
                  </button>
                </form>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}
