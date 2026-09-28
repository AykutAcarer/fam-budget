/**
 * Borçlar (codex_prompt.md §6D). Toplamlar, sıralama ve vade durumu
 * src/lib/debts.ts'ten; bu ekran yalnızca gösterir.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useMemo, useState } from 'react'
import { DebtForm } from '../components/debts/DebtForm'
import { useDebts } from '../components/debts/useDebts'
import { AlertIcon, CalendarIcon, ClockIcon, PlusIcon } from '../components/icons'
import { Card, PageHeader, Spinner } from '../components/ui'
import { todayIso } from '../lib/cycle'
import type { DebtRow } from '../lib/database.types'
import { debtTotals, dueStatus, nextPriority, sortDebts, type DueStatus } from '../lib/debts'
import { loadErrorText } from '../lib/loadError'
import { formatEur } from '../lib/format'

/** 'YYYY-MM' → "Ocak 2027", 'YYYY-MM-DD' → "5 Ocak 2027". */
function formatDue(due: string): string {
  const d = dayjs(due.length === 7 ? `${due}-01` : due).locale('tr')
  return due.length === 7 ? d.format('MMMM YYYY') : d.format('D MMMM YYYY')
}

function DueBadge({ status }: { status: DueStatus }) {
  if (status.kind === 'gecti')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-200">
        <AlertIcon className="size-3.5" strokeWidth={2.5} />
        Vadesi geçti
      </span>
    )
  if (status.kind === 'yaklasiyor')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        <ClockIcon className="size-3.5" strokeWidth={2.5} />
        Vade yaklaşıyor · {status.days === 0 ? 'bugün' : `${status.days} gün`}
      </span>
    )
  return null
}

function DebtCard({ debt, payFirst, today, onEdit }: { debt: DebtRow; payFirst: boolean; today: string; onEdit: () => void }) {
  const due = dueStatus(debt.due_date, today)
  return (
    <li>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${debt.name}, öncelik ${debt.priority}, ${formatEur(debt.balance)} — düzenle`}
        className={`block w-full rounded-2xl bg-white p-4 text-left shadow-sm ring-1 transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/70 ${
          debt.has_interest
            ? 'border-l-4 border-red-500 ring-red-500/25 dark:border-red-400 dark:ring-red-400/25'
            : 'ring-slate-900/5 dark:ring-white/10'
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200"
            title="Öncelik"
          >
            {debt.priority}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{debt.name}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {payFirst && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                  <AlertIcon className="size-3.5" strokeWidth={2.5} />
                  Önce bunu öde
                </span>
              )}
              {debt.has_interest ? (
                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/60 dark:text-red-200">
                  Faiz {debt.interest ?? 'var'}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  faizsiz
                </span>
              )}
              {debt.due_date && (
                <span className="inline-flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                  <CalendarIcon className="size-3.5" />
                  Vade {formatDue(debt.due_date)}
                </span>
              )}
              <DueBadge status={due} />
            </div>
            {debt.note && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{debt.note}</p>}
          </div>
          <p className={`shrink-0 text-lg font-bold tabular-nums ${debt.has_interest ? 'text-red-700 dark:text-red-300' : ''}`}>
            {formatEur(debt.balance)}
          </p>
        </div>
      </button>
    </li>
  )
}

export function DebtsPage() {
  const [today] = useState(todayIso)
  const { debts, loadError, save, remove } = useDebts()
  const [editing, setEditing] = useState<{ row: DebtRow | null } | null>(null)

  const sorted = useMemo(() => (debts ? sortDebts(debts) : []), [debts])
  const totals = useMemo(() => debtTotals(sorted), [sorted])
  // "Önce bunu öde": en pahalı (listede ilk) faizli ve kapanmamış borç.
  const payFirstId = sorted.find((d) => d.has_interest && d.balance > 0)?.id

  if (!debts && !loadError) return <Spinner />
  if (!debts)
    return (
      <>
        <PageHeader title="Borçlar" />
        <Card>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadErrorText('borçlar', loadError ?? '')}
          </p>
        </Card>
      </>
    )

  const addButton = (label: string) => (
    <button
      type="button"
      onClick={() => setEditing({ row: null })}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
    >
      <PlusIcon className="size-4" strokeWidth={2.5} />
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Borçlar" subtitle="Faizliler önce, sonra öncelik sırası" />
        {sorted.length > 0 && addButton('Ekle')}
      </div>

      <Card>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Toplam borç</p>
        <p className="mt-0.5 text-4xl font-bold tracking-tight tabular-nums">{formatEur(totals.total)}</p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-red-500" aria-hidden="true" />
            <dt className="text-slate-500 dark:text-slate-400">Faizli</dt>
            <dd className="font-semibold text-red-700 tabular-nums dark:text-red-300">{formatEur(totals.interest)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-slate-400" aria-hidden="true" />
            <dt className="text-slate-500 dark:text-slate-400">Faizsiz</dt>
            <dd className="font-semibold tabular-nums">{formatEur(totals.interestFree)}</dd>
          </div>
        </dl>
      </Card>

      {sorted.length === 0 ? (
        <Card className="text-center">
          <p className="text-base font-semibold">Kayıtlı borç yok 🎉</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kredi kartı, taksitler, birine olan borçlar… Ekle; hangisini önce kapatman gerektiğini burada sıralayayım.
          </p>
          <div className="mt-4 flex justify-center">{addButton('Borç ekle')}</div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {sorted.map((d) => (
            <DebtCard key={d.id} debt={d} payFirst={d.id === payFirstId} today={today} onEdit={() => setEditing({ row: d })} />
          ))}
        </ul>
      )}

      {editing && (
        <DebtForm
          existing={editing.row}
          suggestedPriority={nextPriority(sorted)}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  )
}
