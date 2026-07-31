import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { buildSnapshot, toCsv, toMarkdown } from '@/lib/report'
import { listTransactions } from '@/lib/queries'
import { addDays, todayISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!currentUser()) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })

  const format = new URL(request.url).searchParams.get('formato') ?? 'md'
  const today = todayISO()
  const stamp = today.replace(/-/g, '')

  if (format === 'csv') {
    const rows = listTransactions({ from: addDays(today, -365), to: today }).map((t) => ({
      fecha: t.date,
      detalle: t.description,
      comercio: t.merchant,
      importe: (t.amount_cents / 100).toFixed(2),
      moneda: t.currency,
      categoria: t.category,
      medio: t.method,
      cuota: t.installment,
      origen: t.source,
    }))
    return new NextResponse(toCsv(rows), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="movimientos-${stamp}.csv"`,
      },
    })
  }

  const snapshot = buildSnapshot(today)

  if (format === 'json') {
    return new NextResponse(JSON.stringify(snapshot, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="finanzas-${stamp}.json"`,
      },
    })
  }

  return new NextResponse(toMarkdown(snapshot), {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="finanzas-${stamp}.md"`,
    },
  })
}
