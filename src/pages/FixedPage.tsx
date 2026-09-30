/**
 * Gelir + Sabit Giderler / Ödeme Takvimi (codex_prompt.md §6C). Gelir bölümü üstte.
 * Aktif döngünün sabit giderleri: özet, yaklaşan/gecikmiş şeridi, iki bölüm
 * ("Her Ay Düzenli Ödenenler" ve "Taksitler", her biri kendi toplamıyla),
 * ödendi işaretleme, ekle/düzenle/sil. Tüm toplamlar, gruplama ve durumlar
 * src/lib/fixed.ts'ten; bu ekran yalnızca gösterir.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useMemo, useState, type ReactNode } from 'react'
import { FixedForm } from '../components/fixed/FixedForm'
import { IncomeForm } from '../components/fixed/IncomeForm'
import { IncomeSection } from '../components/fixed/IncomeSection'
import { OneOffBadge, PaidSwitch } from '../components/fixed/PaidSwitch'
import { StatusBadge, statusText } from '../components/fixed/StatusBadge'
import { useFixed } from '../components/fixed/useFixed'
import { CardIcon, CheckIcon, PlusIcon } from '../components/icons'
import { Card, CardTitle, PageHeader, Spinner } from '../components/ui'
import { todayIso } from '../lib/cycle'
import type { FixedExpenseRow, IncomeRow } from '../lib/database.types'
import { alertItems, daysUntil, fixedStatus, fixedTotals, groupFixed, installmentBadgeText, installmentEndDate, isCardSource, sortFixed } from '../lib/fixed'
import { loadErrorText } from '../lib/loadError'
import { formatEur } from '../lib/format'
import { useReadOnly } from '../lib/useOnline'

type Editing = { row: FixedExpenseRow | null } | null

function ExtraBadges({ row }: { row: FixedExpenseRow }) {
  return (
    <>
      {isCardSource(row.source) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800 dark:bg-sky-950/60 dark:text-sky-200">
          <CardIcon className="size-3.5" />
          kart
        </span>
      )}
      {installmentBadgeText(row.installments_left, row.paid) && (
        <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950/60 dark:text-violet-200">
          {/* Saklanan kalan bu ayı da içerir; bu ay ödendiyse gösterilenden 1 düşülür (installmentsShown). */}
          {installmentBadgeText(row.installments_left, row.paid)}
        </span>
      )}
      {!row.recurring && <OneOffBadge />}
    </>
  )
}

/** Bir bölüm: başlık + aylık toplam + satırlar. */
function FixedGroupCard({
  title,
  totalLabel,
  total,
  rows,
  empty,
  renderRow,
}: {
  title: string
  totalLabel: string
  total: number
  rows: readonly FixedExpenseRow[]
  empty: string
  renderRow: (row: FixedExpenseRow) => ReactNode
}) {
  return (
    <Card className="px-0 py-2">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-2 pb-1">
        <h3 className="text-base font-bold tracking-tight">
          {title} <span className="text-sm font-medium text-slate-500 dark:text-slate-400">({rows.length})</span>
        </h3>
        <p className="text-right">
          <span className="block text-[11px] text-slate-500 dark:text-slate-400">{totalLabel}</span>
          <span className="font-semibold tabular-nums">{formatEur(total)}</span>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{empty}</p>
      ) : (
        <ul>{rows.map(renderRow)}</ul>
      )}
    </Card>
  )
}

export function FixedPage() {
  // Çevrimdışı: son görülen veri, salt okunur (fieldset tüm düğme ve alanları kapatır).
  const readOnly = useReadOnly()
  const [today] = useState(todayIso)
  const { data, loadError, actionError, pendingIds, togglePaid, save, remove, toggleReceived, saveIncome, removeIncome } = useFixed(today)
  const [editing, setEditing] = useState<Editing>(null)
  const [editingIncome, setEditingIncome] = useState<{ row: IncomeRow | null } | null>(null)

  const items = useMemo(() => (data ? sortFixed(data.items) : []), [data])
  const totals = useMemo(() => fixedTotals(items), [items])
  const alerts = useMemo(() => alertItems(items, today), [items, today])
  const groups = useMemo(() => groupFixed(items), [items])

  if (!data && !loadError) return <Spinner />
  if (!data)
    return (
      <>
        <PageHeader title="Gelir ve Sabit Giderler" />
        <Card>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadErrorText('veriler', loadError ?? '')}
          </p>
        </Card>
      </>
    )

  const renderRow = (row: FixedExpenseRow) => {
    const status = fixedStatus(row, today)
    const d = dayjs(row.date).locale('tr')
    const end = installmentEndDate(row.date, row.installments_left)
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
            <span className={`block truncate font-medium ${row.paid ? 'text-slate-500 dark:text-slate-400' : ''}`}>{row.item}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={status} days={daysUntil(row.date, today)} />
              <ExtraBadges row={row} />
            </span>
            {end && row.installments_left !== null && row.installments_left > 1 && (
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                Tahmini bitiş: {dayjs(end).locale('tr').format('MMMM YYYY')}
              </span>
            )}
          </span>
          <span className={`shrink-0 font-semibold tabular-nums ${row.paid ? 'text-slate-500 dark:text-slate-400' : ''}`}>
            {formatEur(row.amount)}
          </span>
        </button>
        <PaidSwitch
          checked={row.paid}
          label={`${row.item}: ${row.paid ? 'ödendi' : 'ödenecek'}`}
          pending={pendingIds.has(row.id)}
          onToggle={() => void togglePaid(row)}
        />
      </li>
    )
  }

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
    <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <PageHeader title="Gelir ve Sabit Giderler" subtitle={data.window.label} />

      {actionError && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {actionError}
        </p>
      )}

      <IncomeSection
        income={data.income}
        today={today}
        pendingIds={pendingIds}
        onToggle={(row) => void toggleReceived(row)}
        onEdit={(row) => setEditingIncome({ row })}
      />

      <div className="flex items-center justify-between gap-3 pt-2">
        <h2 className="text-lg font-bold tracking-tight">Sabit giderler</h2>
        {items.length > 0 && addButton}
      </div>

      {/* Sabit gider özeti */}
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

          {/* İki bölüm: her ay düzenli ödenenler ve taksitler (ayrı başlık + ayrı toplam) */}
          <FixedGroupCard
            title="Her Ay Düzenli Ödenenler"
            totalLabel="Aylık düzenli"
            total={groups.duzenliTotal}
            rows={groups.duzenli}
            empty="Düzenli ödeme yok."
            renderRow={renderRow}
          />
          <FixedGroupCard
            title="Taksitler"
            totalLabel="Aylık taksit yükü"
            total={groups.taksitTotal}
            rows={groups.taksit}
            empty="Taksit yok. 🎉"
            renderRow={renderRow}
          />
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
      {editingIncome && (
        <IncomeForm
          existing={editingIncome.row}
          cycle={data.window}
          onClose={() => setEditingIncome(null)}
          onSave={saveIncome}
          onDelete={removeIncome}
        />
      )}
    </fieldset>
  )
}
