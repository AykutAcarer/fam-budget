/**
 * Kıyas motoru — uygulamanın kalbi. Saf fonksiyonlar, yan etkisiz.
 *
 * ALTIN KURAL: para matematiği (kümülatif toplam, baz ay kıyası, fark) her
 * zaman burada, kodla yapılır. Yapay zeka bu rakamları yalnızca cümleye döker.
 *
 * Kıyaslar takvim gününe değil DÖNGÜ GÜNÜNE göre yapılır: bu döngünün 14.
 * günü, baz ayın 14. günüyle karşılaştırılır (döngü 15'inde başlar).
 */
import { cycleDay, cycleLength } from './cycle'
import { fromCents, toCents } from './money'

/** "Kısılabilir dörtlü": tasarrufun asıl yapılabileceği kategoriler. */
export const DORTLU = ['kahvalti', 'is', 'halisaha', 'sosyal'] as const

export interface ExpenseLike {
  date: string
  category: string
  amount: number
}

export interface CycleExpenses {
  start: string
  end: string
  expenses: readonly ExpenseLike[]
}

export interface Comparison {
  /** Aktif döngünün bugünkü günü (1'den başlar). */
  cycleDay: number
  /** Bu döngü, bugüne kadar dörtlü toplamı. */
  dortluBuAy: number
  /** Baz ay, aynı döngü gününe kadar dörtlü toplamı. */
  dortluBazAy: number
  /** dortluBuAy − dortluBazAy. Negatif = kullanıcı önde (tasarruflu). */
  fark: number
  /** İstenen kategorinin durumu (kategori verilmediyse null). */
  kategori: CategoryStatus | null
}

export interface CategoryStatus {
  key: string
  /** Bu döngü, bugüne kadar. */
  buAy: number
  /** Baz ayın tamamı. */
  bazAyTumAy: number
}

/** Tarihin döngü günü, döngü sınırları içine sıkıştırılmış (1..uzunluk). */
export function clampedCycleDay(cycle: Pick<CycleExpenses, 'start' | 'end'>, date: string): number {
  return Math.min(Math.max(cycleDay(cycle.start, date), 1), cycleLength(cycle.start, cycle.end))
}

/**
 * Döngünün 1..uptoDay günlerindeki harcamaların kategori bazlı toplamı (euro).
 * Döngü aralığı dışındaki kayıtlar sayılmaz.
 */
export function cumulativeByCategory(cycle: CycleExpenses, uptoDay: number): Record<string, number> {
  const cents: Record<string, number> = {}
  for (const e of cycle.expenses) {
    if (e.date < cycle.start || e.date > cycle.end) continue
    if (cycleDay(cycle.start, e.date) > uptoDay) continue
    cents[e.category] = (cents[e.category] ?? 0) + toCents(e.amount)
  }
  return Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, fromCents(v)]))
}

/** Kategori toplamlarından dörtlü toplamı. */
export function dortluTotal(byCategory: Readonly<Record<string, number>>): number {
  return fromCents(DORTLU.reduce((sum, key) => sum + toCents(byCategory[key] ?? 0), 0))
}

/**
 * Aktif döngüyü bugüne kadar, baz ayın aynı döngü gününe kadarki haliyle kıyaslar.
 * Baz ay yoksa null döner (UI "baz ay seçili değil" gösterir).
 *
 * Baz ay daha kısaysa (ör. 28 gün) ve bugün 30. günse, baz ayın tamamı alınır.
 */
export function compareToBaseline(params: {
  active: CycleExpenses
  baseline: CycleExpenses | null
  today: string
  /** Kategori durumu istenen kategori (ör. az önce girilen harcamanınki). */
  category?: string
}): Comparison | null {
  const { active, baseline, today, category } = params
  if (!baseline) return null

  const day = clampedCycleDay(active, today)
  const baselineDay = Math.min(day, cycleLength(baseline.start, baseline.end))

  const buAy = cumulativeByCategory(active, day)
  const bazAy = cumulativeByCategory(baseline, baselineDay)
  const dortluBuAy = dortluTotal(buAy)
  const dortluBazAy = dortluTotal(bazAy)

  let kategori: CategoryStatus | null = null
  if (category) {
    const bazAyTumAy = cumulativeByCategory(baseline, cycleLength(baseline.start, baseline.end))
    kategori = { key: category, buAy: buAy[category] ?? 0, bazAyTumAy: bazAyTumAy[category] ?? 0 }
  }

  return {
    cycleDay: day,
    dortluBuAy,
    dortluBazAy,
    fark: fromCents(toCents(dortluBuAy) - toCents(dortluBazAy)),
    kategori,
  }
}

// ---------------------------------------------------------------------------
// Döngü detay ekranı: döngü seçici, kategori özeti, gün gün kümülatif seri
// ---------------------------------------------------------------------------

const isDortlu = (category: string) => (DORTLU as readonly string[]).includes(category)

export interface CycleLike {
  id: string
  label: string
  start_date: string
  end_date: string
  is_baseline: boolean
}

export interface CycleOption<T extends CycleLike = CycleLike> {
  cycle: T
  /** Bugünü içeren döngü mü? */
  isActive: boolean
  isBaseline: boolean
}

/** Döngü seçici: en yeniden eskiye; aktif ve baz ay işaretli. */
export function cycleOptions<T extends CycleLike>(cycles: readonly T[], today: string): CycleOption<T>[] {
  return [...cycles]
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .map((cycle) => ({
      cycle,
      isActive: cycle.start_date <= today && today <= cycle.end_date,
      isBaseline: cycle.is_baseline,
    }))
}

/** Varsayılan seçim: aktif döngü; yoksa bugünden önce başlayan en yeni; o da yoksa en yeni. */
export function defaultCycleId(options: readonly CycleOption[], today: string): string | null {
  return (
    options.find((o) => o.isActive)?.cycle.id ??
    options.find((o) => o.cycle.start_date <= today)?.cycle.id ??
    options[0]?.cycle.id ??
    null
  )
}

export interface CategoryMeta {
  key: string
  label: string
  type: string
  sort_order: number
}

export interface CategoryBreakdownRow {
  key: string
  label: string
  type: string
  dortlu: boolean
  /** Seçili döngüdeki toplam. */
  current: number
  /** Baz ayın tamamındaki toplam; baz ay yoksa null. */
  baseline: number | null
  /** current − baseline; baz ay yoksa null. */
  diff: number | null
}

export interface CategoryBreakdown {
  /** Kısılabilir dörtlü satırları (tutara göre azalan). */
  dortlu: CategoryBreakdownRow[]
  /** Diğer kategoriler (tutara göre azalan). */
  others: CategoryBreakdownRow[]
  /** Dörtlü ara toplamı (grafiğin son noktasıyla aynı). */
  dortluTotal: { current: number; baseline: number | null; diff: number | null }
  /** Seçili döngünün tüm değişken harcaması. */
  total: number
}

function centsByCategory(expenses: readonly ExpenseLike[], start: string, end: string): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of expenses) {
    if (e.date < start || e.date > end) continue
    map.set(e.category, (map.get(e.category) ?? 0) + toCents(e.amount))
  }
  return map
}

/**
 * Seçili döngünün kategori toplamları + baz ayın aynı kategorideki (tüm ay)
 * toplamı. Her iki döngüde de harcaması olmayan kategoriler listelenmez.
 */
export function categoryBreakdown(params: {
  selected: CycleExpenses
  baseline: CycleExpenses | null
  categories: readonly CategoryMeta[]
}): CategoryBreakdown {
  const { selected, baseline, categories } = params
  const cur = centsByCategory(selected.expenses, selected.start, selected.end)
  const base = baseline ? centsByCategory(baseline.expenses, baseline.start, baseline.end) : null
  const meta = new Map(categories.map((c) => [c.key, c]))

  const keys = new Set([...cur.keys(), ...(base?.keys() ?? [])])
  const rows: CategoryBreakdownRow[] = [...keys].map((key) => {
    const c = cur.get(key) ?? 0
    const b = base ? (base.get(key) ?? 0) : null
    return {
      key,
      label: meta.get(key)?.label ?? key,
      type: meta.get(key)?.type ?? 'kisilabilir',
      dortlu: isDortlu(key),
      current: fromCents(c),
      baseline: b === null ? null : fromCents(b),
      diff: b === null ? null : fromCents(c - b),
    }
  })
  const order = (a: CategoryBreakdownRow, b: CategoryBreakdownRow) =>
    b.current - a.current || (b.baseline ?? 0) - (a.baseline ?? 0) || (meta.get(a.key)?.sort_order ?? 99) - (meta.get(b.key)?.sort_order ?? 99)

  const dortluCur = [...cur].filter(([k]) => isDortlu(k)).reduce((s, [, v]) => s + v, 0)
  const dortluBase = base ? [...base].filter(([k]) => isDortlu(k)).reduce((s, [, v]) => s + v, 0) : null
  return {
    dortlu: rows.filter((r) => r.dortlu).sort(order),
    others: rows.filter((r) => !r.dortlu).sort(order),
    dortluTotal: {
      current: fromCents(dortluCur),
      baseline: dortluBase === null ? null : fromCents(dortluBase),
      diff: dortluBase === null ? null : fromCents(dortluCur - dortluBase),
    },
    total: fromCents([...cur.values()].reduce((a, b) => a + b, 0)),
  }
}

export interface DailyPoint {
  /** Döngü günü (1'den başlar). */
  day: number
  /** Seçili döngünün o güne kadarki dörtlü kümülatifi; gelecek/olmayan gün için null. */
  current: number | null
  /** Baz ayın o güne kadarki dörtlü kümülatifi; baz ay yoksa ya da o gün yoksa null. */
  baseline: number | null
}

/** Döngü günlerine göre dörtlü harcamanın kümülatif serisi (sent → euro). */
function dortluCumulative(cycle: CycleExpenses, lastDay: number): number[] {
  const perDay = new Array<number>(lastDay + 1).fill(0)
  for (const e of cycle.expenses) {
    if (!isDortlu(e.category) || e.date < cycle.start || e.date > cycle.end) continue
    const d = cycleDay(cycle.start, e.date)
    if (d <= lastDay) perDay[d] += toCents(e.amount)
  }
  const out: number[] = []
  let acc = 0
  for (let d = 1; d <= lastDay; d++) out.push(fromCents((acc += perDay[d])))
  return out
}

/**
 * Gün gün kümülatif kısılabilir dörtlü (grafik). x ekseni 1..max(döngü uzunlukları).
 * Seçili döngü aktifse yalnızca bugüne kadar dolu, sonrası null; henüz
 * başlamamışsa tamamı null. Baz ay serisi döngünün tamamı boyunca.
 */
export function dailyCumulativeSeries(params: {
  selected: CycleExpenses
  baseline: CycleExpenses | null
  today: string
}): DailyPoint[] {
  const { selected, baseline, today } = params
  const selLen = cycleLength(selected.start, selected.end)
  const baseLen = baseline ? cycleLength(baseline.start, baseline.end) : 0
  const lastDrawn = today < selected.start ? 0 : today > selected.end ? selLen : cycleDay(selected.start, today)

  const cur = dortluCumulative(selected, lastDrawn)
  const base = baseline ? dortluCumulative(baseline, baseLen) : []
  return Array.from({ length: Math.max(selLen, baseLen) }, (_, i) => ({
    day: i + 1,
    current: i < lastDrawn ? cur[i] : null,
    baseline: baseline && i < baseLen ? base[i] : null,
  }))
}
