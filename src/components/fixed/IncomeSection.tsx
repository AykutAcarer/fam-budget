/**
 * Gelir bölümü: toplam / alınan / beklenen özeti, gün sıralı liste, alındı
 * anahtarı, ekle / düzenle. Rakamlar src/lib/income.ts'ten.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import type { IncomeRow } from '../../lib/database.types'
import { daysUntil, fixedStatus } from '../../lib/fixed'
import { formatEur } from '../../lib/format'
import { incomeTotals, sortIncome } from '../../lib/income'
import { PlusIcon } from '../icons'
import { Card } from '../ui'
import { OneOffBadge, PaidSwitch } from './PaidSwitch'
import { StatusBadge } from './StatusBadge'

interface Props {
  income: IncomeRow[]
  today: string
  pendingIds: ReadonlySet<string>
  onToggle: (row: IncomeRow) => void
  onEdit: (row: IncomeRow | null) => void
}

export function IncomeSection({ income, today, pendingIds, onToggle, onEdit }: Props) {
  const items = sortIncome(income)
  const totals = incomeTotals(items)

  return (
    <Card className="px-0 py-2">
      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <h2 className="text-base font-semibold">Gelir</h2>
        <button
          type="button"
          onClick={() => onEdit(null)}
          className="inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-600/30 hover:bg-emerald-50 dark:text-emerald-400 dark:ring-emerald-400/30 dark:hover:bg-emerald-950/40"
        >
          <PlusIcon className="size-4" strokeWidth={2.5} />
          Gelir ekle
        </button>
      </div>

      <dl className="mx-4 mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-2 text-center dark:bg-slate-800/60">
        {(
          [
            ['Toplam', totals.total, ''],
            ['Alınan', totals.received, 'text-emerald-700 dark:text-emerald-400'],
            ['Beklenen', totals.expected, 'text-amber-700 dark:text-amber-300'],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className={`text-sm font-semibold tabular-nums sm:text-base ${tone}`}>{formatEur(value)}</dd>
          </div>
        ))}
      </dl>

      {items.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-slate-500 dark:text-slate-400">
          Bu döngüde gelir kaydı yok. Maaşını ve yardımları ekle; toplam gelir burada ve ana ekranda görünsün.
        </p>
      ) : (
        <ul className="mt-2">
          {items.map((row) => {
            const d = dayjs(row.date).locale('tr')
            const status = fixedStatus({ date: row.date, paid: row.received }, today)
            return (
              <li key={row.id} className="flex items-center gap-2 border-t border-slate-100 px-2 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => onEdit(row)}
                  aria-label={`${row.source}, ${d.format('D MMMM')}, ${formatEur(row.amount)} — düzenle`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span
                    className={`flex w-11 shrink-0 flex-col items-center rounded-lg py-1 ${
                      row.received ? 'bg-slate-50 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500' : 'bg-emerald-50 dark:bg-emerald-950/40'
                    }`}
                  >
                    <span className="text-lg leading-tight font-bold tabular-nums">{d.format('D')}</span>
                    <span className="text-[10px] font-medium uppercase">{d.format('MMM')}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-medium ${row.received ? 'text-slate-500 dark:text-slate-400' : ''}`}>{row.source}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={status} days={daysUntil(row.date, today)} doneLabel="Alındı" />
                      {!row.recurring && <OneOffBadge />}
                    </span>
                    {row.note && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{row.note}</span>}
                  </span>
                  <span className={`shrink-0 font-semibold tabular-nums ${row.received ? 'text-slate-500 dark:text-slate-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    {formatEur(row.amount)}
                  </span>
                </button>
                <PaidSwitch
                  checked={row.received}
                  label={`${row.source}: ${row.received ? 'alındı' : 'alınmadı'}`}
                  pending={pendingIds.has(row.id)}
                  onToggle={() => onToggle(row)}
                />
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
