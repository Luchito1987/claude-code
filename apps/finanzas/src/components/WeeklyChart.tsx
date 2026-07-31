import { formatMoney } from '@/lib/money'

export interface WeekPoint {
  start: string
  label: string
  closing: number
  inflow: number
  outflow: number
}

const W = 720
const H = 190
const PAD = { top: 16, right: 26, bottom: 26, left: 54 }

/** Etiqueta corta para el eje: $ 1,2 M / $ 350 mil. El detalle está en la tabla. */
function shortMoney(cents: number): string {
  const pesos = Math.round(cents / 100)
  const abs = Math.abs(pesos)
  const signo = pesos < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${signo}$ ${(abs / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (abs >= 1_000) return `${signo}$ ${Math.round(abs / 1_000)} mil`
  return `${signo}$ ${abs}`
}

/** Marcas del eje en valores redondos dentro del rango, de mayor a menor. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min
  if (span <= 0) return [max]
  const rough = span / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10
  const ticks: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v)
  return ticks.reverse()
}

/**
 * Saldo proyectado al cierre de cada semana. Una sola serie sobre un solo eje:
 * entradas y salidas ya están en la tabla de abajo, meterlas acá solo agrega
 * ruido. La línea punteada es el colchón mínimo.
 */
export function WeeklyChart({ weeks, buffer }: { weeks: WeekPoint[]; buffer: number }) {
  if (weeks.length < 2) return null

  const values = weeks.map((w) => w.closing)
  const candidates = [...values, buffer, 0]
  const rawMin = Math.min(...candidates)
  const rawMax = Math.max(...candidates)
  const span = rawMax - rawMin || Math.abs(rawMax) || 1
  const min = rawMin - span * 0.12
  const max = rawMax + span * 0.12

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (innerW * i) / (weeks.length - 1)
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH

  const line = weeks.map((w, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(w.closing).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(weeks.length - 1).toFixed(1)} ${y(min).toFixed(1)} L ${x(0).toFixed(1)} ${y(min).toFixed(1)} Z`

  const lowest = weeks.reduce((a, w) => (w.closing < a.closing ? w : a), weeks[0])
  const lowestIndex = weeks.indexOf(lowest)
  const breached = lowest.closing < buffer
  const negative = lowest.closing < 0
  const stroke = negative ? '#e5484d' : breached ? '#b87d0a' : '#4b93e8'

  return (
    <figure className="mb-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Saldo proyectado por semana, de ${formatMoney(weeks[0].closing)} a ${formatMoney(
          weeks[weeks.length - 1].closing,
        )}. Piso ${formatMoney(lowest.closing)} en la semana del ${lowest.label}.`}
      >
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grilla recesiva: solo las referencias que se leen, en valores redondos. */}
        {niceTicks(min, max).map((v) => (
          <g key={v}>
            <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke="#232c38" strokeWidth="1" />
            <text x={PAD.left - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#8b98a9">
              {shortMoney(v)}
            </text>
          </g>
        ))}

        {rawMin < 0 && (
          <line x1={PAD.left} y1={y(0)} x2={W - PAD.right} y2={y(0)} stroke="#e5484d" strokeWidth="1" opacity="0.5" />
        )}

        {buffer > 0 && (
          <>
            <line
              x1={PAD.left}
              y1={y(buffer)}
              x2={W - PAD.right}
              y2={y(buffer)}
              stroke="#8b98a9"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
            <text x={W - PAD.right} y={y(buffer) + 12} textAnchor="end" fontSize="10" fill="#8b98a9">
              colchón {shortMoney(buffer)}
            </text>
          </>
        )}

        <path d={area} fill="url(#fill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {weeks.map((w, i) => (
          <g key={w.start}>
            {/* Área de hover más grande que el punto, con tooltip nativo. */}
            <circle cx={x(i)} cy={y(w.closing)} r="12" fill="transparent">
              <title>{`${w.label}: cierra en ${formatMoney(w.closing)} (entra ${formatMoney(
                w.inflow,
              )}, sale ${formatMoney(w.outflow)})`}</title>
            </circle>
            <circle
              cx={x(i)}
              cy={y(w.closing)}
              r={i === lowestIndex ? 5 : 3.5}
              fill={i === lowestIndex ? stroke : '#151b23'}
              stroke={stroke}
              strokeWidth="2"
            />
          </g>
        ))}

        {/* Etiquetas directas solo donde importan: inicio, piso y final. */}
        {[0, lowestIndex, weeks.length - 1]
          .filter((v, i, arr) => arr.indexOf(v) === i)
          .map((i) => (
            <text
              key={`lbl-${i}`}
              x={Math.min(Math.max(x(i), PAD.left + 24), W - PAD.right - 24)}
              y={y(weeks[i].closing) - 12}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="#e6edf3"
            >
              {formatMoney(weeks[i].closing)}
            </text>
          ))}

        {weeks.map((w, i) =>
          i % Math.ceil(weeks.length / 6) === 0 || i === weeks.length - 1 ? (
            <text
              key={`x-${w.start}`}
              x={Math.min(Math.max(x(i), 18), W - 18)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10"
              fill="#8b98a9"
            >
              {w.label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="sr-only">
        Saldo proyectado al cierre de cada semana comparado con el colchón mínimo. Los valores exactos están en la
        tabla siguiente.
      </figcaption>
    </figure>
  )
}
