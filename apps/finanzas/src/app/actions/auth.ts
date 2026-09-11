'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  authenticate,
  confirmarTotp,
  createUser,
  currentUser,
  desactivarTotp,
  endSession,
  hasUsers,
  prepararTotp,
  startSession,
  totpActivo,
  verificarTotpDe,
} from '@/lib/auth'
import { getDb } from '@/db/client'

export interface FormState {
  error?: string
  ok?: string
  /** El segundo paso: la clave ya se verificó y falta el código del teléfono. */
  pideCodigo?: boolean
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || !password) return { error: 'Faltan datos.' }

  const user = authenticate(email, password)
  if (!user) return { error: 'Email o contraseña incorrectos.' }

  if (totpActivo(user.id)) {
    const codigo = String(form.get('codigo') ?? '').trim()
    /*
     * La clave viaja de nuevo en el segundo envío y se vuelve a verificar
     * arriba. Es una comprobación de más, y es a propósito: la alternativa es
     * dejar al usuario a medio autenticar en una cookie o en el estado del
     * formulario, y ese estado intermedio es justo lo que un segundo factor
     * viene a evitar. Nada queda iniciado hasta que los dos factores están.
     */
    if (!codigo) return { pideCodigo: true }
    if (!verificarTotpDe(user.id, codigo)) {
      return { pideCodigo: true, error: 'El código no coincide. Fijate que sea el que muestra ahora el teléfono.' }
    }
  }

  startSession(user.id)
  redirect('/')
}

/**
 * Alta de usuario. Solo se permite en dos casos: cuando la base está vacía
 * (primer arranque) o cuando ya hay una sesión iniciada (para dar de alta a la
 * otra persona del hogar). Así la app puede quedar expuesta a internet sin
 * registro abierto.
 */
export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const bootstrapping = !hasUsers()
  if (!bootstrapping && !currentUser()) return { error: 'Necesitás iniciar sesión para dar de alta usuarios.' }

  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const name = String(form.get('name') ?? '').trim()
  const password = String(form.get('password') ?? '')

  if (!email.includes('@')) return { error: 'Email inválido.' }
  if (!name) return { error: 'Falta el nombre.' }
  if (password.length < 10) return { error: 'La contraseña necesita al menos 10 caracteres.' }

  const exists = getDb().prepare('SELECT 1 FROM users WHERE email = ?').get(email)
  if (exists) return { error: 'Ya existe un usuario con ese email.' }

  const user = createUser(email, name, password)
  if (bootstrapping) {
    startSession(user.id)
    redirect('/')
  }
  revalidatePath('/config')
  return { ok: `Usuario ${name} creado.` }
}

export async function logoutAction(): Promise<void> {
  endSession()
  redirect('/login')
}

export async function deleteUserAction(form: FormData): Promise<void> {
  const me = currentUser()
  if (!me) redirect('/login')
  const userId = String(form.get('userId') ?? '')
  if (userId === me.id) return
  getDb().prepare('DELETE FROM users WHERE id = ?').run(userId)
  revalidatePath('/config')
}


// ------------------------------------------------------------------ 2FA

export async function prepararTotpAction(): Promise<void> {
  const user = currentUser()
  if (!user) redirect('/login')
  prepararTotp(user.id)
  revalidatePath('/config')
}

export async function confirmarTotpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = currentUser()
  if (!user) redirect('/login')
  const codigo = String(form.get('codigo') ?? '')
  if (!confirmarTotp(user.id, codigo)) {
    return { error: 'El código no coincide. Probá con el que muestra el teléfono en este momento.' }
  }
  revalidatePath('/config')
  return { ok: 'Listo: de ahora en más el ingreso pide también el código del teléfono.' }
}

export async function desactivarTotpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = currentUser()
  if (!user) redirect('/login')
  const codigo = String(form.get('codigo') ?? '')
  if (!desactivarTotp(user.id, codigo)) {
    return { error: 'Hace falta un código válido para desactivarlo.' }
  }
  revalidatePath('/config')
  return { ok: 'Segundo factor desactivado. La cuenta queda sólo con la contraseña.' }
}
