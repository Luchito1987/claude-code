/**
 * La puerta por clave para cargar extractos sin el navegador.
 *
 * Lo primero que fijan estos tests es que la puerta esté cerrada salvo que el
 * servidor tenga una clave larga configurada: un servidor público con datos
 * financieros no puede quedar abierto por un olvido. Después, que importar por
 * acá sea lo mismo que importar desde la pantalla: mismos movimientos y misma
 * guarda contra duplicados.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fuera de un request de Next no hay caché que invalidar.
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const CLAVE = 'a'.repeat(24) + 'b'.repeat(24)
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'finanzas-api-'))
  process.env.SQLITE_PATH = join(dir, 'test.db')
  process.env.FINANZAS_API_TOKEN = CLAVE
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  delete process.env.FINANZAS_API_TOKEN
  rmSync(dir, { recursive: true, force: true })
})

const pedido = (url: string, clave?: string, init: RequestInit = {}) =>
  new Request(`http://localhost${url}`, {
    ...init,
    headers: { ...(clave ? { authorization: `Bearer ${clave}` } : {}), ...(init.headers ?? {}) },
  })

async function base() {
  const { getDb } = await import('@/db/client')
  const db = getDb()
  db.prepare(`INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'a@b.c', 'Luciano', 'x', '2026-01-01')`).run()
  db.prepare(`INSERT INTO accounts (id, name, kind, currency, balance_cents, updated_at) VALUES ('emp', 'Empresa', 'ahorro', 'COP', 0, 'x')`).run()
  return db
}

/** El CSV sin encabezados que baja la Sucursal Virtual, con datos inventados. */
const CSV = [
  '999-000000-00, 442, , 20261010, , -1202.40, 3339, IMPTO GOBIERNO 4X1000, 0,',
  '999-000000-00, 442, , 20261008, , 5000000.00, 5376, PAGO DE PROV CLINICA EJEMPLO, 0,',
  '999-000000-00, 442, , 20261008, , -1091720.00, 9086, PAGO SV EMPRESA DE ENERGIA AI, 0,',
].join('\r\n')

function formulario(reemplazar = false) {
  const f = new FormData()
  f.set('file', new File([CSV], 'movimientos.csv', { type: 'text/csv' }))
  f.set('kind', 'account')
  f.set('target', 'emp')
  if (reemplazar) f.set('reemplazar', 'si')
  return f
}

describe('la clave', () => {
  it('sin clave configurada la API está cerrada aunque se mande una', async () => {
    delete process.env.FINANZAS_API_TOKEN
    await base()
    const { GET } = await import('@/app/api/estado/route')
    expect((await GET(pedido('/api/estado', CLAVE))).status).toBe(401)
  })

  it('una clave corta en el servidor también la deja cerrada', async () => {
    process.env.FINANZAS_API_TOKEN = 'corta'
    await base()
    const { GET } = await import('@/app/api/estado/route')
    expect((await GET(pedido('/api/estado', 'corta'))).status).toBe(401)
  })

  it('rechaza el pedido sin clave y con clave equivocada', async () => {
    await base()
    const { GET } = await import('@/app/api/estado/route')
    expect((await GET(pedido('/api/estado'))).status).toBe(401)
    expect((await GET(pedido('/api/estado', CLAVE.slice(0, -1) + 'x'))).status).toBe(401)
  })

  it('con la clave correcta muestra el estado', async () => {
    await base()
    const { GET } = await import('@/app/api/estado/route')
    const r = await GET(pedido('/api/estado', CLAVE))
    expect(r.status).toBe(200)
    const estado = await r.json()
    expect(estado.cuentas.map((c: { nombre: string }) => c.nombre)).toEqual(['Empresa'])
  })
})

describe('importar y deshacer', () => {
  it('importa por el mismo camino que la pantalla, y reimportar no duplica', async () => {
    const db = await base()
    const { POST } = await import('@/app/api/importar/route')

    const r1 = await POST(pedido('/api/importar', CLAVE, { method: 'POST', body: formulario() }))
    expect(r1.status).toBe(200)
    expect((await r1.json()).ok).toMatch(/3 movimiento/)

    await POST(pedido('/api/importar', CLAVE, { method: 'POST', body: formulario() }))
    const n = db.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE account_id = 'emp'`).get() as { n: number }
    expect(n.n).toBe(3)
  })

  it('importar sin clave no carga nada', async () => {
    const db = await base()
    const { POST } = await import('@/app/api/importar/route')
    const r = await POST(pedido('/api/importar', undefined, { method: 'POST', body: formulario() }))
    expect(r.status).toBe(401)
    expect((db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(0)
  })

  it('deshacer borra la importación y sus movimientos', async () => {
    const db = await base()
    const { POST: importar } = await import('@/app/api/importar/route')
    const { POST: deshacer } = await import('@/app/api/deshacer/route')
    await importar(pedido('/api/importar', CLAVE, { method: 'POST', body: formulario() }))
    const { id } = db.prepare('SELECT id FROM statements').get() as { id: string }

    const r = await deshacer(pedido('/api/deshacer', CLAVE, { method: 'POST', body: JSON.stringify({ id }) }))
    expect(r.status).toBe(200)
    expect((db.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n).toBe(0)
  })

  it('los movimientos de una cuenta muestran de qué archivo vino cada uno', async () => {
    await base()
    const { POST } = await import('@/app/api/importar/route')
    const { GET } = await import('@/app/api/movimientos/route')
    await POST(pedido('/api/importar', CLAVE, { method: 'POST', body: formulario() }))
    const r = await GET(pedido('/api/movimientos?cuenta=emp&desde=2026-10-01&hasta=2026-10-31', CLAVE))
    const { movimientos } = await r.json()
    expect(movimientos).toHaveLength(3)
    expect(movimientos.every((m: { archivo: string }) => m.archivo === 'movimientos.csv')).toBe(true)
  })
})
