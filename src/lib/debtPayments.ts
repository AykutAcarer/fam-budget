/**
 * Borç ödeme geçmişi — saf fonksiyonlar (yan etkisiz, testli).
 * Tutarlar sent cinsinden tam sayıyla hesaplanır. Bakiyenin kendisini
 * veritabanı tetikleyicisi günceller (bkz. 20261004000000_debt_payments.sql);
 * buradaki önizleme ve sınır kontrolü aynı kuralı uygular.
 */
import { parseBalance } from './debts'
import { fromCents, sumMoney, toCents } from './money'

export interface PaymentLike {
  id: string
  debt_id: string
  date: string
  amount: number
  created_at: string
}

/** En yeni önce: tarihe, aynı günse kayıt zamanına göre. */
export function sortPayments<T extends PaymentLike>(payments: readonly T[]): T[] {
  return [...payments].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
}

export function totalPaid(payments: readonly Pick<PaymentLike, 'amount'>[]): number {
  return sumMoney(payments.map((p) => p.amount))
}

/** Borç başına ödemeler (en yeni önce) ve toplam. */
export function paymentsByDebt<T extends PaymentLike>(payments: readonly T[]): Map<string, { list: T[]; total: number }> {
  const map = new Map<string, { list: T[]; total: number }>()
  for (const p of sortPayments(payments)) {
    const entry = map.get(p.debt_id) ?? { list: [], total: 0 }
    entry.list.push(p)
    map.set(p.debt_id, entry)
  }
  for (const entry of map.values()) entry.total = totalPaid(entry.list)
  return map
}

/**
 * Bu ödeme için izin verilen en yüksek tutar: kalan bakiye (+ düzenlenen
 * ödemenin eski tutarı — önce geri alınır).
 */
export function maxPayment(balance: number, editingAmount = 0): number {
  return fromCents(toCents(balance) + toCents(editingAmount))
}

/** Ödeme sonrası kalan bakiye (önizleme). */
export function balanceAfter(balance: number, amount: number, editingAmount = 0): number {
  return fromCents(toCents(balance) + toCents(editingAmount) - toCents(amount))
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface PaymentFormInput {
  date: string
  amount: string
  note: string
}

export interface PaymentFormValue {
  date: string
  amount: number
  note: string | null
}

export type PaymentFormResult =
  | { ok: true; value: PaymentFormValue }
  | { ok: false; errors: Partial<Record<keyof PaymentFormInput, string>> }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * @param max  izin verilen en yüksek tutar (bkz. maxPayment)
 * @param today gelecek tarihli ödeme bakiyeyi şimdiden düşürmesin diye reddedilir
 */
export function validatePaymentForm(input: PaymentFormInput, max: number, today: string): PaymentFormResult {
  const errors: Partial<Record<keyof PaymentFormInput, string>> = {}

  const date = input.date.trim()
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(date))) errors.date = 'Geçerli bir tarih seç.'
  else if (date > today) errors.date = 'Gelecek tarihli ödeme eklenemez.'

  const amount = parseBalance(input.amount)
  if (amount === null || amount <= 0) errors.amount = 'Geçerli bir tutar gir (ör. 150,00).'
  else if (toCents(amount) > toCents(max)) errors.amount = `Ödeme kalan bakiyeden büyük olamaz (en fazla ${formatPlain(max)} €).`

  const note = input.note.trim()
  if (note.length > 200) errors.note = 'Not en fazla 200 karakter.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { date, amount: amount!, note: note || null } }
}

const plain = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const formatPlain = (n: number) => plain.format(n)
