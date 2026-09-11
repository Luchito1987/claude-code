'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { getDb, id, now } from '@/db/client'
import { currentUser } from '@/lib/auth'
import { toCents } from '@/lib/money'
import { todayISO } from '@/lib/dates'
import { extractMerchant } from '@/lib/categories'
import { readImageText } from '@/lib/ocr'
import { parseReceipt } from '@/lib/parsers/receipt'
import { listUserRules } from '@/lib/queries'

function requireUser() {
  const user = currentUser()
  if (!user) redirect('/login')
  return user
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

/** Las fotos viven junto a la base, fuera de git. */
function receiptsDir(): string {
  const dir = process.env.RECEIPTS_PATH ?? resolve(process.cwd(), 'data', 'receipts')
  mkdirSync(dir, { recursive: true })
  return dir
}

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'])
const MAX_BYTES = 15 * 1024 * 1024

/**
 * Lee la foto y manda a la pantalla de confirmación con lo que se entendió.
 * No guarda nada en movimientos todavía: el OCR se equivoca y el importe se
 * revisa antes de tocar el saldo.
 */
export async function readReceiptAction(form: FormData): Promise<void> {
  requireUser()
  const file = form.get('photo')
  if (!(file instanceof File) || file.size === 0) redirect('/ticket?error=sin-foto')

  const ext = extname(file.name).toLowerCase() || '.jpg'
  if (!IMAGE_EXT.has(ext)) redirect('/ticket?error=formato')
  if (file.size > MAX_BYTES) redirect('/ticket?error=pesada')

  const bytes = Buffer.from(await file.arrayBuffer())
  const nombre = `${Date.now()}-${id().slice(0, 8)}${ext}`
  writeFileSync(resolve(receiptsDir(), nombre), bytes)

  let leido
  try {
    leido = parseReceipt(await readImageText(bytes), listUserRules())
  } catch {
    // Que falle el OCR no puede perder la foto: se sigue a mano.
    redirect(`/ticket?foto=${encodeURIComponent(nombre)}&error=ocr`)
  }

  const params = new URLSearchParams({ foto: nombre, origen: leido.source })
  if (leido.amountCents !== null) params.set('monto', (leido.amountCents / 100).toFixed(2))
  if (leido.merchant) params.set('detalle', extractMerchant(leido.merchant))
  if (leido.date) params.set('fecha', leido.date)
  if (leido.category) params.set('categoria', leido.category)

  redirect(`/ticket?${params.toString()}`)
}

/** Confirma el gasto ya revisado: lo guarda y descuenta del disponible. */
export async function saveReceiptAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()

  const description = str(form, 'description')
  const cents = Math.abs(toCents(str(form, 'amount')))
  if (!description || !cents) redirect('/ticket?error=faltan-datos')

  const accountId = str(form, 'account_id') || null
  const amount = -cents

  db.prepare(
    `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category,
     method, account_id, source, receipt_path, created_at)
     VALUES (?, ?, ?, ?, ?, 'ARS', ?, 'efectivo', ?, 'ticket', ?, ?)`,
  ).run(
    id(),
    str(form, 'date') || todayISO(),
    description,
    extractMerchant(description),
    amount,
    str(form, 'category') || 'otros',
    accountId,
    str(form, 'foto'),
    now(),
  )

  if (accountId) {
    db.prepare('UPDATE accounts SET balance_cents = balance_cents + ?, updated_at = ? WHERE id = ?').run(
      amount,
      now(),
      accountId,
    )
  }

  revalidatePath('/')
  revalidatePath('/gastos')
  redirect('/ticket?ok=1')
}
