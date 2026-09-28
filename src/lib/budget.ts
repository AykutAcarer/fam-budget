/**
 * Dashboard verisi ve ondan türetilen rakamlar — saf fonksiyonlar.
 * Tüm para hesapları kodla (compare.ts / money.ts) yapılır.
 */
import { compareToBaseline, type Comparison, type ExpenseLike } from './compare'
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
