import { Panel } from '@/components/ui'
import { todayISO } from '@/lib/dates'
import { buildSnapshot, toMarkdown } from '@/lib/report'
import { CopyButton } from './CopyButton'

export const dynamic = 'force-dynamic'

export default function ReportesPage() {
  const snapshot = buildSnapshot(todayISO())
  const markdown = toMarkdown(snapshot)

  return (
    <div className="space-y-6">
      <Panel
        title="Informe para analizar"
        subtitle="Un solo texto con todos los números: saldos, facturas del período, tarjetas, préstamos, gasto por categoría, delivery y la proyección semanal. Termina con las preguntas concretas a responder."
        action={
          <div className="flex flex-wrap gap-2">
            <CopyButton text={markdown} />
            <a href="/api/export?formato=md" className="btn-ghost text-xs">
              .md
            </a>
            <a href="/api/export?formato=json" className="btn-ghost text-xs">
              .json
            </a>
            <a href="/api/export?formato=csv" className="btn-ghost text-xs">
              movimientos .csv
            </a>
          </div>
        }
      >
        <p className="mb-3 text-sm text-slate-300">
          Copiá el informe y pegalo en una conversación con Claude (o cualquier asistente) pidiéndole que responda las
          preguntas del final. El JSON sirve si querés que procese los datos crudos; el CSV, para abrirlo en una
          planilla.
        </p>
        <pre className="max-h-[32rem] overflow-auto rounded-lg border border-edge bg-ink p-4 text-xs leading-relaxed text-slate-300">
          {markdown}
        </pre>
      </Panel>
    </div>
  )
}
