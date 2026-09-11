import { redirect } from 'next/navigation'
import { currentUser, hasUsers } from '@/lib/auth'
import { LoginForm } from './LoginForm'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  if (currentUser()) redirect('/')
  const bootstrap = !hasUsers()

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-xl font-semibold">Finanzas del hogar</h1>
      <p className="mt-1 text-sm text-muted">
        {bootstrap
          ? 'Primer arranque: creá tu usuario. Después vas a poder dar de alta el de tu esposa desde Configuración.'
          : 'Ingresá con tu email y contraseña.'}
      </p>
      <LoginForm bootstrap={bootstrap} />
    </main>
  )
}
