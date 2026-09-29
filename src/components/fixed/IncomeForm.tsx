/** Gelir ekle / düzenle / sil. Doğrulama src/lib/income.ts'te (validateIncomeForm). */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { IncomeRow } from '../../lib/database.types'
import { dateForDayInCycle } from '../../lib/fixed'
import { INCOME_SOURCES, validateIncomeForm, type IncomeFormInput, type IncomeFormValue } from '../../lib/income'
import { formatAmountInput } from '../../lib/format'
import { inputClass } from '../ui'

interface Props {
  existing: IncomeRow | null
  cycle: { start: string; end: string; label: string }
  onClose: () => void
  onSave: (existing: IncomeRow | null, value: IncomeFormValue) => Promise<void>
  onDelete: (row: IncomeRow) => Promise<void>
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

function initialInput(row: IncomeRow | null): IncomeFormInput {
  if (!row) return { day: '', source: '', amount: '', recurring: true, note: '' }
  return {
    day: String(Number(row.date.slice(8, 10))),
    source: row.source,
    amount: formatAmountInput(row.amount),
    recurring: row.recurring,
    note: row.note ?? '',
  }
}

export function IncomeForm({ existing, cycle, onClose, onSave, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<IncomeFormInput>(() => initialInput(existing))
  const [errors, setErrors] = useState<Partial<Record<keyof IncomeFormInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const d = dialogRef.current
    if (d && !d.open) d.showModal()
  }, [])

  const set = <K extends keyof IncomeFormInput>(key: K, value: IncomeFormInput[K]) => {
    setInput((s) => ({ ...s, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const resolved = /^\d{1,2}$/.test(input.day) ? dateForDayInCycle(cycle.start, cycle.end, Number(input.day)) : null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateIncomeForm(input, cycle)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setBusy(true)
    setSubmitError(null)
    try {
      await onSave(existing, result.value)
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

  const err = (key: keyof IncomeFormInput) =>
    errors[key] ? (
      <span id={`inc-${key}-error`} className="mt-1 block text-xs text-red-600 dark:text-red-400">
        {errors[key]}
      </span>
    ) : null
  const aria = (key: keyof IncomeFormInput) => ({
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `inc-${key}-error` : undefined,
  })

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="inc-form-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={onSubmit} className="space-y-4 p-5" noValidate>
        <div>
          <h2 id="inc-form-title" className="text-lg font-bold">
            {existing ? 'Geliri düzenle' : 'Yeni gelir'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Döngü: {cycle.label}</p>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Kaynak</legend>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {INCOME_SOURCES.map((src) => {
              const on = input.source.trim() === src
              return (
                <button
                  key={src}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('source', src)}
                  className={`min-h-9 rounded-full px-3 text-sm font-semibold ring-1 ${
                    on
                      ? 'bg-emerald-600 text-white ring-emerald-600'
                      : 'bg-white text-slate-700 ring-slate-900/10 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-200 dark:ring-white/10'
                  }`}
                >
                  {on && <span aria-hidden="true">✓ </span>}
                  {src}
                </button>
              )
            })}
          </div>
          <input
            type="text"
            value={input.source}
            onChange={(e) => set('source', e.target.value)}
            aria-label="Kaynak (serbest metin)"
            {...aria('source')}
            className={inputClass}
            placeholder="ya da yaz: ör. Ek iş"
            maxLength={60}
          />
          {err('source')}
        </fieldset>

        <div className="grid grid-cols-[6rem_1fr] gap-3">
          <label className="block text-sm font-medium">
            Gün
            <input
              type="text"
              inputMode="numeric"
              maxLength={2}
              value={input.day}
              onChange={(e) => set('day', e.target.value.replace(/\D/g, ''))}
              {...aria('day')}
              className={inputClass}
              placeholder="ör. 15"
            />
          </label>
          <label className="block text-sm font-medium">
            Tutar (€)
            <input
              type="text"
              inputMode="decimal"
              value={input.amount}
              onChange={(e) => set('amount', e.target.value)}
              {...aria('amount')}
              className={inputClass}
              placeholder="2.155,00"
            />
          </label>
        </div>
        <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          {resolved ? `Tarih: ${dayjs(resolved).locale('tr').format('D MMMM dddd')}` : 'Ayın günü (1–31); döngü içindeki tarihe yerleşir.'}
        </p>
        {err('day')}
        {err('amount')}

        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={input.recurring} onChange={(e) => set('recurring', e.target.checked)} className="size-5 rounded accent-emerald-600" />
          <span>
            Her ay tekrar eder
            <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">Yeni döngüye “alınmadı” olarak otomatik taşınır.</span>
          </span>
        </label>

        <label className="block text-sm font-medium">
          Not (isteğe bağlı)
          <input type="text" value={input.note} onChange={(e) => set('note', e.target.value)} {...aria('note')} className={inputClass} maxLength={200} />
          {err('note')}
        </label>

        {submitError && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {submitError}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-emerald-600 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
            {busy ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-3 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            Vazgeç
          </button>
        </div>

        {existing && (
          <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm text-red-700 dark:text-red-300">“{existing.source}” silinsin mi?</p>
                <button type="button" onClick={onConfirmDelete} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  Evet, sil
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                  Hayır
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400">
                Bu geliri sil
              </button>
            )}
          </div>
        )}
      </form>
    </dialog>
  )
}
