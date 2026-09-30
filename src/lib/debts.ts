/**
 * Borçlar — saf fonksiyonlar (yan etkisiz, testli).
 * Para toplamları sent cinsinden tam sayıyla yapılır; UI yalnızca gösterir.
 *
 * Borçlar faizsiz aile borçlarıdır: faizli/faizsiz ayrımı yoktur. Kredi kartı
 * borçlardan çıkarıldı; ana ekrandaki kredi kartı takibinde (creditCard.ts).
 * debts.interest / has_interest sütunları veritabanında duruyor ama hiçbir
 * hesapta ve ekranda kullanılmıyor.
 */
import { cycleDay } from './cycle'
import { clampIsoDate } from './date'
import { parseTurkishAmount } from './fallbackParser'
import { fromCents, toCents } from './money'

/** Vade uyarı penceresi (gün). */
export const DUE_SOON_DAYS = 30

export interface DebtLike {
  name: string
  balance: number
  due_date: string | null
  priority: number
}

// ---------------------------------------------------------------------------
// Toplamlar
// ---------------------------------------------------------------------------

export interface DebtTotals {
  total: number
}

export function debtTotals(debts: readonly Pick<DebtLike, 'balance'>[]): DebtTotals {
  return { total: fromCents(debts.reduce((s, d) => s + toCents(d.balance), 0)) }
}

// ---------------------------------------------------------------------------
// Sıralama: öncelik numarası (küçük önce)
// ---------------------------------------------------------------------------

/** Öncelik (küçük önce); eşitlikte bakiye (yüksek önce), sonra ad. */
export function compareDebts(a: DebtLike, b: DebtLike): number {
  return a.priority - b.priority || b.balance - a.balance || a.name.localeCompare(b.name, 'tr')
}

export function sortDebts<T extends DebtLike>(debts: readonly T[]): T[] {
  return [...debts].sort(compareDebts)
}

// ---------------------------------------------------------------------------
// Vade
// ---------------------------------------------------------------------------

export type DueStatus =
  | { kind: 'yok' }
  | { kind: 'gecti'; date: string; days: number }
  | { kind: 'yaklasiyor'; date: string; days: number }
  | { kind: 'ileri'; date: string; days: number }

/** Vade tarihi: 'YYYY-MM-DD' olduğu gibi; 'YYYY-MM' ise ayın ilk günü (uyarı erken çıksın). */
export function dueDateOf(due: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due
  if (/^\d{4}-\d{2}$/.test(due)) return `${due}-01`
  return null
}

/**
 * Vade durumu (bugüne göre): geçmişse "gecti"; 0–30 gün içindeyse "yaklasiyor";
 * daha ilerideyse "ileri"; vade yoksa "yok".
 */
export function dueStatus(due: string | null, today: string): DueStatus {
  const date = due ? dueDateOf(due) : null
  if (!date) return { kind: 'yok' }
  const days = cycleDay(today, date) - 1
  if (days < 0) return { kind: 'gecti', date, days }
  if (days <= DUE_SOON_DAYS) return { kind: 'yaklasiyor', date, days }
  return { kind: 'ileri', date, days }
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface DebtFormInput {
  name: string
  balance: string
  /** 'YYYY-MM' (type="month"), boş = vade yok. */
  dueMonth: string
  /** Ayın günü, boş = yalnız ay. */
  dueDay: string
  priority: string
  note: string
}

export interface DebtFormValue {
  name: string
  balance: number
  due_date: string | null
  priority: number
  note: string | null
}

export type DebtFormResult =
  | { ok: true; value: DebtFormValue }
  | { ok: false; errors: Partial<Record<keyof DebtFormInput, string>> }

/** "6.026,31" → 6026.31; "0" / "0,00" → 0 (kapanmış borç). */
export function parseBalance(raw: string): number | null {
  const s = raw.trim().replace(/\s*€$/, '')
  if (/^0+([.,]0+)?$/.test(s)) return 0
  return /^\d[\d.,]*$/.test(s) ? parseTurkishAmount(s) : null
}

/** Mevcut vadeyi form alanlarına ayırır (kayıpsız). */
export function splitDueDate(due: string | null): { dueMonth: string; dueDay: string } {
  if (!due) return { dueMonth: '', dueDay: '' }
  return { dueMonth: due.slice(0, 7), dueDay: due.length === 10 ? String(Number(due.slice(8))) : '' }
}

export function validateDebtForm(input: DebtFormInput): DebtFormResult {
  const errors: Partial<Record<keyof DebtFormInput, string>> = {}

  const name = input.name.trim()
  if (!name) errors.name = 'Borç adı boş olamaz.'
  else if (name.length > 80) errors.name = 'Borç adı en fazla 80 karakter.'

  const balance = parseBalance(input.balance)
  if (balance === null) errors.balance = 'Geçerli bir bakiye gir (ör. 6.026,31).'

  let due_date: string | null = null
  const month = input.dueMonth.trim()
  const dayRaw = input.dueDay.trim()
  if (month) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) errors.dueMonth = 'Vade ayı geçersiz.'
    else if (dayRaw) {
      const day = Number(dayRaw)
      if (!Number.isInteger(day) || day < 1 || day > 31) errors.dueDay = 'Gün 1–31 arasında olmalı.'
      else due_date = clampIsoDate(`${month}-${String(day).padStart(2, '0')}`)
    } else due_date = month
  } else if (dayRaw) errors.dueMonth = 'Gün girdiysen vade ayını da seç.'

  const priority = Number(input.priority)
  if (!/^\d{1,3}$/.test(input.priority.trim()) || priority < 1) errors.priority = 'Öncelik 1 veya daha büyük bir tam sayı olmalı.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: {
      name,
      balance: balance!,
      due_date,
      priority,
      note: input.note.trim() || null,
    },
  }
}

/** Yeni borç için önerilen öncelik: mevcutların en büyüğü + 1. */
export function nextPriority(debts: readonly Pick<DebtLike, 'priority'>[]): number {
  return debts.reduce((max, d) => Math.max(max, d.priority), 0) + 1
}
