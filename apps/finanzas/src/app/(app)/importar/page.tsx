import { Empty, Panel, Table } from '@/components/ui'
import { formatMoney } from '@/lib/money'
import { listAccounts, listCards, recentStatements } from '@/lib/queries'
import { deleteStatementAction } from '@/app/actions/data'
import { ImportForm } from './ImportForm'

export const dynamic = 'force-dynamic'

export default function ImportarPage() {
  const accounts = listAccounts()
  const cards = listCards()
  const statements = recentStatements()

  return (
    <div className="space-y-6">
      <Panel
        title="Importar un extracto"
        subtitle="Reconoce el CSV/TSV que exporta el home banking y también texto pegado, una línea por movimiento"
      >
        <ImportForm
          accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
          cards={cards.map((c) => ({ id: c.id, name: c.name }))}
        />
      </Panel>

      <Panel title="Cómo se interpreta cada formato">
        <ul className="space-y-2 text-sm text-slate-300">
          <li>
            <strong>Columnas:</strong> se buscan por nombre (fecha, detalle/concepto/descripción, importe, o débito y
            crédito por separado). El separador — coma, punto y coma o tabulación — se detecta solo.
          </li>
          <li>
            <strong>Importes:</strong> se aceptan <code>1.234,56</code>, <code>1,234.56</code>, negativos con signo,
            con guion al final o entre paréntesis.
          </li>
          <li>
            <strong>Signo:</strong> en un resumen de tarjeta los consumos vienen positivos y se guardan como egresos.
            En una cuenta se respeta el signo del extracto.
          </li>
          <li>
            <strong>Duplicados:</strong> cada movimiento se firma por fecha, detalle e importe. Reimportar el mismo
            archivo no duplica nada.
          </li>
          <li>
            <strong>Doble conteo:</strong> los consumos de tarjeta no descuentan caja el día de la compra, solo el día
            que vence el resumen.
          </li>
        </ul>
      </Panel>

      <Panel title="Importaciones recientes">
        {statements.length ? (
          <Table
            head={
              <tr>
                <th className="th">Archivo</th>
                <th className="th">Destino</th>
                <th className="th text-right">Movimientos</th>
                <th className="th text-right">Total</th>
                <th className="th">Cuándo</th>
                <th className="th" />
              </tr>
            }
          >
            {statements.map((s) => (
              <tr key={s.id}>
                <td className="td">{s.file_name || '—'}</td>
                <td className="td text-muted">
                  {s.card_name ?? s.account_name ?? (s.kind === 'rappi' ? 'Rappi' : '—')}
                </td>
                <td className="td text-right tabular-nums">{s.rows_count}</td>
                <td className="td text-right tabular-nums">{formatMoney(s.total_cents)}</td>
                <td className="td text-xs text-muted">
                  {new Date(s.imported_at).toLocaleString('es-AR')}
                  {s.user_name ? ` · ${s.user_name}` : ''}
                </td>
                <td className="td text-right">
                  <form action={deleteStatementAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" className="btn-danger px-2 py-1 text-xs" title="Borra la importación y sus movimientos">
                      Deshacer
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>Todavía no importaste nada.</Empty>
        )}
      </Panel>
    </div>
  )
}
