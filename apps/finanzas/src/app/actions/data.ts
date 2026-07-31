'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getDb, id, now } from '@/db/client'
import { currentUser } from '@/lib/auth'
import { toCents } from '@/lib/money'
import { todayISO } from '@/lib/dates'
import { categorize, extractMerchant } from '@/lib/categories'
import { listUserRules, markBillPaid, setSetting, updateBillAmount, ensureBillsForPeriod } from '@/lib/queries'

function requireUser() {
  const user = currentUser()
  if (!user) redirect('/login')
  return user
}

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()
const cents = (f: FormData, k: string) => Math.abs(toCents(String(f.get(k) ?? '0')))
const int = (f: FormData, k: string, fallback = 0) => {
  const n = Number(String(f.get(k) ?? ''))
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

// ------------------------------------------------------------------ cuentas

export async function saveAccountAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()
  const existing = str(form, 'id')
  const name = str(form, 'name')
  if (!name) return

  if (existing) {
    db.prepare('UPDATE accounts SET name = ?, kind = ?, balance_cents = ?, updated_at = ? WHERE id = ?').run(
      name,
      str(form, 'kind') || 'caja_ahorro',
      toCents(str(form, 'balance')),
      now(),
      existing,
    )
  } else {
    db.prepare(
      'INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id(), name, str(form, 'kind') || 'caja_ahorro', 'ARS', toCents(str(form, 'balance')), now())
  }
  revalidatePath('/config')
  revalidatePath('/')
}

export async function deleteAccountAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM accounts WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/config')
  revalidatePath('/')
}

// ----------------------------------------------------------------- tarjetas

export async function saveCardAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()
  const existing = str(form, 'id')
  const name = str(form, 'name')
  if (!name) return
  const args = [
    name,
    str(form, 'issuer'),
    Math.min(28, Math.max(1, int(form, 'closing_day', 25))),
    Math.min(28, Math.max(1, int(form, 'due_day', 5))),
    cents(form, 'limit'),
  ] as const

  if (existing) {
    db.prepare('UPDATE cards SET name = ?, issuer = ?, closing_day = ?, due_day = ?, limit_cents = ? WHERE id = ?').run(
      ...args,
      existing,
    )
  } else {
    db.prepare(
      'INSERT INTO cards (id, name, issuer, closing_day, due_day, limit_cents, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id(), ...args, 'ARS')
  }
  revalidatePath('/config')
  revalidatePath('/')
}

export async function deleteCardAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM cards WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/config')
}

// ---------------------------------------------------------------- servicios

export async function saveServiceAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()
  const existing = str(form, 'id')
  const name = str(form, 'name')
  if (!name) return
  const args = [
    name,
    str(form, 'provider'),
    str(form, 'category') || 'servicios',
    cents(form, 'expected_amount'),
    Math.min(31, Math.max(1, int(form, 'due_day', 10))),
    form.get('active') ? 1 : 0,
    form.get('autodebit') ? 1 : 0,
    str(form, 'notes'),
  ] as const

  if (existing) {
    db.prepare(
      `UPDATE services SET name = ?, provider = ?, category = ?, expected_amount_cents = ?,
       due_day = ?, active = ?, autodebit = ?, notes = ? WHERE id = ?`,
    ).run(...args, existing)
  } else {
    db.prepare(
      `INSERT INTO services (id, name, provider, category, expected_amount_cents, due_day, active, autodebit, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id(), ...args, now())
  }
  revalidatePath('/facturas')
  revalidatePath('/')
}

export async function deleteServiceAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM services WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/facturas')
}

// ---------------------------------------------------------------- facturas

export async function updateBillAction(form: FormData): Promise<void> {
  requireUser()
  const billId = str(form, 'id')
  if (!billId) return
  const amount = cents(form, 'amount')
  const due = str(form, 'due_date')
  updateBillAmount(billId, amount, due || undefined)
  revalidatePath('/facturas')
  revalidatePath('/')
}

export async function toggleBillPaidAction(form: FormData): Promise<void> {
  requireUser()
  markBillPaid(str(form, 'id'), str(form, 'paid') === '1')
  revalidatePath('/facturas')
  revalidatePath('/')
}

export async function generateBillsAction(form: FormData): Promise<void> {
  requireUser()
  const period = str(form, 'period')
  if (period) ensureBillsForPeriod(period)
  revalidatePath('/facturas')
}

// --------------------------------------------------------------- préstamos

export async function saveLoanAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()
  const existing = str(form, 'id')
  const name = str(form, 'name')
  if (!name) return
  const args = [
    name,
    str(form, 'lender'),
    cents(form, 'principal'),
    cents(form, 'installment'),
    Math.max(1, int(form, 'installments_total', 1)),
    Math.max(0, int(form, 'installments_paid', 0)),
    str(form, 'first_due_date') || todayISO(),
    Number(str(form, 'rate_annual')) || 0,
    form.get('active') ? 1 : 0,
  ] as const

  if (existing) {
    db.prepare(
      `UPDATE loans SET name = ?, lender = ?, principal_cents = ?, installment_cents = ?,
       installments_total = ?, installments_paid = ?, first_due_date = ?, rate_annual = ?, active = ? WHERE id = ?`,
    ).run(...args, existing)
  } else {
    db.prepare(
      `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
       installments_paid, first_due_date, rate_annual, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id(), ...args, now())
  }
  revalidatePath('/prestamos')
  revalidatePath('/')
}

export async function payInstallmentAction(form: FormData): Promise<void> {
  requireUser()
  getDb()
    .prepare(
      `UPDATE loans SET installments_paid = MIN(installments_paid + 1, installments_total) WHERE id = ?`,
    )
    .run(str(form, 'id'))
  revalidatePath('/prestamos')
  revalidatePath('/')
}

export async function deleteLoanAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM loans WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/prestamos')
}

// ---------------------------------------------------------------- ingresos

export async function saveIncomeAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()
  const existing = str(form, 'id')
  const name = str(form, 'name')
  if (!name) return
  const args = [
    name,
    str(form, 'owner'),
    cents(form, 'amount'),
    Math.min(31, Math.max(1, int(form, 'day_of_month', 1))),
    form.get('active') ? 1 : 0,
  ] as const

  if (existing) {
    db.prepare('UPDATE incomes SET name = ?, owner = ?, amount_cents = ?, day_of_month = ?, active = ? WHERE id = ?').run(
      ...args,
      existing,
    )
  } else {
    db.prepare(
      'INSERT INTO incomes (id, name, owner, amount_cents, day_of_month, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id(), ...args, now())
  }
  revalidatePath('/config')
  revalidatePath('/')
}

export async function deleteIncomeAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM incomes WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/config')
}

// ------------------------------------------------------------------ gastos

export async function saveTransactionAction(form: FormData): Promise<void> {
  requireUser()
  const db = getDb()
  const existing = str(form, 'id')
  const description = str(form, 'description')
  if (!description) return

  const method = str(form, 'method') || 'debito'
  const rawAmount = cents(form, 'amount')
  const isIncome = str(form, 'direction') === 'ingreso'
  const amount = isIncome ? rawAmount : -rawAmount
  const category = str(form, 'category') || categorize(description, listUserRules())

  if (existing) {
    db.prepare(
      `UPDATE transactions SET date = ?, description = ?, merchant = ?, amount_cents = ?,
       category = ?, method = ?, account_id = ?, card_id = ? WHERE id = ?`,
    ).run(
      str(form, 'date') || todayISO(),
      description,
      extractMerchant(description),
      amount,
      category,
      method,
      str(form, 'account_id') || null,
      str(form, 'card_id') || null,
      existing,
    )
  } else {
    db.prepare(
      `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category,
       method, account_id, card_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, 'ARS', ?, ?, ?, ?, 'manual', ?)`,
    ).run(
      id(),
      str(form, 'date') || todayISO(),
      description,
      extractMerchant(description),
      amount,
      category,
      method,
      str(form, 'account_id') || null,
      str(form, 'card_id') || null,
      now(),
    )
  }
  revalidatePath('/gastos')
  revalidatePath('/')
}

export async function deleteTransactionAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM transactions WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/gastos')
  revalidatePath('/')
}

export async function recategorizeAction(form: FormData): Promise<void> {
  requireUser()
  const txId = str(form, 'id')
  const category = str(form, 'category')
  const db = getDb()
  db.prepare('UPDATE transactions SET category = ? WHERE id = ?').run(category, txId)

  // Si se pide, la corrección queda como regla y se aplica a todo lo que ya está.
  if (form.get('remember')) {
    const row = db.prepare('SELECT merchant, description FROM transactions WHERE id = ?').get(txId) as
      | { merchant: string; description: string }
      | undefined
    const pattern = (row?.merchant || row?.description || '').slice(0, 40)
    if (pattern) {
      db.prepare('INSERT INTO category_rules (id, pattern, category, priority) VALUES (?, ?, ?, 10)').run(
        id(),
        pattern,
        category,
      )
      db.prepare('UPDATE transactions SET category = ? WHERE description LIKE ?').run(category, `%${pattern}%`)
    }
  }
  revalidatePath('/gastos')
}

// ---------------------------------------------------------- configuración

export async function saveSettingsAction(form: FormData): Promise<void> {
  requireUser()
  setSetting('min_buffer_cents', String(cents(form, 'min_buffer')))
  setSetting('horizon_weeks', String(Math.min(26, Math.max(2, int(form, 'horizon_weeks', 8)))))
  revalidatePath('/')
  revalidatePath('/config')
}

export async function deleteStatementAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM statements WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/importar')
  revalidatePath('/')
}

export async function deleteRuleAction(form: FormData): Promise<void> {
  requireUser()
  getDb().prepare('DELETE FROM category_rules WHERE id = ?').run(str(form, 'id'))
  revalidatePath('/config')
}
