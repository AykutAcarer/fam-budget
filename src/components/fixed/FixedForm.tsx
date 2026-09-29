/**
 * Sabit gider ekle / düzenle (tarih dahil — faturayı ileri güne "esnetmek" için).
 * Doğrulama src/lib/fixed.ts'te (validateFixedForm).
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FixedExpenseRow } from '../../lib/database.types'
import { dateForDayInCycle, isCardSource, nextSource, validateFixedForm, type FixedFormInput } from '../../lib/fixed'
import type { FixedInput } from '../../lib/fixedApi'
import { formatAmountInput } from '../../lib/format'
import { inputClass } from '../ui'

interface Props {
  /** Düzenlenen kalem; null ise yeni kalem. */
  existing: FixedExpenseRow | null
  cycle: { start: string; end: string; label: string }
  onClose: () => void
  onSave: (existing: FixedExpenseRow | null, input: FixedInput) => Promise<void>
  onDelete: (row: FixedExpenseRow) => Promise<void>
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

function initialInput(row: FixedExpenseRow | null): FixedFormInput {
  if (!row) return { day: '', item: '', amount: '', card: false, installmentsLeft: '', recurring: true }
  return {
    day: String(Number(row.date.slice(8, 10))),
    item: row.item,
    amount: formatAmountInput(row.amount),
    card: isCardSource(row.source),
    installmentsLeft: row.installments_left === null ? '' : String(row.installments_left),
    recurring: row.recurring,
  }
}

export function FixedForm({ existing, cycle, onClose, onSave, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<FixedFormInput>(() => initialInput(existing))
  const [errors, setErrors] = useState<Partial<Record<keyof FixedFormInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const set = <K extends keyof FixedFormInput>(key: K, value: FixedFormInput[K]) => {
    setInput((s) => ({ ...s, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const dayNum = Number(input.day)
  const resolved = /^\d{1,2}$/.test(input.day) ? dateForDayInCycle(cycle.start, cycle.end, dayNum) : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateFixedForm(input, cycle)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      await onSave(existing, {
        date: result.value.date,
        item: result.value.item,
        amount: result.value.amount,
        source: nextSource(existing?.source ?? null, input.card),
        installments_left: result.value.installmentsLeft,
        recurring: result.value.recurring,
      })
      onClose()
    } catch (err) {
      setSubmitError(`Kaydedilemedi: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function onConfirmDelete() {
    if (!existing) return
    setBusy(true)
    setSubmitError(null)
    try {
      await onDelete(existing)
      onClose()
    } catch (err) {
      setSubmitError(`Silinemedi: ${errorText(err)}`)
      setBusy(false)
    }
  }

  const fieldError = (key: keyof FixedFormInput) =>
    errors[key] ? (
      <span id={`fixed-${key}-error`} className="mt-1 block text-xs text-red-600 dark:text-red-400">
        {errors[key]}
      </span>
    ) : null

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="fixed-form-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={onSubmit} className="space-y-4 p-5" noValidate>
        <div>
          <h2 id="fixed-form-title" className="text-lg font-bold">
            {existing ? 'Sabit gideri düzenle' : 'Yeni sabit gider'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Döngü: {cycle.label}</p>
        </div>

        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <label className="block text-sm font-medium">
            Gün
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={input.day}
              onChange={(e) => set('day', e.target.value.replace(/\D/g, ''))}
              aria-invalid={!!errors.day}
              aria-describedby={errors.day ? 'fixed-day-error' : 'fixed-day-hint'}
              className={inputClass}
              placeholder="ör. 7"
            />
          </label>
          <label className="block text-sm font-medium">
            Kalem
            <input
              type="text"
              value={input.item}
              onChange={(e) => set('item', e.target.value)}
              aria-invalid={!!errors.item}
              aria-describedby={errors.item ? 'fixed-item-error' : undefined}
              className={inputClass}
              placeholder="ör. Telekom"
              maxLength={80}
            />
          </label>
        </div>
        <p id="fixed-day-hint" className="-mt-2 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          {resolved ? `Ödeme tarihi: ${dayjs(resolved).locale('tr').format('D MMMM dddd')}` : 'Ayın günü (1–31); döngü içindeki tarihe yerleşir.'}
        </p>
        {fieldError('day')}
        {fieldError('item')}

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            Tutar (€)
            <input
              type="text"
              inputMode="decimal"
              value={input.amount}
              onChange={(e) => set('amount', e.target.value)}
              aria-invalid={!!errors.amount}
              aria-describedby={errors.amount ? 'fixed-amount-error' : undefined}
              className={inputClass}
              placeholder="49,99"
            />
            {fieldError('amount')}
          </label>
          <label className="block text-sm font-medium">
            Kalan taksit <span className="font-normal text-slate-500 dark:text-slate-400">(bu ay dahil · 1 = son)</span>
            <input
              type="text"
              inputMode="numeric"
              value={input.installmentsLeft}
              onChange={(e) => set('installmentsLeft', e.target.value.replace(/[^\d-]/g, ''))}
              aria-invalid={!!errors.installmentsLeft}
              aria-describedby={errors.installmentsLeft ? 'fixed-installmentsLeft-error' : undefined}
              className={inputClass}
              placeholder="yok"
            />
            {fieldError('installmentsLeft')}
          </label>
        </div>

        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={input.card}
            onChange={(e) => set('card', e.target.checked)}
            className="size-5 rounded accent-emerald-600"
          />
          Karttan çekiliyor
        </label>
        <label className="-mt-2 flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={input.recurring}
            onChange={(e) => set('recurring', e.target.checked)}
            className="size-5 rounded accent-emerald-600"
          />
          <span>
            Her ay tekrar eder
            <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">Yeni döngüye otomatik taşınır; taksitte sayı bir azalır.</span>
          </span>
        </label>

        {submitError && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {submitError}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Vazgeç
          </button>
        </div>

        {existing && (
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm text-red-700 dark:text-red-300">“{existing.item}” silinsin mi?</p>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={busy}
                  className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                >
                  Evet, sil
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300"
                >
                  Hayır
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400"
              >
                Bu kalemi sil
              </button>
            )}
          </div>
        )}
      </form>
    </dialog>
  )
}
