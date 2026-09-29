/**
 * Sabit giderler / ödeme takvimi — saf fonksiyonlar (yan etkisiz, testli).
 * Para toplamları sent cinsinden tam sayıyla yapılır; UI yalnızca gösterir.
 */
import { cycleDay } from './cycle'
import { clampIsoDate } from './date'
import { foldTurkish, parseTurkishAmount } from './fallbackParser'
import { fromCents, toCents } from './money'

/** Yaklaşan uyarı penceresi: bugünden itibaren kaç gün. */
export const UPCOMING_DAYS = 3

export type FixedStatus = 'gecikmis' | 'bugun' | 'yaklasan' | 'ileri' | 'odendi'

export interface FixedLike {
  date: string
  item: string
  amount: number
  paid: boolean
}

/** Bugünden hedef tarihe kaç gün var (geçmişse negatif). Döngü günü mantığıyla. */
export function daysUntil(date: string, today: string): number {
  return cycleDay(today, date) - 1
}

/**
 * Durum (bugüne göre):
 *  - odendi:   paid
 *  - gecikmis: tarih < bugün
 *  - bugun:    tarih = bugün
 *  - yaklasan: bugün < tarih ≤ bugün + 3
 *  - ileri:    tarih > bugün + 3
 */
export function fixedStatus(item: Pick<FixedLike, 'date' | 'paid'>, today: string): FixedStatus {
  if (item.paid) return 'odendi'
  const d = daysUntil(item.date, today)
  if (d < 0) return 'gecikmis'
  if (d === 0) return 'bugun'
  if (d <= UPCOMING_DAYS) return 'yaklasan'
  return 'ileri'
}

/** Ödeme gününe göre sıralar; aynı günde kalem adına göre (Türkçe). Girdiyi değiştirmez. */
export function sortFixed<T extends FixedLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.item.localeCompare(b.item, 'tr'))
}

export interface FixedTotals {
  /** Toplam sabit gider. */
  total: number
  /** Ödenen (paid = true). */
  paid: number
  /** Kalan (paid = false). */
  remaining: number
}

/** Toplam / ödenen / kalan — sent cinsinden tam sayıyla. */
export function fixedTotals(items: readonly Pick<FixedLike, 'amount' | 'paid'>[]): FixedTotals {
  let paid = 0
  let remaining = 0
  for (const i of items) {
    if (i.paid) paid += toCents(i.amount)
    else remaining += toCents(i.amount)
  }
  return { total: fromCents(paid + remaining), paid: fromCents(paid), remaining: fromCents(remaining) }
}

/** Uyarı şeridi: gecikmiş (en eski önce), sonra bugün ve yaklaşan (tarihe göre). */
export function alertItems<T extends FixedLike>(items: readonly T[], today: string): T[] {
  const rank: Partial<Record<FixedStatus, number>> = { gecikmis: 0, bugun: 1, yaklasan: 1 }
  return sortFixed(items)
    .filter((i) => rank[fixedStatus(i, today)] !== undefined)
    .sort((a, b) => rank[fixedStatus(a, today)]! - rank[fixedStatus(b, today)]!)
}

/** Kaynak karttan çekim mi? ("kart", "Kredi kartı", "KK" …) */
export function isCardSource(source: string | null | undefined): boolean {
  if (!source) return false
  const s = foldTurkish(source)
  return /\bkart/.test(s) || /\bkk\b/.test(s)
}

/**
 * Ayın gününü döngü içindeki tarihe çevirir. Döngü iki takvim ayına yayılır
 * (15 Eyl – 14 Eki): 22 → 22 Eyl, 7 → 7 Eki. Ayda o gün yoksa ay sonuna çekilir
 * (31 → 30 Eyl). Döngüye düşmezse null.
 */
export function dateForDayInCycle(start: string, end: string, day: number): string | null {
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const [y, m] = start.split('-').map(Number)
  const next = m === 12 ? [y + 1, 1] : [y, m + 1]
  for (const [yy, mm] of [[y, m], next]) {
    const date = clampIsoDate(`${yy}-${pad(mm)}-${pad(day)}`)
    if (date >= start && date <= end) return date
  }
  return null
}

// ---------------------------------------------------------------------------
// Form doğrulama
// ---------------------------------------------------------------------------

export interface FixedFormInput {
  day: string
  item: string
  amount: string
  card: boolean
  installmentsLeft: string
  /** Her döngüde tekrar eder mi (devirde taşınır)? */
  recurring: boolean
}

export interface FixedFormValue {
  date: string
  item: string
  amount: number
  installmentsLeft: number | null
  recurring: boolean
}

export type FixedFormResult =
  | { ok: true; value: FixedFormValue }
  | { ok: false; errors: Partial<Record<keyof FixedFormInput, string>> }

/** Formu doğrular ve döngü içindeki tarihe çevirir. Tutar Türkçe biçimde ("12,50"). */
export function validateFixedForm(input: FixedFormInput, cycle: { start: string; end: string }): FixedFormResult {
  const errors: Partial<Record<keyof FixedFormInput, string>> = {}

  const day = Number(input.day)
  const date = /^\d{1,2}$/.test(input.day.trim()) ? dateForDayInCycle(cycle.start, cycle.end, day) : null
  if (!date) errors.day = 'Ayın günü 1–31 arasında olmalı.'

  const item = input.item.trim()
  if (!item) errors.item = 'Kalem adı boş olamaz.'
  else if (item.length > 80) errors.item = 'Kalem adı en fazla 80 karakter.'

  const amount = /^\s*\d[\d.,]*\s*$/.test(input.amount) ? parseTurkishAmount(input.amount.trim()) : null
  if (amount === null) errors.amount = 'Geçerli bir tutar gir (ör. 49,99).'

  let installmentsLeft: number | null = null
  if (input.installmentsLeft.trim()) {
    const n = Number(input.installmentsLeft)
    if (!Number.isInteger(n) || n < 0 || n > 999) errors.installmentsLeft = 'Kalan taksit 0 veya pozitif bir tam sayı olmalı.'
    else installmentsLeft = n
  }

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { date: date!, item, amount: amount!, installmentsLeft, recurring: input.recurring } }
}

/**
 * Kaynak alanının yeni değeri. Karttan çekiliyorsa mevcut kart kaynağı korunur
 * (ör. "Kredi kartı"), yoksa 'kart'; değilse kart dışı mevcut kaynak korunur.
 */
export function nextSource(current: string | null, card: boolean): string | null {
  if (card) return isCardSource(current) ? current : 'kart'
  return isCardSource(current) ? null : current
}
