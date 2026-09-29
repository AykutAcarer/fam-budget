/**
 * Borç ekle / düzenle (kısmi ödeme sonrası yeni bakiye dahil). Doğrulama
 * src/lib/debts.ts'te (validateDebtForm).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { DebtRow } from '../../lib/database.types'
import { splitDueDate, validateDebtForm, type DebtFormInput, type DebtFormValue } from '../../lib/debts'
import { formatAmountInput } from '../../lib/format'
import { inputClass } from '../ui'

interface Props {
  existing: DebtRow | null
  /** Yeni borç için önerilen öncelik. */
  suggestedPriority: number
  onClose: () => void
  onSave: (existing: DebtRow | null, value: DebtFormValue) => Promise<void>
  onDelete: (row: DebtRow) => Promise<void>
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

function initialInput(row: DebtRow | null, suggestedPriority: number): DebtFormInput {
  if (!row)
    return { name: '', balance: '', hasInterest: false, interest: '', dueMonth: '', dueDay: '', priority: String(suggestedPriority), note: '' }
  return {
    name: row.name,
    balance: formatAmountInput(row.balance),
    hasInterest: row.has_interest,
    interest: row.interest ?? '',
    ...splitDueDate(row.due_date),
    priority: String(row.priority),
    note: row.note ?? '',
  }
}

export function DebtForm({ existing, suggestedPriority, onClose, onSave, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<DebtFormInput>(() => initialInput(existing, suggestedPriority))
  const [errors, setErrors] = useState<Partial<Record<keyof DebtFormInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const set = <K extends keyof DebtFormInput>(key: K, value: DebtFormInput[K]) => {
    setInput((s) => ({ ...s, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateDebtForm(input)
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

  const err = (key: keyof DebtFormInput) =>
    errors[key] ? (
      <span id={`debt-${key}-error`} className="mt-1 block text-xs text-red-600 dark:text-red-400">
        {errors[key]}
      </span>
    ) : null
  const aria = (key: keyof DebtFormInput) => ({
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `debt-${key}-error` : undefined,
  })

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="debt-form-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={onSubmit} className="space-y-4 p-5" noValidate>
        <h2 id="debt-form-title" className="text-lg font-bold">
          {existing ? 'Borcu düzenle' : 'Yeni borç'}
        </h2>

        <label className="block text-sm font-medium">
          Kime / ne
          <input type="text" value={input.name} onChange={(e) => set('name', e.target.value)} {...aria('name')} className={inputClass} placeholder="ör. Kredi kartı" maxLength={80} />
          {err('name')}
        </label>

        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <label className="block text-sm font-medium">
            {existing ? 'Güncel bakiye (€)' : 'Bakiye (€)'}
            <input type="text" inputMode="decimal" value={input.balance} onChange={(e) => set('balance', e.target.value)} {...aria('balance')} className={inputClass} placeholder="6.026,31" />
            {err('balance')}
          </label>
          <label className="block text-sm font-medium">
            Öncelik
            <input type="text" inputMode="numeric" value={input.priority} onChange={(e) => set('priority', e.target.value.replace(/\D/g, ''))} {...aria('priority')} className={inputClass} maxLength={3} />
          </label>
        </div>
        {err('priority')}
        {existing && <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">Ödeme yaptıysan kartın altındaki “Ödeme ekle”yi kullan — bakiye düşer ve geçmişte görünür. Burayı yalnız düzeltme için değiştir.</p>}

        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={input.hasInterest} onChange={(e) => set('hasInterest', e.target.checked)} className="size-5 rounded accent-emerald-600" />
          Faizli borç
        </label>
        {input.hasInterest && (
          <label className="-mt-2 block text-sm font-medium">
            Faiz
            <input type="text" value={input.interest} onChange={(e) => set('interest', e.target.value)} className={inputClass} placeholder="ör. ~%17,5/yıl" maxLength={40} />
          </label>
        )}

        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <label className="block text-sm font-medium">
            Vade (ay, isteğe bağlı)
            <input type="month" value={input.dueMonth} onChange={(e) => set('dueMonth', e.target.value)} {...aria('dueMonth')} className={inputClass} />
            {err('dueMonth')}
          </label>
          <label className="block text-sm font-medium">
            Gün
            <input type="text" inputMode="numeric" value={input.dueDay} onChange={(e) => set('dueDay', e.target.value.replace(/\D/g, ''))} {...aria('dueDay')} className={inputClass} placeholder="—" maxLength={2} />
            {err('dueDay')}
          </label>
        </div>

        <label className="block text-sm font-medium">
          Not (isteğe bağlı)
          <input type="text" value={input.note} onChange={(e) => set('note', e.target.value)} className={inputClass} maxLength={200} />
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
                <p className="flex-1 text-sm text-red-700 dark:text-red-300">“{existing.name}” silinsin mi?</p>
                <button type="button" onClick={onConfirmDelete} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  Evet, sil
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                  Hayır
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-sm font-semibold text-red-600 hover:underline dark:text-red-400">
                Bu borcu sil
              </button>
            )}
          </div>
        )}
      </form>
    </dialog>
  )
}
