/**
 * Borç ödemeleri: kalan bakiye, toplam ödenen, "Ödeme ekle" formu ve geçmiş.
 * Ödeme eklemek / silmek / düzenlemek bakiyeyi veritabanında aynı işlemde
 * günceller (tetikleyici). Sınır ve önizleme src/lib/debtPayments.ts'te.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DebtPaymentRow, DebtRow } from '../../lib/database.types'
import {
  balanceAfter,
  maxPayment,
  totalPaid,
  validatePaymentForm,
  type PaymentFormInput,
  type PaymentFormValue,
} from '../../lib/debtPayments'
import { parseBalance } from '../../lib/debts'
import { formatAmountInput, formatEur } from '../../lib/format'
import { inputClass } from '../ui'

interface Props {
  debt: DebtRow
  /** Bu borcun ödemeleri, en yeni önce. */
  payments: readonly DebtPaymentRow[]
  today: string
  onClose: () => void
  onSave: (debtId: string, existing: DebtPaymentRow | null, value: PaymentFormValue) => Promise<void>
  onDelete: (row: DebtPaymentRow) => Promise<void>
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

const formatDate = (iso: string) => dayjs(iso).locale('tr').format('D MMMM YYYY')

export function DebtPayments({ debt, payments, today, onClose, onSave, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const empty = (): PaymentFormInput => ({ date: today, amount: '', note: '' })
  const [input, setInput] = useState<PaymentFormInput>(empty)
  const [editing, setEditing] = useState<DebtPaymentRow | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof PaymentFormInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const editingAmount = editing?.amount ?? 0
  const max = maxPayment(debt.balance, editingAmount)
  const typed = parseBalance(input.amount)
  const preview = typed && typed > 0 && typed <= max ? balanceAfter(debt.balance, typed, editingAmount) : null
  const paid = totalPaid(payments)

  const set = <K extends keyof PaymentFormInput>(key: K, value: PaymentFormInput[K]) => {
    setInput((s) => ({ ...s, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function startEdit(p: DebtPaymentRow) {
    setEditing(p)
    setConfirmId(null)
    setNotice(null)
    setSubmitError(null)
    setErrors({})
    setInput({ date: p.date, amount: formatAmountInput(p.amount), note: p.note ?? '' })
  }

  function resetForm() {
    setEditing(null)
    setErrors({})
    setInput(empty())
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validatePaymentForm(input, max, today)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      await onSave(debt.id, editing, result.value)
      setNotice(editing ? 'Ödeme güncellendi.' : `${formatEur(result.value.amount)} ödeme kaydedildi.`)
      resetForm()
    } catch (err) {
      setSubmitError(`Kaydedilemedi: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: DebtPaymentRow) {
    setBusy(true)
    setSubmitError(null)
    try {
      await onDelete(p)
      setConfirmId(null)
      if (editing?.id === p.id) resetForm()
      setNotice(`${formatEur(p.amount)} ödeme silindi; bakiyeye geri eklendi.`)
    } catch (err) {
      setSubmitError(`Silinemedi: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const err = (key: keyof PaymentFormInput) =>
    errors[key] ? (
      <span id={`pay-${key}-error`} className="mt-1 block text-xs text-red-600 dark:text-red-400">
        {errors[key]}
      </span>
    ) : null
  const aria = (key: keyof PaymentFormInput) => ({
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `pay-${key}-error` : undefined,
  })

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="pay-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 id="pay-title" className="text-lg font-bold">
            {debt.name} · ödemeler
          </h2>
          <button type="button" onClick={onClose} className="-mt-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
            Kapat
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
            <dt className="text-xs text-slate-500 dark:text-slate-400">Kalan bakiye</dt>
            <dd className="text-lg font-bold tabular-nums">{formatEur(debt.balance)}</dd>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-950/40">
            <dt className="text-xs text-emerald-800 dark:text-emerald-300">Toplam ödenen</dt>
            <dd className="text-lg font-bold text-emerald-800 tabular-nums dark:text-emerald-200">{formatEur(paid)}</dd>
          </div>
        </dl>

        {notice && (
          <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
            {notice}
          </p>
        )}

        <form onSubmit={onSubmit} noValidate className="space-y-3 rounded-2xl p-3 ring-1 ring-slate-200 dark:ring-slate-700">
          <p className="text-sm font-semibold">{editing ? 'Ödemeyi düzenle' : 'Ödeme ekle'}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">
              Tarih
              <input type="date" value={input.date} max={today} onChange={(e) => set('date', e.target.value)} {...aria('date')} className={inputClass} />
              {err('date')}
            </label>
            <label className="block text-sm font-medium">
              Tutar (€)
              <input type="text" inputMode="decimal" value={input.amount} onChange={(e) => set('amount', e.target.value)} {...aria('amount')} className={inputClass} placeholder="150,00" />
            </label>
          </div>
          {err('amount')}
          <label className="block text-sm font-medium">
            Not (isteğe bağlı)
            <input type="text" value={input.note} onChange={(e) => set('note', e.target.value)} {...aria('note')} className={inputClass} maxLength={200} placeholder="ör. eylül taksiti" />
            {err('note')}
          </label>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {preview !== null ? (
              <>
                Ödeme sonrası kalan: <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatEur(preview)}</span>
              </>
            ) : (
              <>En fazla {formatEur(max)}</>
            )}
          </p>

          {submitError && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || (!editing && debt.balance <= 0)}
              className="flex-1 rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? 'Kaydediliyor…' : editing ? 'Güncelle' : 'Ödemeyi kaydet'}
            </button>
            {editing && (
              <button type="button" onClick={resetForm} className="rounded-xl px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
                Vazgeç
              </button>
            )}
          </div>
          {!editing && debt.balance <= 0 && <p className="text-xs text-emerald-700 dark:text-emerald-300">Bu borç kapanmış 🎉</p>}
        </form>

        <section aria-labelledby="pay-history">
          <h3 id="pay-history" className="text-sm font-semibold text-slate-500 dark:text-slate-400">
            Geçmiş {payments.length > 0 && `(${payments.length})`}
          </h3>
          {payments.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Henüz ödeme kaydı yok.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {payments.map((p) => (
                <li key={p.id} className={`py-2 ${editing?.id === p.id ? 'bg-emerald-50/60 dark:bg-emerald-950/30' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{formatDate(p.date)}</p>
                      {p.note && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
                    </div>
                    <p className="font-semibold tabular-nums">{formatEur(p.amount)}</p>
                  </div>
                  {confirmId === p.id ? (
                    <div className="mt-1 flex items-center gap-2">
                      <p className="flex-1 text-xs text-red-700 dark:text-red-300">Silinsin mi? Tutar bakiyeye geri eklenir.</p>
                      <button type="button" onClick={() => remove(p)} disabled={busy} className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                        Evet, sil
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Hayır
                      </button>
                    </div>
                  ) : (
                    <div className="mt-1 flex gap-4">
                      <button type="button" onClick={() => startEdit(p)} className="min-h-8 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-400">
                        Düzenle
                      </button>
                      <button type="button" onClick={() => setConfirmId(p.id)} className="min-h-8 text-xs font-semibold text-red-600 hover:underline dark:text-red-400">
                        Sil
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </dialog>
  )
}
