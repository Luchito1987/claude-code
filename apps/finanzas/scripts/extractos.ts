/**
 * Carga de extractos a la app publicada, por la API con clave.
 *
 * Es la herramienta de la habilidad "subir-extractos": identifica cada archivo,
 * lo valida con los mismos lectores que usa la app, mira qué hay ya cargado,
 * arma un plan, sube y después verifica. Las órdenes:
 *
 *   npm run extractos -- revisar   <archivos...>   local: qué es cada archivo y si cuadra
 *   npm run extractos -- estado                     qué hay cargado en la app
 *   npm run extractos -- plan      <archivos...>   qué subir, qué deshacer y qué omitir
 *   npm run extractos -- subir     <archivo> --destino "<nombre>" [--reemplazar]
 *   npm run extractos -- deshacer  <id de importación>
 *   npm run extractos -- verificar <archivos...>   saldos y duplicados después de subir
 *   npm run extractos -- patron    --destino "<tarjeta>" --texto "<cómo aparece su pago>"
 *   npm run extractos -- patron    --servicio "<servicio>" --texto "<cómo aparece su pago>"
 *   npm run extractos -- contrato  --servicio "<servicio>" --numero "<nº de contrato>"
 *   npm run extractos -- frecuencia --servicio "<servicio>" --cada mensual|bimestral|trimestral|semestral|anual --mes <1-12>
 *   npm run extractos -- conciliar                  cruza pagos de tarjeta con lo ya cargado
 *
 * Agregá --json para la salida completa. Lee FINANZAS_API_TOKEN (la clave) y
 * FINANZAS_URL (por defecto, la app publicada). `revisar` no necesita ninguna.
 */

import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseUploadedFile } from '../src/lib/parsers/input'
import { detectLayout } from '../src/lib/parsers/bancolombia'
import { decodeText } from '../src/lib/parsers/input'
import { extractPdfText, isPdf } from '../src/lib/parsers/pdf'
import { isSpreadsheet, readWorkbook } from '../src/lib/parsers/xlsx'
import { financialMonth } from '../src/lib/dates'

const URL_APP = (process.env.FINANZAS_URL ?? 'https://34.75.172.142.sslip.io').replace(/\/+$/, '')
const RAIZ = join(dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const DESTINOS = join(RAIZ, '.claude', 'skills', 'subir-extractos', 'destinos.json')

type Tipo = 'cuenta' | 'tarjeta'
type Formato = 'extracto' | 'movimientos' | 'consolidado' | 'resumen-tarjeta' | 'desconocido'

export interface Revision {
  archivo: string
  ruta: string
  tipo: Tipo | null
  formato: Formato
  digitos: string | null
  filas: number
  desde: string | null
  hasta: string | null
  /**
   * Lo que el archivo dice cubrir, que puede ir más allá de sus movimientos:
   * el extracto del 30/06 al 30/09 cubre septiembre entero aunque el último
   * movimiento sea del 15. Es lo que decide si reemplaza una carga anterior.
   */
  cubreDesde: string | null
  cubreHasta: string | null
  saldoFinalCents: number | null
  saldoFecha: string | null
  minimoCents: number | null
  totalCents: number | null
  vence: string | null
  cuadra: boolean | null
  avisos: string[]
}

const pesos = (c: number | null | undefined) =>
  c == null ? '—' : (c / 100).toLocaleString('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2 })
const ultimos4 = (s: string) => s.replace(/\D/g, '').slice(-4) || null
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- revisar

/** Qué es el archivo y de quién, mirando el contenido y no el nombre. */
type Identidad = { tipo: Tipo | null; formato: Formato; digitos: string | null; periodo?: [string, string] }

async function identificar(ruta: string, buf: Buffer): Promise<Identidad> {
  if (isPdf(ruta)) {
    const t = await extractPdfText(buf)
    const texto = typeof t === 'string' ? t : (t as { text: string }).text
    const tarjeta = /\*{4,}\s*(\d{4})/.exec(texto) ?? /\d{4}\s*\d{2}\*\*\s*\*{4}\s*(\d{4})/.exec(texto)
    if (/tarjeta de cr[eé]dito/i.test(texto)) return { tipo: 'tarjeta', formato: 'resumen-tarjeta', digitos: tarjeta?.[1] ?? null }
    return { tipo: null, formato: 'desconocido', digitos: tarjeta?.[1] ?? null }
  }
  if (isSpreadsheet(ruta)) {
    const filas = (await readWorkbook(buf)).flatMap((h) => h.rows)
    const tarjeta = filas.flat().map((c) => /^\*{6,}(\d{4})$/.exec(c.trim())).find(Boolean)
    if (tarjeta) return { tipo: 'tarjeta', formato: 'resumen-tarjeta', digitos: tarjeta[1] }
    const iCuenta = filas.findIndex((r) => r.some((c) => norm(c) === 'nro cuenta'))
    if (iCuenta !== -1) {
      const col = filas[iCuenta].findIndex((c) => norm(c) === 'nro cuenta')
      const valores = filas[iCuenta + 1] ?? []
      const iso = (s?: string) => (s ?? '').trim().replace(/^(\d{4})[/-](\d{2})[/-](\d{2})$/, '$1-$2-$3')
      const periodo: [string, string] = [iso(valores[0]), iso(valores[1])]
      return { tipo: 'cuenta', formato: 'extracto', digitos: ultimos4(valores[col] ?? ''), periodo }
    }
    const cab = filas[0]?.map(norm) ?? []
    if (cab.includes('fecha') && cab.includes('valor')) return { tipo: 'cuenta', formato: 'movimientos', digitos: null }
    return { tipo: null, formato: 'desconocido', digitos: null }
  }
  const texto = decodeText(buf)
  const layout = detectLayout(texto)
  if (layout) {
    const primera = texto.split(/\r?\n/).find((l) => l.trim())!.split(',').map((c) => c.trim())
    const numero = layout.name === 'consolidado' ? primera[1] : primera[0]
    return { tipo: 'cuenta', formato: layout.name === 'consolidado' ? 'consolidado' : 'movimientos', digitos: ultimos4(numero) }
  }
  return { tipo: null, formato: 'desconocido', digitos: null }
}

export async function revisar(ruta: string): Promise<Revision> {
  const buf = readFileSync(ruta)
  const id = await identificar(ruta, buf)
  const r = (await parseUploadedFile(basename(ruta), buf, {
    kind: id.tipo === 'tarjeta' ? 'card' : 'account',
    currency: 'COP',
    fallbackYear: Number(new Date().getFullYear()),
  })) as Awaited<ReturnType<typeof parseUploadedFile>> & {
    statementMinimumCents?: number
    statementTotalCents?: number
    statementDueDate?: string
  }
  const fechas = r.rows.map((x) => x.date).sort()
  const avisos = [...(r.warnings ?? [])].filter((w) => !/^Hoja "|^\s{2}/.test(w))
  let cuadra: boolean | null = null
  if (!r.rows.length) {
    avisos.unshift('No se reconoció ningún movimiento: este formato todavía no lo lee la app.')
  } else if (id.tipo === 'cuenta' && r.finalBalanceCents != null && id.formato === 'extracto') {
    cuadra = !avisos.some((w) => /no cierra/.test(w))
  } else if (id.tipo === 'tarjeta' && r.statementMinimumCents) {
    const cargos = -r.rows.filter((x) => x.amountCents < 0).reduce((a, x) => a + x.amountCents, 0)
    cuadra = cargos === r.statementMinimumCents
    if (!cuadra) avisos.push(`Los cargos suman ${pesos(cargos)} y el mínimo impreso es ${pesos(r.statementMinimumCents)}.`)
  }
  const { periodo: _periodo, ...identidad } = id
  return {
    archivo: basename(ruta),
    ruta,
    ...identidad,
    filas: r.rows.length,
    desde: fechas[0] ?? null,
    hasta: fechas.at(-1) ?? null,
    cubreDesde: id.periodo?.[0] ?? fechas[0] ?? null,
    cubreHasta: id.periodo?.[1] ?? fechas.at(-1) ?? null,
    saldoFinalCents: r.finalBalanceCents ?? null,
    saldoFecha: r.finalBalanceDate ?? null,
    minimoCents: r.statementMinimumCents ?? null,
    totalCents: r.statementTotalCents ?? null,
    vence: r.statementDueDate ?? null,
    cuadra,
    avisos,
  }
}

// ---------------------------------------------------------------- API

function clave(): string {
  const c = process.env.FINANZAS_API_TOKEN
  if (!c) {
    throw new Error(
      'Falta FINANZAS_API_TOKEN. La clave se configura como secreto del entorno; en el servidor se ve con: sudo cat /etc/finanzas/api-token',
    )
  }
  return c
}

async function api<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(URL_APP + ruta, { ...init, headers: { authorization: `Bearer ${clave()}`, ...(init.headers ?? {}) } })
  const cuerpo = (await r.json().catch(() => ({}))) as T & { error?: string }
  if (r.status === 401) throw new Error('La app rechazó la clave (401). Revisá FINANZAS_API_TOKEN contra /etc/finanzas/api-token.')
  if (!r.ok && r.status !== 422) throw new Error(`${ruta}: HTTP ${r.status} ${cuerpo.error ?? ''}`)
  return cuerpo
}

interface Estado {
  hoy: string
  cuentas: Array<{ id: string; nombre: string; saldoCents: number; anclaCents: number; anclaFecha: string | null }>
  tarjetas: Array<{ id: string; nombre: string }>
  importaciones: Array<{
    id: string; tipo: string; destino: string; cuentaId: string | null; tarjetaId: string | null
    archivo: string; periodo: string; filas: number; importado: string; desde: string | null; hasta: string | null; movimientos: number
  }>
}

const estado = () => api<Estado>('/api/estado')

function destinos(): Record<string, { tipo: Tipo; nombre: string }> {
  try {
    return JSON.parse(readFileSync(DESTINOS, 'utf8'))
  } catch {
    return {}
  }
}

/** El nombre en la app que corresponde a un archivo, por sus últimos cuatro dígitos. */
function resolver(rev: Revision, e: Estado, forzado?: string) {
  const nombre = forzado ?? (rev.digitos ? destinos()[rev.digitos]?.nombre : undefined)
  if (!nombre) return null
  const lista = rev.tipo === 'tarjeta' ? e.tarjetas : e.cuentas
  const exacto = lista.find((x) => norm(x.nombre) === norm(nombre))
  const parecidos = lista.filter((x) => norm(x.nombre).includes(norm(nombre)))
  return exacto ?? (parecidos.length === 1 ? parecidos[0] : null)
}

// ---------------------------------------------------------------- plan

type Accion =
  | { accion: 'subir'; archivo: string; ruta: string; destino: string; tipo: Tipo; porque: string; reemplazar?: boolean }
  | { accion: 'deshacer'; id: string; archivo: string; destino: string; porque: string }
  | { accion: 'omitir'; archivo: string; porque: string }
  | { accion: 'preguntar'; archivo: string; porque: string }

type Rango = { desde: string | null; hasta: string | null }
const cobertura = (r: Revision): Rango => ({ desde: r.cubreDesde, hasta: r.cubreHasta })
const pisa = (a: Rango, b: Rango) => !!(a.desde && a.hasta && b.desde && b.hasta && a.desde <= b.hasta && b.desde <= a.hasta)
const adentro = (de: Rango, en: Rango) =>
  !!(de.desde && de.hasta && en.desde && en.hasta && de.desde >= en.desde && de.hasta <= en.hasta)

async function plan(rutas: string[], forzados: Record<string, string>): Promise<Accion[]> {
  const e = await estado()
  const revs = await Promise.all(rutas.map(revisar))
  const acciones: Accion[] = []
  const tarjetas: Accion[] = []
  const porCuenta = new Map<string, Accion[]>()

  for (const r of revs) {
    if (!r.filas) {
      acciones.push({ accion: 'omitir', archivo: r.archivo, porque: r.avisos[0] ?? 'No se reconoció.' })
      continue
    }
    if (r.cuadra === false) {
      acciones.push({ accion: 'preguntar', archivo: r.archivo, porque: `No cuadra: ${r.avisos.join(' ')}` })
      continue
    }
    const d = resolver(r, e, forzados[r.archivo])
    if (!d) {
      acciones.push({
        accion: 'preguntar',
        archivo: r.archivo,
        porque: r.digitos
          ? `No sé a qué ${r.tipo ?? 'destino'} de la app corresponde el número terminado en ${r.digitos}. Agregalo a destinos.json.`
          : `El archivo no trae número de ${r.tipo ?? 'cuenta'}: hay que decir de quién es (--destino).`,
      })
      continue
    }
    if (r.tipo === 'tarjeta') {
      // La app admite un resumen por tarjeta y ciclo, y el ciclo es el mes
      // financiero del vencimiento. Si ya hay uno, el extracto completo
      // reemplaza a la carga anterior (típicamente movimientos sueltos).
      const ciclo = r.vence ? financialMonth(r.vence) : null
      const previo = ciclo ? e.importaciones.find((i) => i.tarjetaId === d.id && i.periodo === ciclo) : undefined
      tarjetas.push({
        accion: 'subir', archivo: r.archivo, ruta: r.ruta, destino: d.nombre, tipo: 'tarjeta',
        porque: previo
          ? `resumen que vence el ${r.vence}; reemplaza a "${previo.archivo}" (${previo.movimientos} movimientos) del mismo ciclo`
          : `resumen que vence el ${r.vence ?? '?'}`,
        ...(previo ? { reemplazar: true } : {}),
      })
      continue
    }

    const lista = porCuenta.get(d.nombre) ?? []
    porCuenta.set(d.nombre, lista)
    // Un consolidado del mismo período que un extracto del lote es redundante:
    // trae los mismos movimientos, escritos un poco distinto, y duplica.
    if (r.formato === 'consolidado' && revs.some((o) => o.formato === 'extracto' && o.digitos === r.digitos && adentro(cobertura(r), cobertura(o)))) {
      acciones.push({ accion: 'omitir', archivo: r.archivo, porque: 'Mismo período que el extracto del lote: duplicaría.' })
      continue
    }
    const previas = e.importaciones.filter((i) => i.cuentaId === d.id && pisa(i, cobertura(r)))
    for (const p of previas) {
      if (r.formato === 'extracto' && adentro(p, cobertura(r))) {
        if (!lista.some((a) => a.accion === 'deshacer' && a.id === p.id))
          lista.push({ accion: 'deshacer', id: p.id, archivo: p.archivo, destino: d.nombre, porque: `queda cubierta entera por ${r.archivo}` })
      } else {
        acciones.push({
          accion: 'preguntar',
          archivo: r.archivo,
          porque: `Se pisa con "${p.archivo}" (${p.desde} → ${p.hasta}, ${p.movimientos} movimientos) y no la cubre entera.`,
        })
      }
    }
    if (!acciones.some((a) => a.accion === 'preguntar' && a.archivo === r.archivo))
      lista.push({ accion: 'subir', archivo: r.archivo, ruta: r.ruta, destino: d.nombre, tipo: 'cuenta', porque: `${r.formato}, ${r.desde} → ${r.hasta}` })
  }

  // Orden: tarjetas primero (los pagos de las cuentas se concilian contra sus
  // resúmenes); en cada cuenta, deshacer lo reemplazado, después los
  // movimientos sueltos y al final el extracto, que fija el saldo contando lo
  // que ya está cargado después de su corte.
  const ordenCuenta = (a: Accion) =>
    a.accion === 'deshacer' ? 0 : a.accion === 'subir' && !/^extracto/.test(a.porque) ? 1 : 2
  return [
    ...tarjetas,
    ...[...porCuenta.values()].flatMap((l) => l.sort((a, b) => ordenCuenta(a) - ordenCuenta(b))),
    ...acciones,
  ]
}

// ---------------------------------------------------------------- subir / verificar

async function subir(ruta: string, destino: string, reemplazar: boolean) {
  const e = await estado()
  const rev = await revisar(ruta)
  const d = resolver(rev, e, destino)
  if (!d) throw new Error(`No hay ${rev.tipo ?? 'destino'} llamado "${destino}" en la app.`)
  const form = new FormData()
  form.set('file', new File([readFileSync(ruta)], basename(ruta)))
  form.set('kind', rev.tipo === 'tarjeta' ? 'card' : 'account')
  form.set('target', d.id)
  if (reemplazar) form.set('reemplazar', 'si')
  return api<{ ok?: string; error?: string; detail?: string[]; conflict?: unknown }>('/api/importar', { method: 'POST', body: form })
}

async function verificar(rutas: string[], forzados: Record<string, string> = {}) {
  const e = await estado()
  const revs = await Promise.all(rutas.map(revisar))
  const salida: string[] = []
  const cuentas = new Map<string, Revision[]>()
  for (const r of revs.filter((x) => x.tipo === 'cuenta' && x.filas && x.formato !== 'consolidado')) {
    const d = resolver(r, e, forzados[r.archivo])
    if (d) cuentas.set(d.nombre, [...(cuentas.get(d.nombre) ?? []), r])
    else salida.push(`??  ${r.archivo}: no sé de qué cuenta es; pasalo con --destinos`)
  }
  for (const [nombre, archivos] of cuentas) {
    const c = e.cuentas.find((x) => x.nombre === nombre)!
    const ext = archivos.find((r) => r.saldoFinalCents != null)
    if (ext) {
      // Saldo esperado: el del extracto más los movimientos de los archivos posteriores.
      let esperado = ext.saldoFinalCents!
      for (const r of archivos.filter((x) => x !== ext)) {
        const p = await parseUploadedFile(r.archivo, readFileSync(r.ruta), { kind: 'account', currency: 'COP' })
        esperado += p.rows.filter((x) => x.date > ext.saldoFecha!).reduce((a, x) => a + x.amountCents, 0)
      }
      const ok = esperado === c.saldoCents
      salida.push(`${ok ? 'OK ' : 'MAL'} ${nombre}: la app dice ${pesos(c.saldoCents)}, los archivos dan ${pesos(esperado)}` +
        `${c.anclaFecha ? ` (ancla ${pesos(c.anclaCents)} al ${c.anclaFecha})` : ' (sin ancla)'}`)
    }
    // Duplicados: movimientos que en la app aparecen más veces que en los archivos.
    const desde = archivos.map((r) => r.desde!).sort()[0]
    const hasta = archivos.map((r) => r.hasta!).sort().at(-1)!
    const { movimientos } = await api<{ movimientos: Array<{ fecha: string; descripcion: string; importeCents: number; archivo: string | null }> }>(
      `/api/movimientos?cuenta=${c.id}&desde=${desde}&hasta=${hasta}`,
    )
    const enApp = new Map<string, number>()
    for (const m of movimientos) {
      const k = `${m.fecha}|${m.importeCents}`
      enApp.set(k, (enApp.get(k) ?? 0) + 1)
    }
    const enArchivos = new Map<string, number>()
    for (const r of archivos) {
      const p = await parseUploadedFile(r.archivo, readFileSync(r.ruta), { kind: 'account', currency: 'COP' })
      const local = new Map<string, number>()
      for (const x of p.rows) local.set(`${x.date}|${x.amountCents}`, (local.get(`${x.date}|${x.amountCents}`) ?? 0) + 1)
      for (const [k, n] of local) enArchivos.set(k, Math.max(enArchivos.get(k) ?? 0, n))
    }
    const sobran = [...enApp].filter(([k, n]) => n > (enArchivos.get(k) ?? 0))
    salida.push(sobran.length
      ? `    ${sobran.length} movimiento(s) de ${nombre} aparecen más veces en la app que en los archivos: ${sobran.slice(0, 5).map(([k]) => k).join(', ')}`
      : `    sin duplicados en ${desde} → ${hasta} (${movimientos.length} movimientos)`)
  }
  return salida
}

// ---------------------------------------------------------------- CLI

async function main() {
  const [orden, ...resto] = process.argv.slice(2)
  const json = resto.includes('--json')
  const valor = (n: string) => { const i = resto.indexOf(`--${n}`); return i !== -1 ? resto[i + 1] : undefined }
  const archivos = resto.filter((a, i) => !a.startsWith('--') && !/^--(destinos?|texto|servicio|numero|cada|mes)$/.test(resto[i - 1] ?? ''))
  const imprimir = (x: unknown) => console.log(JSON.stringify(x, null, 2))
  // "archivo.xlsx=Luciano Blanco;otro.csv=Ines Petro": de quién es cada archivo
  // que no trae el número de cuenta adentro.
  const forzados: Record<string, string> = Object.fromEntries(
    (valor('destinos') ?? '').split(';').filter(Boolean).map((p) => p.split('=').map((x) => x.trim()) as [string, string]),
  )

  switch (orden) {
    case 'revisar': {
      const revs = await Promise.all(archivos.map(revisar))
      if (json) return imprimir(revs)
      for (const r of revs) {
        console.log(`\n${r.archivo}\n  ${r.tipo ?? '¿?'} · ${r.formato} · termina en ${r.digitos ?? '—'} · ${r.filas} movimientos · ${r.desde ?? '—'} → ${r.hasta ?? '—'}`)
        if (r.cubreDesde !== r.desde || r.cubreHasta !== r.hasta) console.log(`  cubre ${r.cubreDesde} → ${r.cubreHasta}`)
        if (r.saldoFinalCents != null) console.log(`  saldo ${pesos(r.saldoFinalCents)} al ${r.saldoFecha}`)
        if (r.minimoCents != null) console.log(`  mínimo ${pesos(r.minimoCents)} · total ${pesos(r.totalCents)} · vence ${r.vence}`)
        console.log(`  cuadra: ${r.cuadra === null ? 'no aplica' : r.cuadra ? 'sí' : 'NO'}`)
        for (const a of r.avisos) console.log(`  ! ${a}`)
      }
      return
    }
    case 'estado': {
      const e = await estado()
      if (json) return imprimir(e)
      console.log(`Hoy: ${e.hoy}\n\nCuentas:`)
      for (const c of e.cuentas) console.log(`  ${c.nombre.padEnd(24)} ${pesos(c.saldoCents).padStart(20)}  ancla ${c.anclaFecha ?? '—'}`)
      console.log(`\nTarjetas: ${e.tarjetas.map((t) => t.nombre).join(', ')}`)
      const ext = e as Estado & {
        servicios?: Array<{ nombre: string; contrato: string; patronPago: string; esperadoCents: number; dia: number; activo: number }>
        facturas?: Array<{ servicio: string; periodo: string; importeCents: number; vence: string; estado: string }>
      }
      console.log('\nServicios (patrón de pago):')
      for (const s of ext.servicios ?? [])
        if (s.activo) console.log(`  ${s.nombre.padEnd(24)} ${pesos(s.esperadoCents).padStart(16)}  día ${String(s.dia).padStart(2)}  ${(s.patronPago || '— sin patrón').padEnd(22)} ${s.contrato ? `contrato ${s.contrato}` : ''}`)
      console.log('\nFacturas pendientes:')
      for (const f of (ext.facturas ?? []).filter((f) => f.estado !== 'pagado')) console.log(`  ${f.periodo}  ${f.servicio.padEnd(24)} ${pesos(f.importeCents).padStart(16)}  vence ${f.vence}`)
      console.log('\nImportaciones:')
      for (const i of e.importaciones)
        console.log(`  ${i.id}  ${i.destino?.padEnd(20) ?? ''} ${i.archivo.slice(0, 50).padEnd(50)} ${i.desde ?? '—'} → ${i.hasta ?? '—'} (${i.movimientos})`)
      return
    }
    case 'plan': {
      const p = await plan(archivos, forzados)
      if (json) return imprimir(p)
      p.forEach((a, n) => {
        const que = a.accion === 'subir' ? `SUBIR    ${a.archivo} → ${a.destino}${a.reemplazar ? ' (--reemplazar)' : ''}` : a.accion === 'deshacer' ? `DESHACER ${a.archivo} (${a.destino}, id ${a.id})` : `${a.accion.toUpperCase().padEnd(8)} ${a.archivo}`
        console.log(`${String(n + 1).padStart(2)}. ${que}\n      ${a.porque}`)
      })
      return
    }
    case 'subir': {
      const destino = valor('destino')
      if (!archivos[0] || !destino) throw new Error('Uso: subir <archivo> --destino "<nombre en la app>" [--reemplazar]')
      return imprimir(await subir(archivos[0], destino, resto.includes('--reemplazar')))
    }
    case 'deshacer': {
      if (!archivos[0]) throw new Error('Uso: deshacer <id de importación>')
      return imprimir(await api('/api/deshacer', { method: 'POST', body: JSON.stringify({ id: archivos[0] }), headers: { 'content-type': 'application/json' } }))
    }
    case 'patron': {
      const destino = valor('destino'), texto = valor('texto'), servicio = valor('servicio')
      if (servicio && texto)
        return imprimir(await api('/api/servicios', { method: 'POST', body: JSON.stringify({ servicio, patronPago: texto }), headers: { 'content-type': 'application/json' } }))
      if (!destino || !texto) throw new Error('Uso: patron --destino "<tarjeta>" --texto "<cómo aparece su pago en el extracto>"')
      return imprimir(await api('/api/tarjetas', { method: 'POST', body: JSON.stringify({ tarjeta: destino, patronPago: texto }), headers: { 'content-type': 'application/json' } }))
    }
    case 'contrato': {
      const servicio = valor('servicio'), numero = valor('numero')
      if (!servicio || !numero) throw new Error('Uso: contrato --servicio "<servicio>" --numero "<nº de contrato>"')
      return imprimir(await api('/api/servicios', { method: 'POST', body: JSON.stringify({ servicio, numeroContrato: numero }), headers: { 'content-type': 'application/json' } }))
    }
    case 'frecuencia': {
      const servicio = valor('servicio'), cada = valor('cada'), mes = Number(valor('mes') ?? 1)
      if (!servicio || !cada) throw new Error('Uso: frecuencia --servicio "<servicio>" --cada <frecuencia> --mes <1-12>')
      return imprimir(await api('/api/servicios', { method: 'POST', body: JSON.stringify({ servicio, frecuencia: cada, mesAncla: mes }), headers: { 'content-type': 'application/json' } }))
    }
    case 'conciliar': {
      const r = await api<{
        conciliados: Array<{ card: string; period: string; cents: number; nuevos: number }>
        facturas: Array<{ servicio: string; periodo: string; pagadoCents: number; antesCents: number | null; fecha: string }>
      }>('/api/conciliar', { method: 'POST' })
      if (json) return imprimir(r)
      if (!r.conciliados.length && !r.facturas.length) return console.log('Nada nuevo para conciliar.')
      for (const c of r.conciliados) console.log(`  tarjeta  ${c.card.padEnd(18)} ${c.period}  pagado ${pesos(c.cents).padStart(18)}  (${c.nuevos} pago(s) enlazado(s) ahora)`)
      for (const f of r.facturas)
        console.log(`  factura  ${f.servicio.padEnd(18)} ${f.periodo}  pagada ${pesos(f.pagadoCents).padStart(18)} el ${f.fecha}${f.antesCents != null ? `  (estaba en ${pesos(f.antesCents)})` : ''}`)
      return
    }
    case 'verificar':
      for (const l of await verificar(archivos, forzados)) console.log(l)
      return
    default:
      console.log(readFileSync(new URL(import.meta.url).pathname, 'utf8').split('*/')[0])
  }
}

main().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})
