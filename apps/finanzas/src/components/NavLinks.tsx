'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Tablero' },
  { href: '/facturas', label: 'Facturas' },
  { href: '/gastos', label: 'Gastos' },
  { href: '/importar', label: 'Importar' },
  { href: '/prestamos', label: 'Préstamos' },
  { href: '/rappi', label: 'Rappi' },
  { href: '/reportes', label: 'Reportes' },
  { href: '/config', label: 'Config' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    // min-w-0: sin esto el flex item se estira con los links y desborda en celular.
    <nav className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href)
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
              active ? 'bg-edge text-slate-100' : 'text-muted hover:text-slate-200'
            }`}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}
