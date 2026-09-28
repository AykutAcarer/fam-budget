/**
 * Kısılabilir dörtlü kıyas kartı: bu döngü (bugüne kadar) vs baz ay (aynı döngü
 * gününe kadar). Rakamlar compare.ts'ten gelir; burada hesap yapılmaz.
 */
import { Link } from 'react-router-dom'
import type { Comparison } from '../../lib/compare'
import { formatEur, formatSignedEur } from '../../lib/format'
import { Card, CardTitle } from '../ui'

interface Props {
  comparison: Comparison | null
  day: number
  baselineLabel: string | null
  /** Aktif döngü baz ayın kendisi mi? */
  activeIsBaseline: boolean
}

function Bar({ label, value, max, className }: { label: string; value: number; max: number; className: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 shrink-0 text-slate-500 dark:text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${max > 0 ? (value / max) * 100 : 0}%` }} />
      </div>
    </div>
  )
}

export function ComparisonCard({ comparison, day, baselineLabel, activeIsBaseline }: Props) {
  if (!comparison) {
    return (
      <Card>
        <CardTitle>Kısılabilir harcamalar · baz aya göre</CardTitle>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {activeIsBaseline ? (
            'Bu döngü baz ay olarak seçili. Kıyas bir sonraki döngüde başlayacak.'
          ) : (
            <>
              Baz ay seçili değil. Kıyas için{' '}
              <Link to="/ayarlar" className="font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
                Ayarlar
              </Link>
              ’dan baz ayı içeren verini içe aktarabilirsin.
            </>
          )}
        </p>
      </Card>
    )
  }

  const { dortluBuAy, dortluBazAy, fark } = comparison
  const ahead = fark < 0
  const behind = fark > 0
  const max = Math.max(dortluBuAy, dortluBazAy)
  const status = ahead
    ? 'text-emerald-800 dark:text-emerald-300'
    : behind
      ? 'text-rose-800 dark:text-rose-300'
      : 'text-slate-600 dark:text-slate-300'

  return (
    <Card>
      <CardTitle>Kısılabilir harcamalar · baz aya göre</CardTitle>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Kahvaltı + İş + Halı saha + Sosyal, {day}. güne kadar</p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 py-2.5 dark:bg-slate-800/60">
          <dt className="text-xs text-slate-500 dark:text-slate-400">Bu ay</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums sm:text-lg">{formatEur(dortluBuAy)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 py-2.5 dark:bg-slate-800/60">
          <dt className="text-xs text-slate-500 dark:text-slate-400">Baz ay</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums sm:text-lg">{formatEur(dortluBazAy)}</dd>
        </div>
        <div
          className={`rounded-xl py-2.5 ${status} ${
            ahead ? 'bg-emerald-50 dark:bg-emerald-950/50' : behind ? 'bg-rose-50 dark:bg-rose-950/50' : 'bg-slate-50 dark:bg-slate-800/60'
          }`}
        >
          <dt className="text-xs opacity-80">Fark</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums sm:text-lg">{formatSignedEur(fark)}</dd>
        </div>
      </dl>

      <div className="mt-3 space-y-1.5" aria-hidden="true">
        <Bar label="Bu ay" value={dortluBuAy} max={max} className={ahead ? 'bg-emerald-500' : behind ? 'bg-rose-500' : 'bg-slate-500'} />
        <Bar label="Baz ay" value={dortluBazAy} max={max} className="bg-slate-400 dark:bg-slate-500" />
      </div>

      <p className={`mt-3 text-sm font-medium ${status}`}>
        {ahead && <>🎯 Baz ayın {formatEur(-fark)} altındasın, harika gidiyorsun!</>}
        {behind && <>Baz ayın {formatEur(fark)} üstündesin. Ayın geri kalanında kısılabilir kalemlere biraz dikkat, yaparsın 💪</>}
        {!ahead && !behind && <>Baz ayla başa baş gidiyorsun.</>}
      </p>
      {baselineLabel && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Baz ay: {baselineLabel}</p>}
    </Card>
  )
}
