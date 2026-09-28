/**
 * Dashboard verisi ve ondan türetilen rakamlar — saf fonksiyonlar.
 * Tüm para hesapları kodla (compare.ts / money.ts) yapılır.
 */
import { compareToBaseline, type Comparison, type ExpenseLike } from './compare'
import { fromCents, sumMoney, toCents } from './money'
import type { CycleWindow } from './cycle'
import type { CategoryRow, CycleRow, FixedExpenseRow, IncomeRow, VariableExpenseRow } from './database.types'

export interface BudgetData {
  categories: CategoryRow[]
  active: {
    /** Veritabanındaki döngü; bugünü içeren döngü henüz yoksa null. */
    cycle: CycleRow | null
    /** Döngü sınırları (kayıtlı döngüden ya da tarihten hesaplanmış). */
    window: Pick<CycleWindow, 'label' | 'start' | 'end'>
    income: IncomeRow[]
    fixed: FixedExpenseRow[]
    variable: VariableExpenseRow[]
  }
  baseline: { cycle: CycleRow; variable: VariableExpenseRow[] } | null
}

/** Aktif döngünün harcamaları + henüz gönderilmemiş (kuyruktaki) kalemler. */
export function activeExpenses(data: BudgetData, pending: readonly ExpenseLike[] = []): ExpenseLike[] {
  const { start, end } = data.active.window
  return [...data.active.variable, ...pending.filter((p) => p.date >= start && p.date <= end)]
}

/**
 * Aktif döngü vs baz ay kıyası. Baz ay yoksa ya da aktif döngünün kendisi
 * baz aysa null (kıyaslanacak başka ay yok).
 */
export function buildComparison(
  data: BudgetData,
  today: string,
  opts: { pending?: readonly ExpenseLike[]; category?: string } = {},
): Comparison | null {
  const { baseline } = data
  if (!baseline || baseline.cycle.id === data.active.cycle?.id) return null
  return compareToBaseline({
    active: { start: data.active.window.start, end: data.active.window.end, expenses: activeExpenses(data, opts.pending) },
    baseline: { start: baseline.cycle.start_date, end: baseline.cycle.end_date, expenses: baseline.variable },
    today,
    category: opts.category,
  })
}

export const CREDIT_CARD_KEY = 'kredi karti'

export interface CategorySlice {
  key: string
  label: string
  color: string
  amount: number
  /** Toplam içindeki pay, 0–1. */
  share: number
}

export interface CycleSummary {
  income: { total: number; received: number }
  fixed: { total: number; paid: number; remaining: number }
  /** Aktif döngünün tüm değişken harcamaları (kredi kartı ödemesi dahil). */
  variable: number
  /** Bu döngüdeki kredi kartı ödemeleri (değişken harcamanın içinde). */
  creditCard: number
  /** Kategori dağılımı, tutara göre azalan; harcaması olmayan kategoriler yok. */
  byCategory: CategorySlice[]
}

const FALLBACK_COLOR = '#BFBFBF'

/** Aktif döngünün KPI'ları ve kategori dağılımı (kodla, sent hassasiyetinde). */
export function cycleSummary(data: BudgetData, pending: readonly ExpenseLike[] = []): CycleSummary {
  const { income, fixed } = data.active
  const expenses = activeExpenses(data, pending)

  const cents = new Map<string, number>()
  for (const e of expenses) cents.set(e.category, (cents.get(e.category) ?? 0) + toCents(e.amount))
  const totalCents = [...cents.values()].reduce((a, b) => a + b, 0)

  const meta = new Map(data.categories.map((c) => [c.key, c]))
  const byCategory = [...cents.entries()]
    .filter(([, v]) => v > 0)
    .map(([key, v]) => ({
      key,
      label: meta.get(key)?.label ?? key,
      color: meta.get(key)?.color ?? FALLBACK_COLOR,
      amount: fromCents(v),
      share: totalCents ? v / totalCents : 0,
    }))
    .sort((a, b) => b.amount - a.amount || (meta.get(a.key)?.sort_order ?? 0) - (meta.get(b.key)?.sort_order ?? 0))

  const fixedPaid = sumMoney(fixed.filter((f) => f.paid).map((f) => f.amount))
  const fixedTotal = sumMoney(fixed.map((f) => f.amount))
  return {
    income: {
      total: sumMoney(income.map((i) => i.amount)),
      received: sumMoney(income.filter((i) => i.received).map((i) => i.amount)),
    },
    fixed: { total: fixedTotal, paid: fixedPaid, remaining: fromCents(toCents(fixedTotal) - toCents(fixedPaid)) },
    variable: fromCents(totalCents),
    creditCard: fromCents(cents.get(CREDIT_CARD_KEY) ?? 0),
    byCategory,
  }
}
