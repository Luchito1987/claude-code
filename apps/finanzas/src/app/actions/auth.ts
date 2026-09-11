'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { authenticate, createUser, currentUser, endSession, hasUsers, startSession } from '@/lib/auth'
import { getDb } from '@/db/client'

export interface FormState {
  error?: string
  ok?: string
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || !password) return { error: 'Faltan datos.' }

  const user = authenticate(email, password)
  if (!user) return { error: 'Email o contraseña incorrectos.' }
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
