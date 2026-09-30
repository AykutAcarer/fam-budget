/**
 * Ayarlar > Kategoriler: liste (renk, ad, tür, anahtar kelimeler), ekle,
 * düzenle, taşı-sil ve "Kısılabilir" anahtarı (baz ay kıyasına dahil olanlar).
 * Diğer ekranlar açıldıklarında kategorileri yeniden yükler.
 */
import { useEffect, useState } from 'react'
import { CATEGORY_TYPE_LABELS, type CategoryFormValue } from '../../lib/categories'
import { countCategoryExpenses, createCategory, deleteCategory, loadCategories, setCategoryCuttable, updateCategory } from '../../lib/categoriesApi'
import type { CategoryRow } from '../../lib/database.types'
import { loadErrorText } from '../../lib/loadError'
import { CategoryDot } from '../CategoryBadge'
import { PaidSwitch } from '../fixed/PaidSwitch'
import { PlusIcon } from '../icons'
import { Card, CardTitle } from '../ui'
import { CategoryForm } from './CategoryForm'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

type Editing = { row: CategoryRow | null } | null

export function CategoriesCard() {
  const [categories, setCategories] = useState<CategoryRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())

  const reload = () =>
    loadCategories()
      .then((rows) => {
        setCategories(rows)
        setLoadError(null)
      })
      .catch((e: unknown) => setLoadError(errorText(e)))

  useEffect(() => {
    void reload()
  }, [])

  async function save(existing: CategoryRow | null, value: CategoryFormValue) {
    if (!categories) return
    const row = existing ? await updateCategory(existing.id, value) : await createCategory(value, categories)
    setCategories((list) => (existing ? (list ?? []).map((c) => (c.id === row.id ? row : c)) : [...(list ?? []), row]))
    setNotice(existing ? `“${row.label}” güncellendi.` : `“${row.label}” eklendi.`)
  }

  /** Kısılabilir anahtarı: hemen görünür (iyimser); sunucu reddederse eski haline döner. */
  async function toggleCuttable(row: CategoryRow) {
    const next = !row.is_cuttable
    const flip = (value: boolean) => setCategories((list) => (list ?? []).map((c) => (c.id === row.id ? { ...c, is_cuttable: value } : c)))
    setToggleError(null)
    setPendingIds((s) => new Set(s).add(row.id))
    flip(next)
    try {
      await setCategoryCuttable(row.id, next)
    } catch (e) {
      flip(row.is_cuttable)
      setToggleError(`“${row.label}” güncellenemedi: ${errorText(e)}`)
    } finally {
      setPendingIds((s) => {
        const copy = new Set(s)
        copy.delete(row.id)
        return copy
      })
    }
  }

  async function remove(row: CategoryRow, moveTo: string | null) {
    const moved = await deleteCategory(row.key, moveTo)
    const target = categories?.find((c) => c.key === moveTo)
    setCategories((list) => (list ?? []).filter((c) => c.id !== row.id))
    setNotice(moved && target ? `${moved} harcama “${target.label}” kategorisine taşındı, “${row.label}” silindi.` : `“${row.label}” silindi.`)
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Kategoriler</CardTitle>
        {categories && (
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setEditing({ row: null })
            }}
            className="flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            <PlusIcon className="size-4" strokeWidth={2.5} />
            Ekle
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Düzenlemek için kategoriye dokun.</p>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        <b className="font-semibold text-emerald-800 dark:text-emerald-300">✂ Kısılabilir</b> anahtarı açık olanlar ana ekrandaki baz ay
        kıyasına ve tekrar hatırlatmasına girer. Tür (Zorunlu, Esnek…) yalnızca açıklamadır.
      </p>
      {toggleError && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {toggleError}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {notice}
        </p>
      )}

      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {loadErrorText('kategoriler', loadError)}
        </p>
      ) : !categories ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Yükleniyor…</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setNotice(null)
                  setEditing({ row: c })
                }}
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-2 text-left"
              >
                <CategoryDot color={c.color} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{c.label}</span>
                    {c.is_cuttable && (
                      <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                        ✂ kısılabilir
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                    Tür: {CATEGORY_TYPE_LABELS[c.type] ?? c.type}
                    {c.keywords.length > 0 && ` · ${c.keywords.slice(0, 4).join(', ')}${c.keywords.length > 4 ? ` +${c.keywords.length - 4}` : ''}`}
                  </span>
                </span>
              </button>
              <span className="flex shrink-0 flex-col items-center">
                <span aria-hidden className="text-[10px] font-medium text-slate-500 dark:text-slate-400">✂ Kısılabilir</span>
                <PaidSwitch
                  checked={c.is_cuttable}
                  label={`${c.label}: kısılabilir ${c.is_cuttable ? '(kıyasa dahil)' : '(kıyas dışı)'}`}
                  pending={pendingIds.has(c.id)}
                  onToggle={() => void toggleCuttable(c)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && categories && (
        <CategoryForm
          existing={editing.row}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={save}
          countExpenses={countCategoryExpenses}
          onDelete={remove}
        />
      )}
    </Card>
  )
}
