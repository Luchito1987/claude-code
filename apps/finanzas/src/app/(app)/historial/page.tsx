import Link from 'next/link'
import { Badge, Empty, Panel, Table } from '@/components/ui'
import { CATEGORY_LABELS } from '@/lib/categories'
import { formatDate, formatPeriod, todayISO } from '@/lib/dates'
import { formatMoney } from '@/lib/money'
import {
  baselinePeriod,
  monthHistory,
  monthsWithActivity,
  MONTH_GROUP_LABELS,
  MONTH_GROUP_ORDER,
  type MonthHistory,
} from '@/lib/queries'

export const dynamic = 'force-dynamic'

export default function HistorialPage({ searchParams }: { searchParams: { mes?: string } }) {
  const today = todayISO()
  const meses = monthsWithActivity()
  const corte = baselinePeriod()

  if (!meses.length) {
    return (
      <Panel title="Historial">
        <Empty>
          Todavía no hay movimientos cargados.{' '}
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

  return (
    <div className="space-y-6">
      <Panel
        title="Historial de meses"
        subtitle={
          corte
            ? `Un mes pasa a histórico cuando cierra, el día 27. Los anteriores a ${formatPeriod(corte)} además arrastran carga doble: ahí convivían la planilla que llevabas a mano y el extracto del banco, así que el mismo gasto entró dos veces.`
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
                {m.preBaseline && (
                  <span className="ml-2">
                    <Badge tone="warn">carga doble</Badge>
                  </span>
                )}
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

      <DetalleDelMes mes={detalle} today={today} />
    </div>
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
