import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { getDb, id, now } from '@/db/client'
import { generarSecreto, verificarCodigo } from './totp'

const COOKIE = 'finz_session'
const SESSION_DAYS = 30
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export interface User {
  id: string
  email: string
  name: string
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, SCRYPT.keylen, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, saltHex, hashHex] = parts
  const expected = Buffer.from(hashHex, 'hex')
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  })
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export function createUser(email: string, name: string, password: string): User {
  const db = getDb()
  const user = { id: id(), email: email.trim().toLowerCase(), name: name.trim() }
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(
    user.id,
    user.email,
    user.name,
    hashPassword(password),
    now(),
  )
  return user
}

export function authenticate(email: string, password: string): User | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as (User & { password_hash: string }) | undefined
  if (!row) {
    // Gasta el mismo tiempo con un usuario inexistente que con uno real.
    verifyPassword(password, hashPassword('dummy'))
    return null
  }
  if (!verifyPassword(password, row.password_hash)) return null
  return { id: row.id, email: row.email, name: row.name }
}

/**
 * Si la cookie de sesión viaja solo por HTTPS.
 *
 * En producción tiene que ser así, pero esta app suele correr en la red de
 * casa y se entra desde el celular por `http://192.168.x.x`. Una cookie
 * `Secure` en HTTP plano el navegador la descarta sin avisar: se ve el login,
 * se manda bien la clave, y la app rebota al login una y otra vez. Encima no
 * se nota probando en la misma máquina, porque `localhost` cuenta como
 * contexto seguro y ahí sí funciona.
 *
 * Por eso se puede desactivar a mano con `COOKIE_SECURE=false`. Hacelo solo en
 * una red en la que confíes: sin HTTPS, la sesión viaja en claro.
 */
function cookieIsSecure(): boolean {
  const forzado = process.env.COOKIE_SECURE
  if (forzado) return forzado.toLowerCase() === 'true'
  return process.env.NODE_ENV === 'production'
}

export function startSession(userId: string): string {
  const db = getDb()
  const sid = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString()
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    sid,
    userId,
    expires,
    now(),
  )
  cookies().set(COOKIE, sid, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(),
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  })
  return sid
}

export function endSession(): void {
  const sid = cookies().get(COOKIE)?.value
  if (sid) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sid)
  cookies().delete(COOKIE)
}

export function currentUser(): User | null {
  const sid = cookies().get(COOKIE)?.value
  if (!sid) return null
  const db = getDb()
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sid) as (User & { expires_at: string }) | undefined
  if (!row) return null
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sid)
    return null
  }
  return { id: row.id, email: row.email, name: row.name }
}

export function hasUsers(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return row.n > 0
}

// ------------------------------------------------------------------ 2FA

/**
 * Si la cuenta tiene el segundo factor activo.
 *
 * Se pregunta por id y no por el objeto de sesión porque hace falta saberlo
 * antes de que haya sesión: en medio del login, con la clave ya verificada.
 */
export function totpActivo(userId: string): boolean {
  const row = getDb().prepare('SELECT totp_enabled FROM users WHERE id = ?').get(userId) as
    | { totp_enabled: number }
    | undefined
  return row?.totp_enabled === 1
}

export function totpSecreto(userId: string): string {
  const row = getDb().prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as
    | { totp_secret: string }
    | undefined
  return row?.totp_secret ?? ''
}

/**
 * Prepara el segundo factor sin activarlo todavía.
 *
 * Guarda un secreto nuevo y deja `totp_enabled` en cero. Recién se activa
 * cuando la persona escribe un código válido: si se activara acá, un QR mal
 * escaneado la dejaría afuera de su propia cuenta sin manera de volver a
 * entrar. Regenerar el secreto en cada intento también evita que quede vivo el
 * de una configuración abandonada a medias.
 */
export function prepararTotp(userId: string): string {
  const secreto = generarSecreto()
  getDb().prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secreto, userId)
  return secreto
}

/** Activa el segundo factor si el código demuestra que el teléfono quedó bien. */
export function confirmarTotp(userId: string, codigo: string): boolean {
  const secreto = totpSecreto(userId)
  if (!secreto || !verificarCodigo(secreto, codigo)) return false
  getDb().prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId)
  return true
}

/**
 * Apaga el segundo factor, pero sólo con un código válido en la mano.
 *
 * Pedirlo para desactivar es lo que impide que alguien que se sentó frente a
 * una sesión abierta lo saque de un clic y deje la cuenta con la clave sola.
 */
export function desactivarTotp(userId: string, codigo: string): boolean {
  const secreto = totpSecreto(userId)
  if (!secreto || !verificarCodigo(secreto, codigo)) return false
  getDb().prepare("UPDATE users SET totp_enabled = 0, totp_secret = '' WHERE id = ?").run(userId)
  return true
}

export function verificarTotpDe(userId: string, codigo: string): boolean {
  const secreto = totpSecreto(userId)
  return Boolean(secreto) && verificarCodigo(secreto, codigo)
}
