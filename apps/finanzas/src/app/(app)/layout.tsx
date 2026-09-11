import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'
import { logoutAction } from '@/app/actions/auth'
import { NavLinks } from '@/components/NavLinks'
import { SelectorPais } from '@/components/SelectorPais'
import { vistaActual } from '@/lib/vista'

export const dynamic = 'force-dynamic'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const user = currentUser()
  if (!user) redirect('/login')
  const vista = vistaActual()

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-edge bg-ink/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/" className="text-sm font-semibold">
            Finanzas
          </Link>
          <NavLinks />
          <SelectorPais actual={vista.codigo} />
          <form action={logoutAction} className="flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline">{user.name}</span>
            <button type="submit" className="text-xs text-muted hover:text-slate-200">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
