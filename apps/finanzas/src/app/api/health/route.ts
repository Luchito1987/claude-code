import { NextResponse } from 'next/server'
import { getDb } from '@/db/client'

export const dynamic = 'force-dynamic'

/** Chequeo de salud para el balanceador: verifica que la base responda. */
export async function GET() {
  try {
    getDb().prepare('SELECT 1').get()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 503 })
  }
}
