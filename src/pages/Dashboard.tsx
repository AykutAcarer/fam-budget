/**
 * Ana Ekran (Dashboard).
 *
 * Şimdilik iskelet: aktif döngü + döngü günü gerçek; kıyas kartı, KPI'lar,
 * kategori dağılımı ve sohbet girişi boş durumda. Rakamlar sonraki adımda
 * kodla (deterministik) hesaplanacak.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SendIcon } from '../components/icons'
import { Card, CardTitle, Spinner } from '../components/ui'
import { cycleDay, cycleLabel, cycleLength, cycleWindowFor, todayIso } from '../lib/cycle'
import type { CycleRow } from '../lib/database.types'
import { supabase } from '../lib/supabase'

interface ActiveCycle {
  label: string
  start: string
  end: string
  /** Veritabanında kayıtlı mı, yoksa tarihten mi hesaplandı? */
  saved: boolean
}

interface DashboardData {
  active: ActiveCycle
  baseline: CycleRow | null
}

async function loadDashboard(today: string): Promise<DashboardData> {
  const [activeRes, baselineRes] = await Promise.all([
    supabase.from('cycles').select('*').lte('start_date', today).gte('end_date', today).limit(1).maybeSingle(),
    supabase.from('cycles').select('*').eq('is_baseline', true).maybeSingle(),
  ])
  if (activeRes.error) throw activeRes.error
  if (baselineRes.error) throw baselineRes.error

  const row = activeRes.data
  const window = cycleWindowFor(today)
  return {
    active: row
      ? { label: cycleLabel(row.start_date, row.end_date), start: row.start_date, end: row.end_date, saved: true }
      : { label: window.label, start: window.start, end: window.end, saved: false },
    baseline: baselineRes.data,
  }
}

export function Dashboard() {
  const [today] = useState(todayIso)
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadDashboard(today)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Veriler yüklenemedi.'))
    return () => {
      cancelled = true
    }
  }, [today])

  if (error) {
    return (
      <Card className="mt-4">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">Veriler yüklenemedi: {error}</p>
      </Card>
    )
  }
  if (!data) return <Spinner />

  const { active, baseline } = data
  const day = cycleDay(active.start, today)
  const total = cycleLength(active.start, active.end)

  return (
    <div className="space-y-4">
      {/* Döngü başlığı */}
      <header>
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Aktif döngü</p>
        <h1 className="text-2xl font-bold tracking-tight">{active.label}</h1>
        <div className="mt-2 flex items-center gap-3">
          <div
            className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={day}
            aria-label="Döngü ilerlemesi"
          >
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(day / total) * 100}%` }} />
          </div>
          <span className="shrink-0 text-sm text-slate-600 tabular-nums dark:text-slate-300">
            {day}. gün / {total}
          </span>
        </div>
      </header>

      {!active.saved && (
        <Card className="bg-emerald-50 ring-emerald-600/15 dark:bg-emerald-950/40 dark:ring-emerald-400/20">
          <p className="text-sm text-emerald-900 dark:text-emerald-200">
            Hoş geldin! 👋 Henüz hiç verin yok. İlk harcamanı aşağıdaki sohbet kutusuna yazabilir ya da{' '}
            <Link to="/ayarlar" className="font-semibold underline underline-offset-2">
              Ayarlar
            </Link>
            'dan eski verilerini içe aktarabilirsin.
          </p>
        </Card>
      )}

      {/* Kısılabilir dörtlü kıyas kartı */}
      <Card>
        <CardTitle>Kısılabilir harcamalar · baz aya göre</CardTitle>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Kahvaltı + İş + Halı saha + Sosyal, {day}. güne kadar</p>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {['Bu ay', 'Baz ay', 'Fark'].map((label) => (
            <div key={label} className="rounded-xl bg-slate-50 py-3 dark:bg-slate-800/60">
              <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
              <dd className="mt-0.5 text-lg font-semibold text-slate-400 tabular-nums dark:text-slate-500">—</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          {baseline
            ? `Baz ay: ${cycleLabel(baseline.start_date, baseline.end_date)}`
            : 'Kıyas için henüz bir baz ay seçilmedi.'}
        </p>
      </Card>

      {/* KPI kartları */}
      <div className="grid grid-cols-2 gap-3">
        {['Toplam gelir', 'Sabit gider', 'Değişken harcama', 'Kredi kartı ödemesi'].map((label) => (
          <Card key={label} className="p-3.5">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-400 tabular-nums dark:text-slate-500">—</p>
          </Card>
        ))}
      </div>

      {/* Kategori dağılımı */}
      <Card>
        <CardTitle>Kategori dağılımı</CardTitle>
        <div className="mt-3 flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
          Bu döngüde henüz harcama yok
        </div>
      </Card>

      {/* Sohbet akışı */}
      <Card>
        <CardTitle>Sohbet</CardTitle>
        <div className="mt-3 flex">
          <p className="max-w-[85%] rounded-2xl rounded-tl-md bg-slate-100 px-3.5 py-2.5 text-sm dark:bg-slate-800">
            Merhaba! Harcamanı buraya yazman yeterli, ör. <b>“8,25 halısaha”</b> ya da{' '}
            <b>“işte öğlen atıştırmalık 3,72”</b>. Gerisini ben hallederim. 💪
          </p>
        </div>
      </Card>

      {/* Sabit sohbet kutusunun kapladığı alan kadar boşluk */}
      <div className="h-16" aria-hidden="true" />

      {/* Sohbet kutusu — tab bar'ın hemen üstünde sabit */}
      <form
        onSubmit={(e) => e.preventDefault()}
        className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-slate-200 bg-slate-50/95 px-4 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95"
      >
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            type="text"
            disabled
            aria-label="Harcama yaz"
            placeholder="Sohbetle harcama girişi çok yakında…"
            className="h-12 flex-1 rounded-full border-0 bg-white px-4 text-base shadow-sm ring-1 ring-slate-900/10 placeholder:text-slate-400 disabled:opacity-70 dark:bg-slate-900 dark:ring-white/10"
          />
          <button
            type="submit"
            disabled
            aria-label="Gönder"
            className="flex size-12 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm disabled:opacity-50"
          >
            <SendIcon className="size-5" />
          </button>
        </div>
      </form>
    </div>
  )
}
