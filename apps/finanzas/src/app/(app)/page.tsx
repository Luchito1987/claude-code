import Link from 'next/link'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { CATEGORY_LABELS, MANUAL_EXPENSE_CATEGORIES } from '@/lib/categories'
import { compare, formatDate, formatPeriod, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import {
  listAccounts,
  listCards,
  monthSummary,
  MONTH_GROUP_LABELS,
  MONTH_GROUP_ORDER,
  type MonthGroup,
  type MonthItem,
  type Remesa,
} from '@/lib/queries'
import {
  saveTransactionAction,
  toggleBillPaidAction,
  toggleMonthItemPaidAction,
  updateBillAction,
} from '@/app/actions/data'
import { FilaColapsable, PanelColapsable } from './Colapsable'
import { monedaActual } from '@/lib/vista'

export const dynamic = 'force-dynamic'

export default function Tablero() {
  const today = todayISO()
  const moneda = monedaActual()
  const mes = monthSummary(today, moneda)
  const cuentas = listAccounts()
  const pendientes = mes.items.filter((i) => !i.paid)
  const pagados = mes.items.filter((i) => i.paid)

  // Los cuatro bloques de compromisos; el gasto variable va aparte porque ya
  // está pagado y no tiene vencimiento ni estado.
  const bloques = MONTH_GROUP_ORDER.filter((g) => g !== 'variable')
    .map((group) => ({ group, items: mes.items.filter((i) => i.group === group) }))
    .filter((b) => b.items.length > 0)

  return (
    <div className="space-y-6">
      {/* Los tres números que se miran primero. */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Dinero disponible</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(mes.availableCents, moneda)}</p>
          <p className="mt-1 text-xs text-muted">
            {cuentas.length ? cuentas.map((c) => c.name).join(' · ') : 'Sin cuentas cargadas'}
          </p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wide text-muted">Falta pagar en {formatPeriod(mes.period)}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-warn">{formatMoney(mes.pendingCents, moneda)}</p>
          <p className="mt-1 text-xs text-muted">
            {pendientes.length} pendiente(s)
            {pagados.length ? ` · ${formatMoney(mes.paidCents, moneda)} ya pagado` : ''}
          </p>
        </div>
        <div className={`card ${mes.netCents < 0 ? 'border-bad/50' : 'border-good/40'}`}>
          <p className="text-xs uppercase tracking-wide text-muted">Neto después de pagar</p>
          <p className={`mt-1 text-3xl font-semibold tabular-nums ${mes.netCents < 0 ? 'text-bad' : 'text-good'}`}>
            {formatMoney(mes.netCents, moneda)}
          </p>
          <p className="mt-1 text-xs text-muted">
            {mes.netCents < 0
              ? `Faltan ${formatMoney(-mes.netCents, moneda)} para cubrir el mes`
              : 'Queda disponible después de los compromisos'}
          </p>
        </div>
      </section>

      {mes.remesa ? <BloqueRemesa remesa={mes.remesa} /> : null}

      <Panel
        title={`Pagos de ${formatPeriod(mes.period)}`}
        subtitle={`El mes va del ${mes.start} al ${mes.end}. El 28 cierra y se arma la lista del mes siguiente.`}
        action={
          <Link href="/proyeccion" className="text-xs text-brand hover:underline">
            Ver 6 meses →
          </Link>
        }
      >
        {bloques.length ? (
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
            {bloques.map(({ group, items }) => (
              <BloqueDelMes key={group} group={group} items={items} period={mes.period} today={today} />
            ))}
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

      <GastosVariables items={mes.variable} total={mes.variableCents} period={mes.period} />

      <div className="grid gap-4 lg:grid-cols-2">
        <MovimientoRapido tipo="gasto" cuentas={cuentas} />
        <MovimientoRapido tipo="ingreso" cuentas={cuentas} />
      </div>
    </div>
  )
}

/** Un bloque del mes: título con subtotal y sus filas. */
function BloqueDelMes({
  group,
  items,
  period,
  today,
}: {
  group: MonthGroup
  items: MonthItem[]
  period: string
  today: string
}) {
  const moneda = monedaActual()
  const total = items.reduce((a, i) => a + i.cents, 0)
  const falta = items.filter((i) => !i.paid).reduce((a, i) => a + i.cents, 0)

  return (
    <FilaColapsable
      titulo={MONTH_GROUP_LABELS[group]}
      total={formatMoney(total, moneda)}
      estado={falta > 0 ? `falta ${formatMoney(falta, moneda)}` : 'todo pagado'}
    >
      {items.map((item) => {
        const vencido = !item.paid && compare(item.dueDate, today) < 0
        return (
          <tr key={`${item.kind}-${item.refId}`} className={item.paid ? 'opacity-55' : ''}>
            <td className="td">
              <span className="font-medium">{item.label}</span>
              <span className="ml-2 text-xs text-muted">{item.detail}</span>
            </td>
            <td className="td whitespace-nowrap text-muted">{formatDate(item.dueDate)}</td>
            <td className="td text-right">
              {item.editable ? <ImporteEditable item={item} /> : <span className="tabular-nums">{formatMoney(item.cents, moneda)}</span>}
            </td>
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
                  <input type="hidden" name="period" value={period} />
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
    </FilaColapsable>
  )
}

/**
 * El importe se edita en el lugar. Cerrado muestra el número; abierto, el campo.
 * Es un `<details>` para que ande sin JavaScript, igual que el resto de la app.
 */
function ImporteEditable({ item }: { item: MonthItem }) {
  const moneda = monedaActual()
  return (
    <details className="text-right">
      <summary className="cursor-pointer list-none tabular-nums hover:text-brand">
        {formatMoney(item.cents, moneda)}
        <span className="ml-1 text-xs text-muted">✎</span>
      </summary>
      <form action={updateBillAction} className="mt-2 flex items-center justify-end gap-1.5">
        <input type="hidden" name="id" value={item.refId} />
        <input
          name="amount"
          className="input w-28 px-2 py-1 text-right text-xs"
          inputMode="decimal"
          defaultValue={(item.cents / 100).toFixed(2)}
          aria-label={`Importe de ${item.label}`}
        />
        <button type="submit" className="btn-primary px-2 py-1 text-xs">
          Guardar
        </button>
      </form>
    </details>
  )
}

/** Lo que ya se gastó en el mes fuera de los compromisos. */
function GastosVariables({
  items,
  total,
  period,
}: {
  items: Array<{ category: string; cents: number }>
  total: number
  period: string
}) {
  const moneda = monedaActual()
  const max = Math.max(...items.map((i) => i.cents), 1)

  return (
    <Panel
      title={MONTH_GROUP_LABELS.variable}
      subtitle={`Lo que ya salió en ${formatPeriod(period)} por fuera de los compromisos. No incluye lo pagado con tarjeta: eso viaja dentro del resumen.`}
      action={
        <Link href="/gastos" className="text-xs text-brand hover:underline">
          Ver movimientos →
        </Link>
      }
    >
      {items.length ? (
        <PanelColapsable titulo="Por rubro" resumen={formatMoney(total, moneda)}>
          <ul className="space-y-2">
            {items.map((i) => (
              <li key={i.category}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{CATEGORY_LABELS[i.category] ?? i.category}</span>
                  <span className="tabular-nums text-muted">{formatMoney(i.cents, moneda)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-edge">
                  <div
                    className="h-1.5 rounded-full bg-brand"
                    style={{ width: `${Math.max(2, (i.cents / max) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </PanelColapsable>
      ) : (
        <Empty>Todavía no hay gastos sueltos cargados este mes.</Empty>
      )}
    </Panel>
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
            <label className="label" htmlFor={`${tipo}-recurrencia`}>
              ¿Se repite?
            </label>
            <select id={`${tipo}-recurrencia`} name="recurrencia" className="input" defaultValue="">
              <option value="">Variable · solo esta vez</option>
              <option value="fijo">Fijo · todos los meses</option>
            </select>
            <p className="mt-1 text-xs text-muted">
              Un gasto fijo queda dado de alta como compromiso y vuelve solo cada mes. No mueve el saldo ni usa
              tarjeta: se paga desde la lista de arriba.
            </p>
          </div>
        )}
        {esGasto && (
          <div>
            <label className="label" htmlFor={`${tipo}-cat`}>
              Categoría
            </label>
            <select id={`${tipo}-cat`} name="category" className="input" defaultValue="">
              <option value="">Automática</option>
              {MANUAL_EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">
              Un servicio va por{' '}
              <Link href="/facturas" className="text-brand underline">
                Facturas
              </Link>{' '}
              y un consumo con tarjeta entra al{' '}
              <Link href="/importar" className="text-brand underline">
                importar el resumen
              </Link>
              .
            </p>
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


/**
 * Lo que sobra del sueldo argentino después de pagar lo de Argentina.
 *
 * Va desglosado y no como un ingreso más de la lista: es plata que todavía no
 * cruzó, que depende de que allá entre el sueldo y de a cuánto se consiga
 * cambiarla. Mostrar sólo el total en pesos colombianos escondería las dos
 * cosas que pueden fallar.
 */
function BloqueRemesa({ remesa }: { remesa: Remesa }) {
  if (remesa.enRojo) {
    return (
      <section className="card border-bad/50">
        <p className="text-xs uppercase tracking-wide text-muted">Desde Argentina</p>
        <p className="mt-1 text-lg font-semibold text-bad">Este mes no sobra nada para mandar</p>
        <p className="mt-1 text-sm text-muted">
          El sueldo de allá ({formatMoney(remesa.ingresoCents, 'ARS')}) no alcanza a cubrir los compromisos de
          allá ({formatMoney(remesa.compromisosCents, 'ARS')}). Faltan{' '}
          {formatMoney(-remesa.remanenteCents, 'ARS')}, así que el mes de acá tiene que salir del ingreso de acá.
        </p>
      </section>
    )
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted">Desde Argentina</p>
        {remesa.fx ? (
          <p className="text-xs text-muted">a COP {remesa.fx} por ARS</p>
        ) : (
          <p className="text-xs text-warn">falta cargar el tipo de cambio en Config</p>
        )}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-good">
        {remesa.fx ? formatMoney(remesa.enBaseCents, 'COP') : formatMoney(remesa.remanenteCents, 'ARS')}
      </p>
      <p className="mt-1 text-sm text-muted">
        Sobran {formatMoney(remesa.remanenteCents, 'ARS')} del sueldo de allá:{' '}
        {formatMoney(remesa.ingresoCents, 'ARS')} menos {formatMoney(remesa.compromisosCents, 'ARS')} de
        compromisos.
      </p>
    </section>
  )
}
