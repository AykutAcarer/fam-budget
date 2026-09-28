/**
 * Döngü Detay (codex_prompt.md §6B): döngü seçici, gün gün kümülatif grafik
 * (bu döngü vs baz ay, kısılabilir dörtlü), kategori özeti, değişken harcama
 * listesi (düzenle/sil). Hesaplar compare.ts'te — dashboard kıyas kartıyla aynı.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CategoryBadge } from '../components/CategoryBadge'
import { CategorySummaryTable } from '../components/cycle/CategorySummaryTable'
import { CHART_COLORS } from '../components/cycle/chartColors'
import { ExpenseForm } from '../components/cycle/ExpenseForm'
import { useCycleDetail } from '../components/cycle/useCycleDetail'
import { Card, CardTitle, PageHeader, Spinner } from '../components/ui'
import { createColorLookup } from '../lib/categoryColors'
import { categoryBreakdown, dailyCumulativeSeries } from '../lib/compare'
import { cycleLabel, todayIso } from '../lib/cycle'
import type { VariableExpenseRow } from '../lib/database.types'
import { loadErrorText } from '../lib/loadError'
import { formatEur } from '../lib/format'
import { useIsDark } from '../lib/useIsDark'

const CycleChart = lazy(() => import('../components/cycle/CycleChart'))

const shortRange = (start: string, end: string) => {
  const s = dayjs(start).locale('tr')
  const e = dayjs(end).locale('tr')
  return `${s.format('MMM')}–${e.format('MMM YYYY')}`
}

function Legend({ hasBaseline }: { hasBaseline: boolean }) {
  const c = CHART_COLORS[useIsDark() ? 'dark' : 'light']
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
      <li className="flex items-center gap-1.5">
        <svg width="24" height="8" aria-hidden="true">
          <line x1="0" y1="4" x2="24" y2="4" stroke={c.current} strokeWidth="2.5" />
        </svg>
        Bu döngü (düz çizgi)
      </li>
      {hasBaseline && (
        <li className="flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" stroke={c.baseline} strokeWidth="2" strokeDasharray="6 4" />
          </svg>
          Baz ay (kesikli çizgi)
        </li>
      )}
    </ul>
  )
}

export function CyclePage() {
  const [today] = useState(todayIso)
  const d = useCycleDetail(today)
  const [editing, setEditing] = useState<VariableExpenseRow | null>(null)
  const colorOf = useMemo(() => createColorLookup(d.categories), [d.categories])

  const { selected, baseline, selectedExpenses, baselineExpenses } = d
  // Baz ay seçili döngünün kendisiyse kıyaslanacak başka ay yok.
  const compareBase = baseline && selected && baseline.id !== selected.id ? baseline : null
  const ready = selected && selectedExpenses && (!compareBase || baselineExpenses)

  const selectedCycle = selected ? { start: selected.start_date, end: selected.end_date, expenses: selectedExpenses ?? [] } : null
  const baseCycle = compareBase ? { start: compareBase.start_date, end: compareBase.end_date, expenses: baselineExpenses ?? [] } : null

  // Küçük veri (bir döngü ≈ 100 kalem): her çizimde hesaplamak yeterince ucuz.
  const series = ready && selectedCycle ? dailyCumulativeSeries({ selected: selectedCycle, baseline: baseCycle, today }) : []
  const breakdown =
    ready && selectedCycle ? categoryBreakdown({ selected: selectedCycle, baseline: baseCycle, categories: d.categories }) : null
  const list = useMemo(
    () => [...(selectedExpenses ?? [])].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)),
    [selectedExpenses],
  )

  if (d.loading) return <Spinner />
  if (d.loadError)
    return (
      <>
        <PageHeader title="Döngü Detay" />
        <Card>
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {loadErrorText('veriler', d.loadError)}
          </p>
        </Card>
      </>
    )
  if (!selected)
    return (
      <>
        <PageHeader title="Döngü Detay" />
        <Card className="text-center">
          <p className="font-semibold">Henüz döngü yok</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Sohbetten ilk harcamanı girince ya da{' '}
            <Link to="/ayarlar" className="font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
              Ayarlar
            </Link>
            ’dan verini içe aktarınca döngüler burada listelenir.
          </p>
        </Card>
      </>
    )

  const selectedOption = d.options.find((o) => o.cycle.id === selected.id)!
  const lastPoint = [...series].reverse().find((p) => p.current !== null)

  return (
    <div className="space-y-4">
      <PageHeader title="Döngü Detay" subtitle={`${cycleLabel(selected.start_date, selected.end_date)}${selectedOption.isActive ? ' · aktif' : ''}`} />

      {/* Döngü seçici */}
      <div role="radiogroup" aria-label="Döngü seç" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {d.options.map((o) => {
          const on = o.cycle.id === selected.id
          return (
            <button
              key={o.cycle.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => d.select(o.cycle.id)}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold ring-1 transition-colors ${
                on
                  ? 'bg-slate-900 text-white ring-slate-900 dark:bg-white dark:text-slate-900 dark:ring-white'
                  : 'bg-white text-slate-700 ring-slate-900/10 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-white/10'
              }`}
            >
              {shortRange(o.cycle.start_date, o.cycle.end_date)}
              {o.isActive && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold uppercase ${on ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'}`}>
                  aktif
                </span>
              )}
              {o.isBaseline && (
                <span className={`rounded-full px-1.5 text-[10px] font-bold uppercase ${on ? 'bg-slate-500 text-white dark:bg-slate-400 dark:text-slate-900' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
                  baz ay
                </span>
              )}
            </button>
          )
        })}
      </div>
      {selected.label && selected.label !== cycleLabel(selected.start_date, selected.end_date) && (
        <p className="-mt-2 text-xs text-slate-500 dark:text-slate-400">{selected.label}</p>
      )}

      {!ready || !breakdown ? (
        <Spinner />
      ) : (
        <>
          {/* Kümülatif grafik */}
          <Card>
            <CardTitle>Kısılabilir dörtlü · gün gün kümülatif</CardTitle>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Kahvaltı + İş + Halı saha + Sosyal, döngü gününe göre</p>
            <Legend hasBaseline={!!compareBase} />
            <div
              className="mt-2"
              role="img"
              aria-label={`Kümülatif grafik. Bu döngü${lastPoint ? ` ${lastPoint.day}. gün ${formatEur(lastPoint.current!)}` : ''}${
                lastPoint?.baseline != null ? `, baz ay aynı gün ${formatEur(lastPoint.baseline)}` : ''
              }.`}
            >
              <Suspense fallback={<div className="h-56 rounded-xl bg-slate-100 dark:bg-slate-800" />}>
                <CycleChart data={series} hasBaseline={!!compareBase} />
              </Suspense>
            </div>
            {!compareBase && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {baseline && baseline.id === selected.id ? (
                  'Bu döngü baz ay olarak seçili; kıyas diğer döngülerde görünür.'
                ) : (
                  <>
                    Baz ay seçili değil. Kıyas için{' '}
                    <Link to="/ayarlar" className="font-semibold text-emerald-700 underline underline-offset-2 dark:text-emerald-400">
                      Ayarlar
                    </Link>
                    ’dan baz ay seç.
                  </>
                )}
              </p>
            )}
          </Card>

          {/* Kategori özeti */}
          <Card>
            <CardTitle>Kategori özeti</CardTitle>
            <p className="mt-0.5 mb-2 text-xs text-slate-500 dark:text-slate-400">
              Bu döngü · baz ayın tamamı ({compareBase ? cycleLabel(compareBase.start_date, compareBase.end_date) : 'yok'})
            </p>
            {breakdown.dortlu.length + breakdown.others.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Bu döngüde harcama yok.</p>
            ) : (
              <CategorySummaryTable breakdown={breakdown} colorOf={colorOf} />
            )}
          </Card>

          {/* Harcama listesi */}
          <Card className="px-0 py-2">
            <div className="flex items-baseline justify-between px-4 pt-2 pb-1">
              <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">Değişken harcamalar</h2>
              <span className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                {list.length} kalem · {formatEur(breakdown.total)}
              </span>
            </div>
            {list.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Bu döngüde henüz harcama yok. Harcamalar ana ekrandaki sohbetten girilir.
              </p>
            ) : (
              <ul>
                {list.map((row) => {
                  const date = dayjs(row.date).locale('tr')
                  const label = d.categories.find((c) => c.key === row.category)?.label ?? row.category
                  return (
                    <li key={row.id} className="border-t border-slate-100 first:border-t-0 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        aria-label={`${date.format('D MMMM')}, ${label}, ${row.description || 'açıklama yok'}, ${formatEur(row.amount)} — düzenle`}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      >
                        <span className="w-10 shrink-0 text-center text-xs leading-tight text-slate-500 dark:text-slate-400">
                          <span className="block text-base font-bold text-slate-800 tabular-nums dark:text-slate-100">{date.format('D')}</span>
                          {date.format('MMM')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <CategoryBadge color={colorOf(row.category)}>{label}</CategoryBadge>
                          {row.description && <span className="mt-0.5 block truncate text-sm text-slate-700 dark:text-slate-300">{row.description}</span>}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums">{formatEur(row.amount)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        </>
      )}

      {editing && (
        <ExpenseForm
          row={editing}
          cycle={{ start: selected.start_date, end: selected.end_date }}
          categories={d.categories.map(({ key, label }) => ({ key, label }))}
          colorOf={colorOf}
          onClose={() => setEditing(null)}
          onSave={d.update}
          onDelete={d.remove}
        />
      )}
    </div>
  )
}
