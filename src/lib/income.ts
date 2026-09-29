/**
 * Gelir — saf fonksiyonlar (yan etkisiz, testli). Sabit giderlerle simetrik:
 * döngüye bağlı, tarihli, tekrar eden, "alındı" işaretli kalemler.
 */
import { parseBalance } from './debts'
import { dateForDayInCycle } from './fixed'
import { fromCents, toCents } from './money'

/** Hızlı seçim için bilinen gelir kaynakları. */
export const INCOME_SOURCES = ['Maaş', 'Kinderzuschlag', 'Wohngeld'] as const

export interface IncomeLike {
  date: string
  source: string
  amount: number
  received: boolean
}

export interface IncomeTotals {
  /** Döngünün toplam geliri. */
  total: number
  /** Alınan (received = true). */
  received: number
  /** Beklenen (henüz alınmamış). */
  expected: number
}

/** Toplam / alınan / beklenen — sent cinsinden tam sayıyla. */
export function incomeTotals(items: readonly Pick<IncomeLike, 'amount' | 'received'>[]): IncomeTotals {
  let received = 0
  let expected = 0
  for (const i of items) {
    if (i.received) received += toCents(i.amount)
    else expected += toCents(i.amount)
  }
  return { total: fromCents(received + expected), received: fromCents(received), expected: fromCents(expected) }
}

/** Tarihe göre, aynı günde kaynağa göre (Türkçe). Girdiyi değiştirmez. */
export function sortIncome<T extends IncomeLike>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source, 'tr'))
}

/** "Alındı" işaretini değiştirilmiş yeni liste (iyimser güncelleme). */
export function withReceived<T extends IncomeLike & { id: string }>(items: readonly T[], id: string, received: boolean): T[] {
  return items.map((i) => (i.id === id ? { ...i, received } : i))
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface IncomeFormInput {
  day: string
  source: string
  amount: string
  recurring: boolean
  note: string
}

export interface IncomeFormValue {
  date: string
  source: string
  amount: number
  recurring: boolean
  note: string | null
}

export type IncomeFormResult =
  | { ok: true; value: IncomeFormValue }
  | { ok: false; errors: Partial<Record<keyof IncomeFormInput, string>> }

/** Gün döngü içindeki tarihe yerleşir; tutar Türkçe biçimde ("2.155,00"), 0 kabul (gelmedi). */
export function validateIncomeForm(input: IncomeFormInput, cycle: { start: string; end: string }): IncomeFormResult {
  const errors: Partial<Record<keyof IncomeFormInput, string>> = {}

  const date = /^\d{1,2}$/.test(input.day.trim()) ? dateForDayInCycle(cycle.start, cycle.end, Number(input.day)) : null
  if (!date) errors.day = 'Ayın günü 1–31 arasında olmalı.'

  const source = input.source.trim()
  if (!source) errors.source = 'Gelir kaynağı boş olamaz.'
  else if (source.length > 60) errors.source = 'Kaynak en fazla 60 karakter.'

  const amount = parseBalance(input.amount)
  if (amount === null) errors.amount = 'Geçerli bir tutar gir (ör. 2.155,00).'

  const note = input.note.trim()
  if (note.length > 200) errors.note = 'Not en fazla 200 karakter.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { date: date!, source, amount: amount!, recurring: input.recurring, note: note || null } }
}
