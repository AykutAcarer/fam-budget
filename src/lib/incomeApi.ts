/** Gelir — Supabase işlemleri (RLS: yalnız kullanıcının kendi kalemleri). */
import type { IncomeRow } from './database.types'
import { ensureCycleFor } from './expensesApi'
import type { IncomeFormValue } from './income'
import { supabase } from './supabase'

export async function createIncome(value: IncomeFormValue): Promise<IncomeRow> {
  const cycleId = await ensureCycleFor(value.date)
  const { data, error } = await supabase
    .from('income')
    .insert({ ...value, cycle_id: cycleId, received: false })
    .select('*')
    .single()
  if (error) throw error
  return data
}

export async function updateIncome(
  id: string,
  patch: Partial<Pick<IncomeRow, 'date' | 'source' | 'amount' | 'recurring' | 'note' | 'received'>>,
): Promise<IncomeRow> {
  const { data, error } = await supabase.from('income').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteIncome(id: string): Promise<void> {
  const { error } = await supabase.from('income').delete().eq('id', id)
  if (error) throw error
}
