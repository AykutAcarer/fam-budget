/** Küçük, ortak arayüz parçaları. */
import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10 ${className}`}
    >
      {children}
    </section>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">{children}</h2>
}

export function Spinner({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 p-8 text-slate-500 dark:text-slate-400">
      <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
    </header>
  )
}
