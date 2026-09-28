/**
 * Ana Ekran (Dashboard).
 *
 * Aktif döngü + döngü günü, sohbetle harcama girişi. Kıyas kartı, KPI'lar ve
 * kategori dağılımı kodla (deterministik) hesaplanır.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ChatPanel } from '../components/chat/ChatPanel'
import { useChat } from '../components/chat/useChat'
import { Card, CardTitle, Spinner } from '../components/ui'
import { cycleDay, cycleLabel, cycleLength, todayIso } from '../lib/cycle'
import { useBudgetData } from '../lib/useBudgetData'

export function Dashboard() {
  const { session } = useAuth()
  const [today] = useState(todayIso)
  const { data, error, reload } = useBudgetData(today)
  const chat = useChat({ userId: session!.user.id, today, data, reload })
  const colors = useMemo(() => new Map(data?.categories.map((c) => [c.key, c.color])), [data])

  if (!data && !error) return <Spinner />

  if (!data) {
    // Veri yüklenemedi (ör. çevrimdışı): sohbet yine çalışır, harcamalar cihazda bekler.
    return (
      <div className="space-y-4">
        <Card>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">Veriler yüklenemedi: {error}</p>
        </Card>
        <ChatPanel chat={chat} colors={colors} />
      </div>
    )
  }

  const active = { ...data.active.window, saved: data.active.cycle !== null }
  const baseline = data.baseline?.cycle ?? null
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

      <ChatPanel chat={chat} colors={colors} />
    </div>
  )
}
