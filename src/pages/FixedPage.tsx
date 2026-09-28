/**
 * Sabit Giderler / Ödeme Takvimi (codex_prompt.md §6C).
 * Aktif döngünün sabit giderleri: özet, yaklaşan/gecikmiş şeridi, ödeme
 * günü sıralı liste, ödendi işaretleme, ekle/düzenle/sil. Tüm toplamlar ve
 * durumlar src/lib/fixed.ts'ten; bu ekran yalnızca gösterir.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useMemo, useState } from 'react'
import { FixedForm } from '../components/fixed/FixedForm'
import { StatusBadge, statusText } from '../components/fixed/StatusBadge'
import { useFixed } from '../components/fixed/useFixed'
import { CardIcon, CheckIcon, PlusIcon } from '../components/icons'
import { Card, CardTitle, PageHeader, Spinner } from '../components/ui'
import { todayIso } from '../lib/cycle'
import type { FixedExpenseRow } from '../lib/database.types'
import { alertItems, daysUntil, fixedStatus, fixedTotals, isCardSource, sortFixed } from '../lib/fixed'
import { formatEur } from '../lib/format'

type Editing = { row: FixedExpenseRow | null } | null

function PaidSwitch({ row, pending, onToggle }: { row: FixedExpenseRow; pending: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={row.paid}
      aria-label={`${row.item}: ${row.paid ? 'ödendi' : 'ödenecek'}`}
      onClick={onToggle}
      disabled={pending}
      className="flex min-h-11 min-w-11 items-center justify-center disabled:opacity-60"
    >
      <span
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          row.paid ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`inline-flex size-6 items-center justify-center rounded-full bg-white shadow transition-transform ${
            row.paid ? 'translate-x-5.5' : 'translate-x-0.5'
          }`}
        >
          {row.paid && <CheckIcon className="size-3.5 text-emerald-700" strokeWidth={3} />}
        </span>
      </span>
    </button>
  )
}

function ExtraBadges({ row }: { row: FixedExpenseRow }) {
  return (
    <>
      {isCardSource(row.source) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
          <CardIcon className="size-3.5" />
          kart
        </span>
      )}
      {row.installments_left !== null && (
        <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
          {row.installments_left === 0 ? 'son taksit' : `${row.installments_left} taksit kaldı`}
        </span>
      )}
    </>
  )
}

export function FixedPage() {
  const [today] = useState(todayIso)
  const { data, loadError, actionError, pendingIds, togglePaid, save, remove } = useFixed(today)
  const [editing, setEditing] = useState<Editing>(null)

  const items = useMemo(() => (data ? sortFixed(data.items) : []), [data])
  const totals = useMemo(() => fixedTotals(items), [items])
  const alerts = useMemo(() => alertItems(items, today), [items, today])

  if (!data && !loadError) return <Spinner />
  if (!data)
    return (
      <>
        <PageHeader title="Sabit Giderler" />
        <Card>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Veriler yüklenemedi: {loadError}
          </p>
        </Card>
      </>
    )

  const addButton = (
    <button
      type="button"
      onClick={() => setEditing({ row: null })}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
    >
      <PlusIcon className="size-4" strokeWidth={2.5} />
      Ekle
    </button>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Sabit Giderler" subtitle={`Ödeme takvimi · ${data.window.label}`} />
        {items.length > 0 && addButton}
      </div>

      {actionError && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {actionError}
        </p>
      )}

      {/* Özet */}
      <dl className="grid grid-cols-3 gap-2">
        {(
          [
            ['Toplam sabit', totals.total, 'text-slate-900 dark:text-slate-100'],
            ['Ödenen', totals.paid, 'text-emerald-700 dark:text-emerald-400'],
            ['Kalan', totals.remaining, 'text-amber-700 dark:text-amber-300'],
          ] as const
        ).map(([label, value, tone]) => (
          <Card key={label} className="p-3 text-center">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
            <dd className={`mt-0.5 text-base font-semibold tabular-nums sm:text-lg ${tone}`}>{formatEur(value)}</dd>
          </Card>
        ))}
      </dl>

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="text-base font-semibold">Bu döngüde henüz sabit gider yok</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Kira, faturalar, taksitler… Ödeme günleriyle ekle; yaklaşanları sana burada hatırlatayım.
          </p>
          <div className="mt-4 flex justify-center">{addButton}</div>
        </Card>
      ) : (
        <>
          {/* Yaklaşan / gecikmiş şeridi */}
          <Card>
            <CardTitle>Yaklaşan ve geciken ödemeler</CardTitle>
            {alerts.length === 0 ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckIcon className="size-4" strokeWidth={2.5} />
                Yaklaşan ödeme yok. Önümüzdeki 3 gün rahat. 🎉
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {alerts.map((row) => {
                  const status = fixedStatus(row, today)
                  const days = daysUntil(row.date, today)
                  const overdue = status === 'gecikmis'
                  return (
                    <li
                      key={row.id}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                        overdue
                          ? 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30'
                          : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{row.item}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={status} days={days} />
                          <span className="text-xs text-slate-600 dark:text-slate-300">
                            {dayjs(row.date).locale('tr').format('D MMM')}
                          </span>
                        </div>
                      </div>
                      <span className="font-semibold tabular-nums">{formatEur(row.amount)}</span>
                      <button
                        type="button"
                        onClick={() => void togglePaid(row)}
                        disabled={pendingIds.has(row.id)}
                        aria-label={`${row.item} ödendi olarak işaretle (${statusText(status, days)})`}
                        className="min-h-11 rounded-xl bg-white px-3 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-600/30 hover:bg-emerald-50 disabled:opacity-60 dark:bg-slate-900 dark:text-emerald-400 dark:ring-emerald-400/30"
                      >
                        Ödendi
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* Ödeme takvimi */}
          <Card className="px-0 py-2">
            <h2 className="px-4 pt-2 pb-1 text-sm font-semibold text-slate-500 dark:text-slate-400">Ödeme takvimi</h2>
            <ul>
              {items.map((row) => {
                const status = fixedStatus(row, today)
                const d = dayjs(row.date).locale('tr')
                return (
                  <li key={row.id} className="flex items-center gap-2 border-t border-slate-100 px-2 first:border-t-0 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setEditing({ row })}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      aria-label={`${row.item}, ${d.format('D MMMM')}, ${formatEur(row.amount)} — düzenle`}
                    >
                      <span
                        className={`flex w-11 shrink-0 flex-col items-center rounded-lg py-1 ${
                          row.paid ? 'bg-slate-50 text-slate-400 dark:bg-slate-800/60 dark:text-slate-500' : 'bg-slate-100 dark:bg-slate-800'
                        }`}
                      >
                        <span className="text-lg leading-tight font-bold tabular-nums">{d.format('D')}</span>
                        <span className="text-[10px] font-medium uppercase">{d.format('MMM')}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-medium ${row.paid ? 'text-slate-500 dark:text-slate-400' : ''}`}>
                          {row.item}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={status} days={daysUntil(row.date, today)} />
                          <ExtraBadges row={row} />
                        </span>
                      </span>
                      <span className={`shrink-0 font-semibold tabular-nums ${row.paid ? 'text-slate-500 dark:text-slate-400' : ''}`}>
                        {formatEur(row.amount)}
                      </span>
                    </button>
                    <PaidSwitch row={row} pending={pendingIds.has(row.id)} onToggle={() => void togglePaid(row)} />
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}

      {editing && (
        <FixedForm
          existing={editing.row}
          cycle={data.window}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </div>
  )
}
