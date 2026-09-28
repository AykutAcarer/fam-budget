/**
 * Tekrar eden harcama tespiti — saf fonksiyon. Sayıyı da hatırlatma kararını
 * da KOD verir; yapay zeka yalnızca verilen sayılarla tek cümle yazar.
 */
import dayjs from 'dayjs'
import type { CycleExpenses } from './compare'
import { fromCents, toCents } from './money'

/** Son kaç günlük pencereye bakılır (bugün dahil). */
export const REPEAT_WINDOW_DAYS = 7
/** Hatırlatma eşiği: pencerede en az bu kadar farklı günde harcama. */
export const REPEAT_THRESHOLD_DAYS = 4

export interface RepeatInfo {
  category: string
  /** Son 7 günde (döngü içinde) bu kategoride harcama yapılan farklı gün sayısı. */
  gunSayisi: number
  /** Pencere uzunluğu (gün). */
  pencereGun: number
  /** Bu kategorinin bu döngüdeki toplamı. */
  kategoriToplam: number
  /** Hatırlatma yapılsın mı? Yalnız kısılabilir kategoride ve eşik aşılınca. */
  hatirlat: boolean
}

export function repeatInfo(params: {
  category: string
  /** Kategori tipi ('zorunlu' | 'kisilabilir' | 'yari' | 'borc'). */
  categoryType: string | undefined
  today: string
  cycle: CycleExpenses
}): RepeatInfo {
  const { category, categoryType, today, cycle } = params
  const windowStart = dayjs(today).subtract(REPEAT_WINDOW_DAYS - 1, 'day').format('YYYY-MM-DD')
  const from = windowStart > cycle.start ? windowStart : cycle.start
  const to = today < cycle.end ? today : cycle.end

  const days = new Set<string>()
  let cents = 0
  for (const e of cycle.expenses) {
    if (e.category !== category || e.date < cycle.start || e.date > cycle.end) continue
    cents += toCents(e.amount)
    if (e.date >= from && e.date <= to) days.add(e.date)
  }
  return {
    category,
    gunSayisi: days.size,
    pencereGun: REPEAT_WINDOW_DAYS,
    kategoriToplam: fromCents(cents),
    hatirlat: categoryType === 'kisilabilir' && days.size >= REPEAT_THRESHOLD_DAYS,
  }
}
