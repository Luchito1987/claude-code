import Link from 'next/link'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { CATEGORY_LABELS } from '@/lib/categories'
import { formatDate, formatPeriod, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import {
  accountReconciliation,
  baselinePeriod,
  historyMonths,
  monthHistory,
  MONTH_GROUP_LABELS,
  MONTH_GROUP_ORDER,
  type AccountReconciliation,
  type MonthHistory,
} from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default function HistorialPage({ searchParams }: { searchParams: { mes?: string } }) {
  const today = todayISO()
  const meses = historyMonths()
  const corte = baselinePeriod()

  if (!meses.length) {
    return (
      <Panel title="Historial">
        <Empty>
          Todavía no hay meses para consultar.{' '}
          <Link href="/importar" className="text-brand underline">
            Importar un extracto
          </Link>
        </Empty>
      </Panel>
    )
  }

  // Sin mes elegido se abre el más reciente, que es el que se suele mirar.
  const elegido = searchParams.mes && meses.includes(searchParams.mes) ? searchParams.mes : meses[0]
  const resumenes = meses.map((p) => monthHistory(p, today))
  const detalle = resumenes.find((r) => r.period === elegido)!
  const cuentas = accountReconciliation(elegido, today)

  return (
    <div className="space-y-6">
      <Panel
        title="Historial de meses"
        subtitle={
          corte
            ? `Desde ${formatPeriod(corte)}, el mes 0. Un mes pasa a histórico cuando cierra, el día 27. Lo anterior al mes 0 no se lista: tiene el gasto cargado dos veces y no es comparable, pero los movimientos siguen estando en Gastos.`
            : 'Un mes pasa a histórico cuando cierra, el día 27.'
        }
      >
        <Table
          head={
            <tr>
              <th className="th">Mes</th>
              <th className="th text-right">Entró</th>
              <th className="th text-right">Salió</th>
              <th className="th text-right">Neto</th>
              <th className="th text-right">Gasto variable</th>
              <th className="th" />
            </tr>
          }
        >
          {resumenes.map((m) => (
            <tr key={m.period} className={m.period === elegido ? 'bg-edge/40' : ''}>
              <td className="td">
                <Link href={`/historial?mes=${m.period}`} className="font-medium hover:text-brand">
                  {formatPeriod(m.period)}
                </Link>
                {m.period === corte && (
                  <span className="ml-2">
                    <Badge tone="info">mes 0</Badge>
                  </span>
                )}
                {m.current ? (
                  <span className="ml-2">
                    <Badge tone="good">en curso</Badge>
                  </span>
                ) : m.historical ? (
                  <span className="ml-2">
                    <Badge tone="neutral">histórico</Badge>
                  </span>
                ) : null}
              </td>
              <td className="td text-right tabular-nums text-good">{formatMoney(m.inCents)}</td>
              <td className="td text-right tabular-nums">{formatMoney(m.outCents)}</td>
              <td className={`td text-right tabular-nums ${m.netCents < 0 ? 'text-bad' : 'text-good'}`}>
                {formatMoney(m.netCents)}
              </td>
              <td className="td text-right tabular-nums">{formatMoney(m.variableCents)}</td>
              <td className="td text-right">
                <Link href={`/historial?mes=${m.period}`} className="btn-ghost px-2 py-1 text-xs">
                  Ver
                </Link>
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-muted">
          &quot;Entró&quot; y &quot;salió&quot; son los movimientos de las cuentas, no los compromisos. Una
          transferencia entre cuentas propias suma de los dos lados y se cancela en el neto.
        </p>
      </Panel>

      <Conciliacion cuentas={cuentas} mes={detalle} today={today} />

      <DetalleDelMes mes={detalle} today={today} />
    </div>
  )
}

/**
 * Si lo cargado del mes explica el saldo de cada cuenta.
 *
 * El saldo lo fija el banco, no la suma de movimientos, así que la única
 * verificación posible es al revés: restarle los movimientos al saldo de hoy y
 * mirar con cuánto habría arrancado el mes.
 */
function Conciliacion({
  cuentas,
  mes,
  today,
}: {
  cuentas: AccountReconciliation[]
  mes: MonthHistory
  today: string
}) {
  if (!cuentas.length) return null

  const suma = (f: (c: AccountReconciliation) => number) => cuentas.reduce((a, c) => a + f(c), 0)

  return (
    <Panel
      title={`Conciliación de saldos · ${formatPeriod(mes.period)}`}
      subtitle="Al saldo de hoy se le restan los movimientos del mes para ver con cuánto arrancó. Si ese número no es el que informaba el banco al cerrar el mes anterior, faltan movimientos por cargar."
    >
      <Table
        head={
          <tr>
            <th className="th">Cuenta</th>
            <th className="th text-right">Arrancó con</th>
            <th className="th text-right">Entró</th>
            <th className="th text-right">Salió</th>
            <th className="th text-right">Saldo hoy</th>
            <th className="th">Movimientos</th>
          </tr>
        }
      >
        {cuentas.map((c) => {
          // Un saldo con el último movimiento viejo no está mal, pero le faltan días.
          const desactualizada = mes.current && c.lastMovement !== null && c.lastMovement < today

          return (
            <tr key={c.accountId}>
              <td className="td font-medium">{c.name}</td>
              <td className="td text-right tabular-nums text-muted">{formatMoney(c.openingCents)}</td>
              <td className="td text-right tabular-nums text-good">{formatMoney(c.inCents)}</td>
              <td className="td text-right tabular-nums">{formatMoney(c.outCents)}</td>
              <td className="td text-right tabular-nums font-medium">{formatMoney(c.closingCents)}</td>
              <td className="td whitespace-nowrap text-xs text-muted">
                {c.movements === 0 ? (
                  <Badge tone="warn">sin movimientos</Badge>
                ) : (
                  <>
                    {c.movements} · último {formatDate(c.lastMovement!)}
                    {desactualizada && (
                      <span className="ml-2">
                        <Badge tone="warn">faltan días</Badge>
                      </span>
                    )}
                  </>
                )}
              </td>
            </tr>
          )
        })}
        <tr className="border-t border-edge">
          <td className="td text-xs font-semibold uppercase tracking-wide text-muted">Total</td>
          <td className="td text-right tabular-nums text-muted">{formatMoney(suma((c) => c.openingCents))}</td>
          <td className="td text-right tabular-nums text-good">{formatMoney(suma((c) => c.inCents))}</td>
          <td className="td text-right tabular-nums">{formatMoney(suma((c) => c.outCents))}</td>
          <td className="td text-right tabular-nums font-semibold">{formatMoney(suma((c) => c.closingCents))}</td>
          <td className="td" />
        </tr>
      </Table>
    </Panel>
  )
}

function DetalleDelMes({ mes, today }: { mes: MonthHistory; today: string }) {
  const bloques = MONTH_GROUP_ORDER.filter((g) => g !== 'variable')
    .map((group) => ({ group, items: mes.items.filter((i) => i.group === group) }))
    .filter((b) => b.items.length > 0)

  return (
    <div className="space-y-4">
      <Panel
        title={`Compromisos de ${formatPeriod(mes.period)}`}
        subtitle={`El mes va del ${mes.start} al ${mes.end}.${
          mes.current ? ' Todavía en curso: cierra el 27 y los totales pueden moverse.' : ''
        }${mes.preBaseline ? ' Anterior al mes 0: los importes pueden estar duplicados.' : ''}`}
        action={
          mes.pendingCents > 0 ? (
            <span className="text-xs text-warn">{formatMoney(mes.pendingCents)} sin marcar</span>
          ) : (
            <span className="text-xs text-muted">{formatMoney(mes.paidCents)} pagado</span>
          )
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
              </tr>
            }
          >
            {bloques.map(({ group, items }) => (
              <Bloque key={group} titulo={MONTH_GROUP_LABELS[group]} items={items} today={today} />
            ))}
          </Table>
        ) : (
          <Empty>Este mes no tiene compromisos registrados.</Empty>
        )}
      </Panel>

      <Panel
        title={`Gasto variable de ${formatPeriod(mes.period)}`}
        subtitle="Lo que salió por fuera de los compromisos, por rubro."
      >
        {mes.variable.length ? (
          <ul className="space-y-2">
            {mes.variable.map((v) => {
              const max = Math.max(...mes.variable.map((x) => x.cents), 1)
              return (
                <li key={v.category}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="truncate">{CATEGORY_LABELS[v.category] ?? v.category}</span>
                    <span className="tabular-nums text-muted">{formatMoney(v.cents)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-edge">
                    <div
                      className="h-1.5 rounded-full bg-brand"
                      style={{ width: `${Math.max(2, (v.cents / max) * 100)}%` }}
                    />
                  </div>
                </li>
              )
            })}
            <li className="flex items-baseline justify-between gap-2 border-t border-edge pt-2 text-sm font-medium">
              <span>Total</span>
              <span className="tabular-nums">{formatMoney(mes.variableCents)}</span>
            </li>
          </ul>
        ) : (
          <Empty>Sin gasto variable registrado en este mes.</Empty>
        )}
      </Panel>
    </div>
  )
}

/** Un grupo del mes, con su subtotal. Solo lectura: el historial no se edita. */
function Bloque({
  titulo,
  items,
  today,
}: {
  titulo: string
  items: MonthHistory['items']
  today: string
}) {
  const total = items.reduce((a, i) => a + i.cents, 0)

  return (
    <>
      <tr className="bg-edge/30">
        <td className="td text-xs font-semibold uppercase tracking-wide text-muted">{titulo}</td>
        <td className="td" />
        <td className="td text-right tabular-nums text-muted">{formatMoney(total)}</td>
        <td className="td" />
      </tr>
      {items.map((item) => (
        <tr key={`${item.kind}-${item.refId}`} className={item.paid ? 'opacity-55' : ''}>
          <td className="td">
            <span className="font-medium">{item.label}</span>
            <span className="ml-2 text-xs text-muted">{item.detail}</span>
          </td>
          <td className="td whitespace-nowrap text-muted">{formatDate(item.dueDate)}</td>
          <td className="td text-right tabular-nums">{formatMoney(item.cents)}</td>
          <td className="td">
            {item.paid ? <Badge tone="good">pagado</Badge> : <Badge tone="warn">sin marcar</Badge>}
          </td>
        </tr>
      ))}
    </>
  )
}
