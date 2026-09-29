/**
 * Kategori ekle / düzenle / sil. Doğrulama src/lib/categories.ts'te
 * (validateCategoryForm: ad, tür, renk erişilebilirliği, anahtar kelimeler).
 *
 * Silme: harcaması yoksa iki adımlı onay; varsa önce hedef kategori seçilir,
 * harcamalar oraya taşınır ve kategori silinir (tek işlem, delete_category).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { CategoryType } from '../../../supabase/functions/_shared/categories'
import {
  CATEGORY_TYPE_LABELS,
  checkCategoryColor,
  formatKeywords,
  isHexColor,
  keywordConflicts,
  PALETTE_SWATCHES,
  parseKeywords,
  validateCategoryForm,
  type CategoryFormInput,
  type CategoryFormValue,
} from '../../lib/categories'
import type { CategoryRow } from '../../lib/database.types'
import { CheckIcon } from '../icons'
import { CategoryDot } from '../CategoryBadge'
import { inputClass } from '../ui'

interface Props {
  existing: CategoryRow | null
  categories: readonly CategoryRow[]
  onClose: () => void
  onSave: (existing: CategoryRow | null, value: CategoryFormValue) => Promise<void>
  /** Harcama sayısı (silme akışı için). */
  countExpenses: (key: string) => Promise<number>
  onDelete: (row: CategoryRow, moveTo: string | null) => Promise<void>
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

const TYPES = Object.entries(CATEGORY_TYPE_LABELS) as [CategoryType, string][]

type DeleteStep = { kind: 'idle' } | { kind: 'counting' } | { kind: 'confirm' } | { kind: 'move'; count: number; target: string }

export function CategoryForm({ existing, categories, onClose, onSave, countExpenses, onDelete }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [input, setInput] = useState<CategoryFormInput>(() => ({
    label: existing?.label ?? '',
    type: existing?.type ?? '',
    color: existing?.color ?? PALETTE_SWATCHES[categories.length % PALETTE_SWATCHES.length],
    keywords: formatKeywords(existing?.keywords ?? []),
  }))
  const [errors, setErrors] = useState<Partial<Record<keyof CategoryFormInput, string>>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<DeleteStep>({ kind: 'idle' })

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  const others = useMemo(() => categories.filter((c) => c.id !== existing?.id), [categories, existing])
  const color = input.color.trim().toUpperCase()
  const colorCheck = isHexColor(color) ? checkCategoryColor(color) : null
  const conflicts = useMemo(() => keywordConflicts(parseKeywords(input.keywords), others), [input.keywords, others])

  const set = <K extends keyof CategoryFormInput>(key: K, value: CategoryFormInput[K]) => {
    setInput((s) => ({ ...s, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const result = validateCategoryForm(input, others.map((c) => c.label))
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

  async function startDelete() {
    if (!existing) return
    setSubmitError(null)
    setDel({ kind: 'counting' })
    try {
      const count = await countExpenses(existing.key)
      setDel(count > 0 ? { kind: 'move', count, target: '' } : { kind: 'confirm' })
    } catch (err) {
      setDel({ kind: 'idle' })
      setSubmitError(`Harcamalar sayılamadı: ${errorText(err)}`)
    }
  }

  async function confirmDelete(moveTo: string | null) {
    if (!existing) return
    setBusy(true)
    setSubmitError(null)
    try {
      await onDelete(existing, moveTo)
      onClose()
    } catch (err) {
      setSubmitError(`Silinemedi: ${errorText(err)}`)
      setBusy(false)
    }
  }

  const err = (key: keyof CategoryFormInput) =>
    errors[key] ? (
      <span id={`cat-${key}-error`} className="mt-1 block text-xs text-red-600 dark:text-red-400">
        {errors[key]}
      </span>
    ) : null
  const aria = (key: keyof CategoryFormInput) => ({
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? `cat-${key}-error` : undefined,
  })

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="cat-form-title"
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <form onSubmit={onSubmit} className="space-y-4 p-5" noValidate>
        <h2 id="cat-form-title" className="text-lg font-bold">
          {existing ? 'Kategoriyi düzenle' : 'Yeni kategori'}
        </h2>

        <label className="block text-sm font-medium">
          Ad
          <input type="text" value={input.label} onChange={(e) => set('label', e.target.value)} {...aria('label')} className={inputClass} placeholder="ör. Spor" maxLength={60} />
          {err('label')}
        </label>

        <fieldset>
          <legend className="text-sm font-medium">Tür</legend>
          <div role="radiogroup" aria-label="Tür" {...aria('type')} className="mt-1 grid grid-cols-2 gap-2">
            {TYPES.map(([value, label]) => {
              const checked = input.type === value
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => set('type', value)}
                  className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ring-1 transition-colors ${
                    checked
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-500 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : 'bg-slate-50 text-slate-600 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Kısılabilir kategoriler baz ayla kıyaslanır ve tekrar hatırlatması alır.</p>
          {err('type')}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Renk</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {PALETTE_SWATCHES.map((c) => {
              const checked = color === c.toUpperCase()
              return (
                <button
                  key={c}
                  type="button"
                  aria-label={`Renk ${c}`}
                  aria-pressed={checked}
                  onClick={() => set('color', c)}
                  className={`grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-white focus-visible:ring-2 focus-visible:ring-emerald-500 dark:ring-offset-slate-900 ${checked ? "ring-2 ring-slate-900 dark:ring-white" : ""}`}
                  style={{ backgroundColor: c }}
                >
                  {checked && <CheckIcon className="size-5 text-white" strokeWidth={3} />}
                </button>
              )
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <input
              type="color"
              aria-label="Özel renk seç"
              value={colorCheck ? color.toLowerCase() : '#000000'}
              onChange={(e) => set('color', e.target.value.toUpperCase())}
              className="h-11 w-14 cursor-pointer rounded-lg border-0 bg-transparent p-0"
            />
            <input
              type="text"
              aria-label="Renk kodu"
              value={input.color}
              onChange={(e) => set('color', e.target.value)}
              {...aria('color')}
              className={`${inputClass} mt-0 font-mono`}
              maxLength={7}
              spellCheck={false}
            />
          </div>
          {err('color')}
          {colorCheck && !colorCheck.ok && colorCheck.suggestion && (
            <button
              type="button"
              onClick={() => set('color', colorCheck.suggestion!)}
              className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
            >
              <CategoryDot color={colorCheck.suggestion} className="size-4" />
              Okunur tonu kullan ({colorCheck.suggestion})
            </button>
          )}
          {colorCheck && !colorCheck.ok && !errors.color && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              Bu renk iki temanın birinde zeminden yeterince ayrışmıyor; kaydederken reddedilir.
            </p>
          )}
        </fieldset>

        <label className="block text-sm font-medium">
          Anahtar kelimeler (isteğe bağlı)
          <input type="text" value={input.keywords} onChange={(e) => set('keywords', e.target.value)} {...aria('keywords')} className={inputClass} placeholder="ör. fitness, yüzme, spor salonu" />
          <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
            Virgülle ayır. İnternet yokken sohbete yazdığın harcama bu kelimelerle bu kategoriye atanır.
          </span>
          {err('keywords')}
        </label>
        {conflicts.length > 0 && (
          <p className="-mt-2 text-xs text-amber-700 dark:text-amber-300">
            {conflicts.map((c) => `“${c.keyword}” ${c.label}`).join(', ')} kategorisinde de var; listede önce gelen kategori kazanır.
          </p>
        )}

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
            {del.kind === 'confirm' ? (
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm text-red-700 dark:text-red-300">“{existing.label}” silinsin mi?</p>
                <button type="button" onClick={() => confirmDelete(null)} disabled={busy} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60">
                  Evet, sil
                </button>
                <button type="button" onClick={() => setDel({ kind: 'idle' })} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                  Hayır
                </button>
              </div>
            ) : del.kind === 'move' ? (
              <div className="space-y-2">
                <p className="text-sm text-red-700 dark:text-red-300">
                  Bu kategoride {del.count} harcama var. Silmeden önce harcamaları başka bir kategoriye taşı:
                </p>
                <select
                  aria-label="Harcamaların taşınacağı kategori"
                  value={del.target}
                  onChange={(e) => setDel({ ...del, target: e.target.value })}
                  className={`${inputClass} mt-0`}
                >
                  <option value="">Kategori seç…</option>
                  {others.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => confirmDelete(del.target)}
                    disabled={busy || !del.target}
                    className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    {busy ? 'Taşınıyor…' : `${del.count} harcamayı taşı ve sil`}
                  </button>
                  <button type="button" onClick={() => setDel({ kind: 'idle' })} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300">
                    Vazgeç
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={startDelete}
                disabled={del.kind === 'counting' || others.length === 0}
                className="text-sm font-semibold text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
              >
                {del.kind === 'counting' ? 'Kontrol ediliyor…' : others.length === 0 ? 'Son kategori silinemez' : 'Bu kategoriyi sil'}
              </button>
            )}
          </div>
        )}
      </form>
    </dialog>
  )
}
