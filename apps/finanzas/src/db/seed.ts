/**
 * Datos de ejemplo para ver la app funcionando antes de cargar los propios.
 *   npm run seed -- --email vos@ejemplo.com --password una-clave-larga
 * Con --reset borra todo lo que haya antes de sembrar.
 */

import { getDb, id, now } from './client'
import { hashPassword } from '../lib/auth'
import { addDays, addMonths, iso, parseISO, todayISO } from '../lib/dates'
import { categorize, extractMerchant } from '../lib/categories'
import { createHash } from 'node:crypto'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const email = flag('email', 'demo@finanzas.local')
const password = flag('password', 'cambiar-esta-clave')
const reset = args.includes('--reset')

const db = getDb()
const today = todayISO()
const { y, m } = parseISO(today)

if (reset) {
  for (const t of [
    'rappi_orders',
    'transactions',
    'statements',
    'bills',
    'services',
    'loans',
    'incomes',
    'cards',
    'accounts',
    'category_rules',
    'settings',
    'sessions',
    'users',
  ]) {
    db.prepare(`DELETE FROM ${t}`).run()
  }
}

const userId = id()
db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
  userId,
  email,
  'Demo',
  hashPassword(password),
  now(),
)

const cuentaId = id()
db.prepare('INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
  cuentaId,
  'Caja de ahorro',
  'caja_ahorro',
  'ARS',
  48_000_00,
  now(),
)
db.prepare('INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
  id(),
  'Billetera virtual',
  'billetera',
  'ARS',
  12_500_00,
  now(),
)

const tarjetaId = id()
db.prepare(
  'INSERT INTO cards (id, name, issuer, closing_day, due_day, limit_cents, currency) VALUES (?, ?, ?, ?, ?, ?, ?)',
).run(tarjetaId, 'Visa', 'Banco Galicia', 25, 5, 900_000_00, 'ARS')

const servicios: Array<[string, string, number, number]> = [
  ['Luz', 'Edenor', 42_000_00, 8],
  ['Gas', 'Metrogas', 18_500_00, 12],
  ['Internet', 'Fibertel', 35_000_00, 10],
  ['Celulares', 'Personal', 28_000_00, 15],
  ['Expensas', 'Consorcio', 95_000_00, 10],
  ['Prepaga', 'OSDE', 180_000_00, 3],
]
for (const [name, provider, amount, day] of servicios) {
  db.prepare(
    `INSERT INTO services (id, name, provider, category, expected_amount_cents, due_day, active, autodebit, notes, created_at)
     VALUES (?, ?, ?, 'servicios', ?, ?, 1, 0, '', ?)`,
  ).run(id(), name, provider, amount, day, now())
}

db.prepare(
  `INSERT INTO incomes (id, name, owner, amount_cents, day_of_month, active, created_at)
   VALUES (?, 'Sueldo', 'Titular', ?, 5, 1, ?)`,
).run(id(), 950_000_00, now())
db.prepare(
  `INSERT INTO incomes (id, name, owner, amount_cents, day_of_month, active, created_at)
   VALUES (?, 'Sueldo', 'Cónyuge', ?, 7, 1, ?)`,
).run(id(), 720_000_00, now())

db.prepare(
  `INSERT INTO loans (id, name, lender, principal_cents, installment_cents, installments_total,
   installments_paid, first_due_date, rate_annual, active, created_at)
   VALUES (?, 'Préstamo personal', 'Banco Nación', ?, ?, 24, 7, ?, 78, 1, ?)`,
).run(id(), 3_000_000_00, 185_000_00, addMonths(iso(y, m, 15), -7), now())

// Movimientos de los últimos 90 días con un patrón realista de delivery.
const comercios: Array<[string, number, string]> = [
  ['COTO CICSA', 45_000_00, 'debito'],
  ['CARREFOUR EXPRESS', 18_000_00, 'credito'],
  ['RAPPI*MOSTAZA', 16_500_00, 'credito'],
  ['RAPPI*BURGER KING', 19_800_00, 'credito'],
  ['RAPPI*FARMACITY', 12_000_00, 'credito'],
  ['YPF FULL', 32_000_00, 'credito'],
  ['NETFLIX.COM', 9_900_00, 'credito'],
  ['SPOTIFY AB', 4_500_00, 'credito'],
  ['UBER TRIP', 6_200_00, 'credito'],
  ['FARMACITY', 14_300_00, 'debito'],
]

const insertTx = db.prepare(
  `INSERT INTO transactions (id, date, description, merchant, amount_cents, currency, category, method,
     account_id, card_id, source, installment, fingerprint, created_at)
   VALUES (?, ?, ?, ?, ?, 'ARS', ?, ?, ?, ?, 'import', '', ?, ?)
   ON CONFLICT DO NOTHING`,
)

let seedCounter = 0
for (let d = 90; d >= 0; d--) {
  const date = addDays(today, -d)
  // Entre cero y dos movimientos por día, determinista para que el seed sea repetible.
  const count = (d * 7) % 3
  for (let k = 0; k < count; k++) {
    const [desc, base, method] = comercios[(d + k * 3) % comercios.length]
    const amount = -(base + ((d * 137 + k * 991) % 5000) * 100)
    const fp = createHash('sha256').update(`seed-${seedCounter++}`).digest('hex').slice(0, 32)
    insertTx.run(
      id(),
      date,
      desc,
      extractMerchant(desc),
      amount,
      categorize(desc),
      method,
      method === 'debito' ? cuentaId : null,
      method === 'credito' ? tarjetaId : null,
      fp,
      now(),
    )
  }
}

// Pedidos de Rappi con el desglose que traen los mails.
const insertOrder = db.prepare(
  `INSERT INTO rappi_orders (id, date, store, total_cents, products_cents, delivery_cents, service_cents,
     tip_cents, items_count, vertical, fingerprint, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT DO NOTHING`,
)
const tiendas = ['Mostaza', 'Burger King', 'Sushi Club', 'Farmacity Turbo', 'La Birra Bar']
for (let i = 0; i < 24; i++) {
  const date = addDays(today, -(i * 3 + 1))
  const products = 12_000_00 + ((i * 733) % 9000) * 100
  const delivery = 1_500_00 + ((i * 91) % 900) * 100
  const service = 800_00
  const tip = i % 3 === 0 ? 1_000_00 : 0
  insertOrder.run(
    id(),
    date,
    tiendas[i % tiendas.length],
    products + delivery + service + tip,
    products,
    delivery,
    service,
    tip,
    1 + (i % 4),
    i % 5 === 3 ? 'farmacia' : 'restaurante',
    createHash('sha256').update(`seed-rappi-${i}`).digest('hex').slice(0, 32),
    now(),
  )
}

db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
  'min_buffer_cents',
  String(300_000_00),
)
db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
  'horizon_weeks',
  '8',
)

console.log(`Datos de ejemplo cargados.\n  usuario: ${email}\n  clave:   ${password}`)
