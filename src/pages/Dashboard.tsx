/**
 * Ana Ekran (Dashboard).
 *
 * Aktif döngü + döngü günü, kısılabilir harcama kıyas kartı, KPI'lar, kategori
 * dağılımı ve sohbetle harcama girişi. Tüm rakamlar kodla hesaplanır
 * (compare.ts / budget.ts); cihazda bekleyen harcamalar da dahil edilir.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ChatPanel } from '../components/chat/ChatPanel'
import { useChat } from '../components/chat/useChat'
import { CategoryCard } from '../components/dashboard/CategoryCard'
import { ComparisonCard } from '../components/dashboard/ComparisonCard'
import { CreditCardCard } from '../components/dashboard/CreditCardCard'
import { DebtSummaryCard } from '../components/dashboard/DebtSummaryCard'
import { KpiGrid } from '../components/dashboard/KpiGrid'
import { Card, Spinner } from '../components/ui'
import { buildComparison, cycleSummary } from '../lib/budget'
import { createColorLookup } from '../lib/categoryColors'
import { cycleLabel, cycleLength, todayIso } from '../lib/cycle'
import { clampedCycleDay } from '../lib/compare'
import { loadErrorText } from '../lib/loadError'
import { useBudgetData } from '../lib/useBudgetData'
import { cuttableLabels } from '../lib/categories'
import { setCcOpeningBalance } from '../lib/cyclesApi'
import { loadDebts } from '../lib/debtsApi'
import { buildReport } from '../lib/report'
import { useReadOnly } from '../lib/useOnline'

export function Dashboard() {
  const { session } = useAuth()
  const [today] = useState(todayIso)
  const { data, error, reload } = useBudgetData(today)
  const readOnly = useReadOnly()
  const [pdf, setPdf] = useState<'idle' | 'busy' | 'error'>('idle')
  const chat = useChat({ userId: session!.user.id, today, data, reload })
  const colorOf = useMemo(() => createColorLookup(data?.categories), [data])

  const summary = useMemo(() => (data ? cycleSummary(data, chat.outbox) : null), [data, chat.outbox])
  const comparison = useMemo(
    () => (data ? buildComparison(data, today, { pending: chat.outbox }) : null),
    [data, today, chat.outbox],
  )
  // Kısılabilir küme kullanıcının seçimi (Ayarlar › Kategoriler); değişince kıyas yeniden hesaplanır.
  const cutLabels = useMemo(() => (data ? cuttableLabels(data.categories) : []), [data])

  if (!data && !error) return <Spinner />

  if (!data || !summary) {
    // Veri yüklenemedi (ör. çevrimdışı): sohbet yine çalışır, harcamalar cihazda bekler.
    return (
      <div className="space-y-4">
        <Card>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadErrorText('veriler', error ?? '')}
          </p>
        </Card>
        <ChatPanel chat={chat} colorOf={colorOf} />
      </div>
    )
  }

  /** Bulunulan döngünün PDF raporu — istemcide, çevrimdışı da (react-pdf tembel yüklenir). */
  async function exportPdf() {
    if (!data || pdf === 'busy') return
    setPdf('busy')
    try {
      // Borçlar alınamazsa (çevrimdışı, önbellek yok) rapor yine üretilir; borç bölümünde not çıkar.
      const [{ exportReportPdf }, debts] = await Promise.all([import('../pdf/exportPdf'), loadDebts().catch(() => null)])
      await exportReportPdf(buildReport({ data, today, debts, pending: chat.outbox }))
      setPdf('idle')
    } catch (e) {
      console.warn('PDF üretilemedi:', e)
      setPdf('error')
    }
  }

  const { window } = data.active
  const day = clampedCycleDay(window, today)
  const total = cycleLength(window.start, window.end)
  const baseline = data.baseline?.cycle ?? null
  const isNewUser = !data.active.cycle && !baseline

  return (
    <div className="space-y-4">
      {/* Döngü başlığı */}
      <header>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Aktif döngü</p>
            <h1 className="text-2xl font-bold tracking-tight">{window.label}</h1>
          </div>
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={pdf === 'busy'}
            aria-busy={pdf === 'busy'}
            className="min-h-10 shrink-0 rounded-xl bg-white px-3 text-sm font-semibold text-emerald-700 shadow-sm ring-1 ring-slate-900/10 hover:bg-emerald-50 disabled:opacity-60 dark:bg-slate-900 dark:text-emerald-400 dark:ring-white/10 dark:hover:bg-emerald-950/40"
          >
            {pdf === 'busy' ? 'Hazırlanıyor…' : 'PDF indir'}
          </button>
        </div>
        {pdf === 'error' && (
          <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
            PDF hazırlanamadı. Biraz sonra tekrar dener misin?
          </p>
        )}
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

      {isNewUser && (
        <Card className="bg-emerald-50 ring-emerald-600/15 dark:bg-emerald-950/40 dark:ring-emerald-400/20">
          <p className="text-sm text-emerald-900 dark:text-emerald-200">
            Hoş geldin! 👋 Henüz hiç verin yok. İlk harcamanı aşağıdaki sohbet kutusuna yazabilir ya da{' '}
            <Link to="/ayarlar" className="font-semibold underline underline-offset-2">
              Ayarlar
            </Link>
            ’dan eski verilerini içe aktarabilirsin.
          </p>
        </Card>
      )}

      <ComparisonCard
        comparison={comparison}
        day={day}
        baselineLabel={baseline ? cycleLabel(baseline.start_date, baseline.end_date) : null}
        activeIsBaseline={!!baseline && baseline.id === data.active.cycle?.id}
        cuttableLabels={cutLabels}
      />

      <KpiGrid summary={summary} />

      <CreditCardCard
        opening={data.active.cycle ? Number(data.active.cycle.cc_opening_balance ?? 0) : null}
        paid={summary.creditCard}
        readOnly={readOnly}
        onSaveOpening={async (amount) => {
          await setCcOpeningBalance(data.active.cycle!.id, amount)
          await reload()
        }}
      />

      <DebtSummaryCard />

      <CategoryCard slices={summary.byCategory} total={summary.variable} />

      <ChatPanel chat={chat} colorOf={colorOf} />
    </div>
  )
}
