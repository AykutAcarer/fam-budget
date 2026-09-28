/**
 * Değişken harcama düzenleme formu — saf doğrulama.
 * Tarih seçili döngünün içinde kalmalıdır (harcama başka döngüye taşınmaz).
 */
import { parseTurkishAmount } from './fallbackParser'

export interface ExpenseEditInput {
  category: string
  amount: string
  date: string
  description: string
}

export interface ExpenseEditValue {
  category: string
  amount: number
  date: string
  description: string
}

export type ExpenseEditResult =
  | { ok: true; value: ExpenseEditValue }
  | { ok: false; errors: Partial<Record<keyof ExpenseEditInput, string>> }

export function validateExpenseEdit(
  input: ExpenseEditInput,
  cycle: { start: string; end: string },
  categoryKeys: readonly string[],
): ExpenseEditResult {
  const errors: Partial<Record<keyof ExpenseEditInput, string>> = {}

  if (!categoryKeys.includes(input.category)) errors.category = 'Bir kategori seç.'

  const amount = /^\s*\d[\d.,]*\s*$/.test(input.amount) ? parseTurkishAmount(input.amount.trim()) : null
  if (amount === null) errors.amount = 'Geçerli bir tutar gir (ör. 8,25).'

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) errors.date = 'Tarih seç.'
  else if (input.date < cycle.start || input.date > cycle.end) errors.date = 'Tarih bu döngünün içinde olmalı.'

  const description = input.description.trim()
  if (description.length > 200) errors.description = 'Açıklama en fazla 200 karakter.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { category: input.category, amount: amount!, date: input.date, description } }
}
