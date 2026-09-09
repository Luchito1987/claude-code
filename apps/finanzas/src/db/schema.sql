-- Esquema de la app de flujo de caja. Idempotente: se aplica en cada arranque.
-- Convenciones: importes en centavos (enteros), fechas ISO 'YYYY-MM-DD',
-- timestamps ISO 8601 UTC. Los importes negativos son egresos.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Cuentas de dinero disponible (caja de ahorro, efectivo, billetera virtual).
CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL DEFAULT 'caja_ahorro',
  currency      TEXT NOT NULL DEFAULT 'ARS',
  balance_cents INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);

-- Tarjetas de crédito: cierre y vencimiento definen en qué semana pega el pago.
CREATE TABLE IF NOT EXISTS cards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  issuer      TEXT NOT NULL DEFAULT '',
  closing_day INTEGER NOT NULL DEFAULT 25,
  due_day     INTEGER NOT NULL DEFAULT 5,
  limit_cents INTEGER NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'ARS'
);

-- Servicios recurrentes (luz, gas, internet, colegio, suscripciones...).
CREATE TABLE IF NOT EXISTS services (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  provider              TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT 'servicios',
  expected_amount_cents INTEGER NOT NULL DEFAULT 0,
  due_day               INTEGER NOT NULL DEFAULT 10,
  active                INTEGER NOT NULL DEFAULT 1,
  autodebit             INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT NOT NULL DEFAULT '',
  -- Cómo aparece este servicio en el extracto del banco. "Air-e (Energía)" se
  -- paga como "PAGO SV EMPRESA DE ENERGIA AI": ni el nombre ni el importe
  -- coinciden, así que sin esto no hay forma de cruzarlos.
  match_pattern         TEXT NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL
);

-- Una factura por servicio y período. El período es el mes de vencimiento.
CREATE TABLE IF NOT EXISTS bills (
  id          TEXT PRIMARY KEY,
  service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,               -- 'YYYY-MM'
  amount_cents INTEGER NOT NULL DEFAULT 0,
  due_date    TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | pagado
  paid_at     TEXT,
  estimated   INTEGER NOT NULL DEFAULT 1,  -- 1 = importe estimado, 0 = confirmado
  source      TEXT NOT NULL DEFAULT 'auto',
  created_at  TEXT NOT NULL,
  UNIQUE (service_id, period)
);
CREATE INDEX IF NOT EXISTS idx_bills_due ON bills(due_date);

CREATE TABLE IF NOT EXISTS loans (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  lender             TEXT NOT NULL DEFAULT '',
  principal_cents    INTEGER NOT NULL DEFAULT 0,
  installment_cents  INTEGER NOT NULL DEFAULT 0,
  installments_total INTEGER NOT NULL DEFAULT 1,
  installments_paid  INTEGER NOT NULL DEFAULT 0,
  first_due_date     TEXT NOT NULL,
  rate_annual        REAL NOT NULL DEFAULT 0,
  active             INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);

-- Ingresos recurrentes (sueldos, honorarios) para proyectar el flujo.
CREATE TABLE IF NOT EXISTS incomes (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  owner        TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  day_of_month INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL
);

-- Cada archivo importado deja rastro para poder deshacer la importación.
CREATE TABLE IF NOT EXISTS statements (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,               -- card | account | rappi
  card_id     TEXT REFERENCES cards(id) ON DELETE SET NULL,
  account_id  TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  file_name   TEXT NOT NULL DEFAULT '',
  period      TEXT NOT NULL DEFAULT '',
  -- Vencimiento que declara el propio extracto, cuando lo trae. Es el que ubica
  -- el resumen en su mes, en vez de deducirlo del día de cierre de la tarjeta.
  due_date    TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL DEFAULT 0,
  rows_count  INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL
);

-- Movimientos: gastos manuales, tickets, y filas de extractos importados.
CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  description  TEXT NOT NULL,
  merchant     TEXT NOT NULL DEFAULT '',
  amount_cents INTEGER NOT NULL,           -- negativo = gasto, positivo = ingreso
  currency     TEXT NOT NULL DEFAULT 'ARS',
  category     TEXT NOT NULL DEFAULT 'otros',
  method       TEXT NOT NULL DEFAULT 'debito', -- debito | credito | efectivo | transferencia
  account_id   TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  card_id      TEXT REFERENCES cards(id) ON DELETE SET NULL,
  statement_id TEXT REFERENCES statements(id) ON DELETE CASCADE,
  source       TEXT NOT NULL DEFAULT 'manual', -- manual | import | rappi
  installment  TEXT NOT NULL DEFAULT '',    -- '3/6' para cuotas de tarjeta
  -- Mes de resumen en el que apareció el movimiento ('YYYY-MM'). Para las cuotas
  -- es el ancla: la cuota 3/6 de este resumen deja 3 cuotas en los meses que siguen.
  billing_period TEXT NOT NULL DEFAULT '',
  receipt_path TEXT NOT NULL DEFAULT '',
  fingerprint  TEXT NOT NULL DEFAULT '',    -- evita duplicados al reimportar
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_category ON transactions(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_fingerprint
  ON transactions(fingerprint) WHERE fingerprint <> '';

-- Detalle de pedidos de Rappi (el movimiento de tarjeta asociado va aparte).
CREATE TABLE IF NOT EXISTS rappi_orders (
  id             TEXT PRIMARY KEY,
  date           TEXT NOT NULL,
  store          TEXT NOT NULL DEFAULT '',
  total_cents    INTEGER NOT NULL,
  products_cents INTEGER NOT NULL DEFAULT 0,
  delivery_cents INTEGER NOT NULL DEFAULT 0,
  service_cents  INTEGER NOT NULL DEFAULT 0,
  tip_cents      INTEGER NOT NULL DEFAULT 0,
  items_count    INTEGER NOT NULL DEFAULT 0,
  vertical       TEXT NOT NULL DEFAULT 'restaurante',
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  fingerprint    TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rappi_fingerprint
  ON rappi_orders(fingerprint) WHERE fingerprint <> '';

-- Reglas de categorización: substring del comercio -> categoría.
CREATE TABLE IF NOT EXISTS category_rules (
  id        TEXT PRIMARY KEY,
  pattern   TEXT NOT NULL,
  category  TEXT NOT NULL,
  priority  INTEGER NOT NULL DEFAULT 100
);

-- Pagos del mes que no son facturas de servicio: el resumen de una tarjeta o
-- una cuota. Permite tildar "pagado" sin inventar una factura.
CREATE TABLE IF NOT EXISTS month_payments (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,               -- tarjeta | prestamo
  ref_id       TEXT NOT NULL,               -- card_id o loan_id
  period       TEXT NOT NULL,               -- mes financiero 'YYYY-MM'
  amount_cents INTEGER NOT NULL DEFAULT 0,
  paid_at      TEXT NOT NULL,
  UNIQUE (kind, ref_id, period)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
