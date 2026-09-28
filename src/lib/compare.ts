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
