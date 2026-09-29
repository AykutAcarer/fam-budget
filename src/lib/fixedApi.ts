/**
 * Sabit giderler — Supabase işlemleri. RLS: her satır giriş yapmış kullanıcıya aittir
 * (user_id varsayılan olarak auth.uid()).
 */
import type { CycleWindow } from './cycle'
import { cycleLabel, cycleWindowFor } from './cycle'
import type { CycleRow, FixedExpenseRow, IncomeRow } from './database.types'
import { ensureCycleFor } from './expensesApi'
import { supabase } from './supabase'

export interface FixedData {
  /** Bugünü içeren kayıtlı döngü (yoksa null; ilk eklemede oluşturulur). */
  cycle: CycleRow | null
  window: Pick<CycleWindow, 'label' | 'start' | 'end'>
  items: FixedExpenseRow[]
  /** Aynı döngünün gelir kalemleri. */
  income: IncomeRow[]
}

export async function loadFixed(today: string): Promise<FixedData> {
  const cycleRes = await supabase
    .from('cycles')
    .select('*')
    .lte('start_date', today)
    .gte('end_date', today)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (cycleRes.error) throw cycleRes.error
  const cycle = cycleRes.data
  if (!cycle) return { cycle: null, window: cycleWindowFor(today), items: [], income: [] }

  const [itemsRes, incomeRes] = await Promise.all([
    supabase.from('fixed_expenses').select('*').eq('cycle_id', cycle.id).order('date'),
    supabase.from('income').select('*').eq('cycle_id', cycle.id).order('date'),
  ])
  if (itemsRes.error) throw itemsRes.error
  if (incomeRes.error) throw incomeRes.error
  return {
    cycle,
    window: { label: cycleLabel(cycle.start_date, cycle.end_date), start: cycle.start_date, end: cycle.end_date },
    items: itemsRes.data,
    income: incomeRes.data,
  }
}

export interface FixedInput {
  date: string
  item: string
  amount: number
  source: string | null
  installments_left: number | null
  recurring: boolean
}

export async function createFixed(input: FixedInput): Promise<FixedExpenseRow> {
  const cycleId = await ensureCycleFor(input.date)
  const { data, error } = await supabase
    .from('fixed_expenses')
    .insert({ ...input, cycle_id: cycleId, paid: false })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateFixed(
  id: string,
  patch: Partial<Pick<FixedExpenseRow, 'date' | 'item' | 'amount' | 'source' | 'installments_left' | 'paid' | 'recurring'>>,
): Promise<FixedExpenseRow> {
  const { data, error } = await supabase.from('fixed_expenses').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteFixed(id: string): Promise<void> {
  const { error } = await supabase.from('fixed_expenses').delete().eq('id', id)
  if (error) throw error
}
