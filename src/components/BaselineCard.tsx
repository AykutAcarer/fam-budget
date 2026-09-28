/**
 * Ayarlar > Baz ay: kıyasların referans alacağı döngüyü seçer.
 * Seçim hemen görünür (iyimser); sunucu reddederse eski seçime döner.
 * Dashboard ve Döngü ekranları açıldıklarında baz ayı yeniden yükler.
 */
import { useEffect, useMemo, useState } from 'react'
import { cycleOptions, withBaseline } from '../lib/compare'
import { cycleLabel, sameLabel, todayIso } from '../lib/cycle'
import type { CycleRow } from '../lib/database.types'
import { loadCycles, setBaselineCycle } from '../lib/cyclesApi'
import { loadErrorText } from '../lib/loadError'
import { CheckIcon } from './icons'
import { Card, CardTitle } from './ui'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function BaselineCard() {
  const [today] = useState(todayIso)
  const [cycles, setCycles] = useState<CycleRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCycles()
      .then(setCycles)
      .catch((e: unknown) => setLoadError(errorText(e)))
  }, [])

  const options = useMemo(() => cycleOptions(cycles ?? [], today), [cycles, today])

  async function choose(id: string) {
    if (!cycles || saving) return
    const previous = cycles
    setError(null)
    setSaving(id)
    setCycles(withBaseline(cycles, id))
    try {
      await setBaselineCycle(id)
    } catch (e) {
      setCycles(previous)
      setError(`Baz ay değiştirilemedi: ${errorText(e)}`)
    } finally {
      setSaving(null)
    }
  }

  return (
    <Card>
      <CardTitle>Baz ay</CardTitle>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Kısılabilir harcamalar bu döngünün aynı gününe göre kıyaslanır. Genelde “normal” geçen bir ayı seç.
      </p>

      {loadError ? (
        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">
          {loadErrorText('döngüler', loadError)}
        </p>
      ) : !cycles ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Yükleniyor…</p>
      ) : options.length === 0 ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          Henüz döngü yok. Sohbetten harcama girdikçe ya da veri içe aktardıkça döngüler burada listelenir.
        </p>
      ) : (
        <div role="radiogroup" aria-label="Baz ay seç" className="mt-3 space-y-2">
          {options.map((o) => {
            const checked = o.isBaseline
            const range = cycleLabel(o.cycle.start_date, o.cycle.end_date)
            return (
              <button
                key={o.cycle.id}
                type="button"
                role="radio"
                aria-checked={checked}
                disabled={!!saving}
                onClick={() => !checked && void choose(o.cycle.id)}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2 text-left ring-1 transition-colors disabled:opacity-70 ${
                  checked
                    ? 'bg-emerald-50 ring-2 ring-emerald-600 dark:bg-emerald-950/40 dark:ring-emerald-400'
                    : 'bg-white ring-slate-900/10 hover:bg-slate-50 dark:bg-slate-900 dark:ring-white/10 dark:hover:bg-slate-800'
                }`}
              >
                <span
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    checked ? 'border-emerald-600 bg-emerald-600 dark:border-emerald-400 dark:bg-emerald-400' : 'border-slate-300 dark:border-slate-600'
                  }`}
                  aria-hidden="true"
                >
                  {checked && <CheckIcon className="size-3 text-white dark:text-slate-900" strokeWidth={3.5} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{range}</span>
                  {o.cycle.label && !sameLabel(o.cycle.label, range) && (
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{o.cycle.label}</span>
                  )}
                  {checked && o.isActive && (
                    <span className="block text-xs text-amber-700 dark:text-amber-300">
                      Aktif döngü baz ay: kıyas bir sonraki döngüde başlar.
                    </span>
                  )}
                </span>
                {o.isActive && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 uppercase dark:bg-emerald-950 dark:text-emerald-300">
                    aktif
                  </span>
                )}
                {saving === o.cycle.id && <span className="shrink-0 text-xs text-slate-500">kaydediliyor…</span>}
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}
    </Card>
  )
}
