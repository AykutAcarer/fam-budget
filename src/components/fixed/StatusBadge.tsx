/** Ödeme durumu rozeti — renk + ikon + metin (yalnız renge dayanmaz). */
import type { FixedStatus } from '../../lib/fixed'
import { AlertIcon, CalendarIcon, CheckIcon, ClockIcon } from '../icons'

const STYLE: Record<FixedStatus, string> = {
  gecikmis: 'bg-red-50 text-red-800 dark:bg-red-950/60 dark:text-red-200',
  bugun: 'bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200',
  yaklasan: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  ileri: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  odendi: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
}

const ICON: Record<FixedStatus, typeof AlertIcon> = {
  gecikmis: AlertIcon,
  bugun: ClockIcon,
  yaklasan: ClockIcon,
  ileri: CalendarIcon,
  odendi: CheckIcon,
}

/** Rozet metni: "2 gün gecikti", "Bugün", "Yarın", "3 gün kaldı", "12 gün sonra", "Ödendi". */
export function statusText(status: FixedStatus, days: number): string {
  switch (status) {
    case 'odendi':
      return 'Ödendi'
    case 'gecikmis':
      return `${-days} gün gecikti`
    case 'bugun':
      return 'Bugün'
    case 'yaklasan':
      return days === 1 ? 'Yarın' : `${days} gün kaldı`
    case 'ileri':
      return `${days} gün sonra`
  }
}

export function StatusBadge({ status, days }: { status: FixedStatus; days: number }) {
  const Icon = ICON[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[status]}`}>
      <Icon className="size-3.5" strokeWidth={2.5} />
      {statusText(status, days)}
    </span>
  )
}
