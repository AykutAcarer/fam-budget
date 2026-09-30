/**
 * Borçlar (codex_prompt.md §6D). Toplamlar, sıralama ve vade durumu
 * src/lib/debts.ts'ten; bu ekran yalnızca gösterir.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useMemo, useState } from 'react'
import { DebtForm } from '../components/debts/DebtForm'
import { DebtPayments } from '../components/debts/DebtPayments'
import { useDebts } from '../components/debts/useDebts'
import { AlertIcon, CalendarIcon, ClockIcon, PlusIcon } from '../components/icons'
import { Card, PageHeader, Spinner } from '../components/ui'
import { todayIso } from '../lib/cycle'
import type { DebtPaymentRow, DebtRow } from '../lib/database.types'
import { paymentsByDebt } from '../lib/debtPayments'
import { debtTotals, dueStatus, nextPriority, sortDebts, type DueStatus } from '../lib/debts'
import { loadErrorText } from '../lib/loadError'
import { formatEur } from '../lib/format'
import { useReadOnly } from '../lib/useOnline'

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

interface CardProps {
  debt: DebtRow
  today: string
  paid: { count: number; total: number }
  onEdit: () => void
  onPayments: () => void
}

function DebtCard({ debt, today, paid, onEdit, onPayments }: CardProps) {
  const due = dueStatus(debt.due_date, today)
  return (
    <li className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`${debt.name}, öncelik ${debt.priority}, ${formatEur(debt.balance)} — düzenle`}
        className="block w-full p-4 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/70"
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
          <p className="shrink-0 text-lg font-bold tabular-nums">
            {formatEur(debt.balance)}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={onPayments}
        aria-label={`${debt.name} — ödemeler`}
        className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-slate-100 px-4 py-2 text-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/70"
      >
        <span className="font-semibold text-emerald-700 dark:text-emerald-400">{debt.balance > 0 ? 'Ödeme ekle · geçmiş' : 'Ödeme geçmişi'}</span>
        <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
          {paid.count > 0 ? `${paid.count} ödeme · ${formatEur(paid.total)} ödendi` : 'henüz ödeme yok'}
        </span>
      </button>
    </li>
  )
}

export function DebtsPage() {
  // Çevrimdışı: son görülen veri, salt okunur (fieldset tüm düğme ve alanları kapatır).
  const readOnly = useReadOnly()
  const [today] = useState(todayIso)
  const { debts, payments, loadError, save, remove, savePayment, removePayment } = useDebts()
  const [editing, setEditing] = useState<{ row: DebtRow | null } | null>(null)
  const [paying, setPaying] = useState<string | null>(null)
  const byDebt = useMemo(() => paymentsByDebt(payments), [payments])
  const noPayments: DebtPaymentRow[] = []
  const payingDebt = paying ? debts?.find((d) => d.id === paying) : undefined

  const sorted = useMemo(() => (debts ? sortDebts(debts) : []), [debts])
  const totals = useMemo(() => debtTotals(sorted), [sorted])

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
    <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-4 border-0 p-0">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Borçlar" subtitle="Öncelik sırasıyla" />
        {sorted.length > 0 && addButton('Ekle')}
      </div>

      <Card>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Toplam borç</p>
        <p className="mt-0.5 text-4xl font-bold tracking-tight tabular-nums">{formatEur(totals.total)}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Kredi kartı borcu ana ekrandaki kredi kartı bölümünde takip edilir.</p>
      </Card>

      {sorted.length === 0 ? (
        <Card className="text-center">
          <p className="text-base font-semibold">Kayıtlı borç yok 🎉</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Birine olan borçlar… Ekle; öncelik sırasıyla burada takip edelim.
          </p>
          <div className="mt-4 flex justify-center">{addButton('Borç ekle')}</div>
        </Card>
      ) : (
        <ul className="space-y-3">
          {sorted.map((d) => (
            <DebtCard
              key={d.id}
              debt={d}
              today={today}
              paid={{ count: byDebt.get(d.id)?.list.length ?? 0, total: byDebt.get(d.id)?.total ?? 0 }}
              onEdit={() => setEditing({ row: d })}
              onPayments={() => setPaying(d.id)}
            />
          ))}
        </ul>
      )}

      {payingDebt && (
        <DebtPayments
          debt={payingDebt}
          payments={byDebt.get(payingDebt.id)?.list ?? noPayments}
          today={today}
          onClose={() => setPaying(null)}
          onSave={savePayment}
          onDelete={removePayment}
        />
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
    </fieldset>
  )
}
