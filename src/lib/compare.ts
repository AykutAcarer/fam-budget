/**
 * Kıyas motoru — uygulamanın kalbi. Saf fonksiyonlar, yan etkisiz.
 *
 * ALTIN KURAL: para matematiği (kümülatif toplam, baz ay kıyası, fark) her
 * zaman burada, kodla yapılır. Yapay zeka bu rakamları yalnızca cümleye döker.
 *
 * Kıyaslar takvim gününe değil DÖNGÜ GÜNÜNE göre yapılır: bu döngünün 14.
 * günü, baz ayın 14. günüyle karşılaştırılır (döngü 15'inde başlar).
 *
 * Hangi kategorilerin "kısılabilir" sayılacağını kullanıcı seçer
 * (categories.is_cuttable); motor bu key listesini parametre olarak alır.
 * Alan adlarındaki "dortlu" tarihseldir (ilk sürümdeki sabit dört kategori);
 * anlamı "kullanıcının kısılabilir seçtiği kategoriler"dir.
 */
import { cycleDay, cycleLength } from './cycle'
import { fromCents, toCents } from './money'

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
  /** Bu döngü, bugüne kadar kısılabilir kategoriler toplamı. */
  dortluBuAy: number
  /** Baz ay, aynı döngü gününe kadar kısılabilir kategoriler toplamı. */
  dortluBazAy: number
  /** dortluBuAy − dortluBazAy. Negatif = kullanıcı önde (tasarruflu). */
  fark: number
  /** İstenen kategorinin durumu (kategori verilmediyse null). */
  kategori: CategoryStatus | null
  /** Kıyasa dahil (kısılabilir) kategori key'leri; boşsa kıyas 0'dır ve UI nötr mesaj gösterir. */
  kisilabilir: string[]
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

/** Kategori toplamlarından kısılabilir kategorilerin toplamı. */
export function cuttableSum(byCategory: Readonly<Record<string, number>>, cuttableKeys: readonly string[]): number {
  return fromCents([...new Set(cuttableKeys)].reduce((sum, key) => sum + toCents(byCategory[key] ?? 0), 0))
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
  /** Kısılabilir sayılan kategori key'leri (kullanıcının seçimi). Boşsa toplamlar 0. */
  cuttableKeys: readonly string[]
  /** Kategori durumu istenen kategori (ör. az önce girilen harcamanınki). */
  category?: string
}): Comparison | null {
  const { active, baseline, today, category, cuttableKeys } = params
  if (!baseline) return null

  const day = clampedCycleDay(active, today)
  const baselineDay = Math.min(day, cycleLength(baseline.start, baseline.end))

  const buAy = cumulativeByCategory(active, day)
  const bazAy = cumulativeByCategory(baseline, baselineDay)
  const dortluBuAy = cuttableSum(buAy, cuttableKeys)
  const dortluBazAy = cuttableSum(bazAy, cuttableKeys)

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
    kisilabilir: [...new Set(cuttableKeys)],
  }
}

// ---------------------------------------------------------------------------
// Döngü detay ekranı: döngü seçici, kategori özeti, gün gün kümülatif seri
// ---------------------------------------------------------------------------

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

/**
 * Baz ayı değiştirir (iyimser arayüz güncellemesi için): seçilen döngü baz ay,
 * diğerlerinin hepsi değil — tek baz ay kuralı (sunucuda set_baseline_cycle ile aynı).
 * Girdiyi değiştirmez.
 */
export function withBaseline<T extends CycleLike>(cycles: readonly T[], id: string): T[] {
  return cycles.map((c) => ({ ...c, is_baseline: c.id === id }))
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
  /** Yalnız görüntü için (Zorunlu / Esnek / …); gruplama `cuttable`'a göredir. */
  type: string
  /** Kullanıcının kısılabilir seçtiği kategori mi? */
  cuttable: boolean
  /** Seçili döngüdeki toplam. */
  current: number
  /** Baz ayın tamamındaki toplam; baz ay yoksa null. */
  baseline: number | null
  /** current − baseline; baz ay yoksa null. */
  diff: number | null
}

export interface CategoryBreakdown {
  /** Kısılabilir kategori satırları (tutara göre azalan). */
  cuttable: CategoryBreakdownRow[]
  /** Diğer kategoriler (tutara göre azalan). */
  others: CategoryBreakdownRow[]
  /** Kısılabilir ara toplam (grafiğin son noktasıyla aynı). */
  cuttableTotal: { current: number; baseline: number | null; diff: number | null }
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
  /** Kısılabilir sayılan kategori key'leri (kullanıcının seçimi). */
  cuttableKeys: readonly string[]
}): CategoryBreakdown {
  const { selected, baseline, categories } = params
  const cuttableSet = new Set(params.cuttableKeys)
  const cur = centsByCategory(selected.expenses, selected.start, selected.end)
  const base = baseline ? centsByCategory(baseline.expenses, baseline.start, baseline.end) : null
  const meta = new Map(categories.map((c) => [c.key, c]))
  const isCuttable = (key: string) => cuttableSet.has(key)

  const keys = new Set([...cur.keys(), ...(base?.keys() ?? [])])
  const rows: CategoryBreakdownRow[] = [...keys].map((key) => {
    const c = cur.get(key) ?? 0
    const b = base ? (base.get(key) ?? 0) : null
    return {
      key,
      label: meta.get(key)?.label ?? key,
      type: meta.get(key)?.type ?? '',
      cuttable: isCuttable(key),
      current: fromCents(c),
      baseline: b === null ? null : fromCents(b),
      diff: b === null ? null : fromCents(c - b),
    }
  })
  const order = (a: CategoryBreakdownRow, b: CategoryBreakdownRow) =>
    b.current - a.current || (b.baseline ?? 0) - (a.baseline ?? 0) || (meta.get(a.key)?.sort_order ?? 99) - (meta.get(b.key)?.sort_order ?? 99)

  const cutCur = [...cur].filter(([k]) => isCuttable(k)).reduce((s, [, v]) => s + v, 0)
  const cutBase = base ? [...base].filter(([k]) => isCuttable(k)).reduce((s, [, v]) => s + v, 0) : null
  return {
    cuttable: rows.filter((r) => r.cuttable).sort(order),
    others: rows.filter((r) => !r.cuttable).sort(order),
    cuttableTotal: {
      current: fromCents(cutCur),
      baseline: cutBase === null ? null : fromCents(cutBase),
      diff: cutBase === null ? null : fromCents(cutCur - cutBase),
    },
    total: fromCents([...cur.values()].reduce((a, b) => a + b, 0)),
  }
}

export interface DailyPoint {
  /** Döngü günü (1'den başlar). */
  day: number
  /** Seçili döngünün o güne kadarki kısılabilir kümülatifi; gelecek/olmayan gün için null. */
  current: number | null
  /** Baz ayın o güne kadarki kısılabilir kümülatifi; baz ay yoksa ya da o gün yoksa null. */
  baseline: number | null
}

/** Döngü günlerine göre kısılabilir harcamanın kümülatif serisi (sent → euro). */
function cuttableCumulative(cycle: CycleExpenses, lastDay: number, keys: ReadonlySet<string>): number[] {
  const perDay = new Array<number>(lastDay + 1).fill(0)
  for (const e of cycle.expenses) {
    if (!keys.has(e.category) || e.date < cycle.start || e.date > cycle.end) continue
    const d = cycleDay(cycle.start, e.date)
    if (d <= lastDay) perDay[d] += toCents(e.amount)
  }
  const out: number[] = []
  let acc = 0
  for (let d = 1; d <= lastDay; d++) out.push(fromCents((acc += perDay[d])))
  return out
}

/**
 * Gün gün kümülatif kısılabilir harcama (grafik). x ekseni 1..max(döngü uzunlukları).
 * Seçili döngü aktifse yalnızca bugüne kadar dolu, sonrası null; henüz
 * başlamamışsa tamamı null. Baz ay serisi döngünün tamamı boyunca.
 */
export function dailyCumulativeSeries(params: {
  selected: CycleExpenses
  baseline: CycleExpenses | null
  today: string
  /** Kısılabilir sayılan kategori key'leri (kullanıcının seçimi). */
  cuttableKeys: readonly string[]
}): DailyPoint[] {
  const { selected, baseline, today } = params
  const keys = new Set(params.cuttableKeys)
  const selLen = cycleLength(selected.start, selected.end)
  const baseLen = baseline ? cycleLength(baseline.start, baseline.end) : 0
  const lastDrawn = today < selected.start ? 0 : today > selected.end ? selLen : cycleDay(selected.start, today)

  const cur = cuttableCumulative(selected, lastDrawn, keys)
  const base = baseline ? cuttableCumulative(baseline, baseLen, keys) : []
  return Array.from({ length: Math.max(selLen, baseLen) }, (_, i) => ({
    day: i + 1,
    current: i < lastDrawn ? cur[i] : null,
    baseline: baseline && i < baseLen ? base[i] : null,
  }))
}
