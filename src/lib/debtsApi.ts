/**
 * Borçlar — Supabase işlemleri. RLS: her satır giriş yapmış kullanıcıya aittir.
 */
import type { DebtRow } from './database.types'
import type { DebtFormValue } from './debts'
import { supabase } from './supabase'

export async function loadDebts(): Promise<DebtRow[]> {
  const { data, error } = await supabase.from('debts').select('*').order('priority')
  if (error) throw error
  return data
}

export async function createDebt(value: DebtFormValue): Promise<DebtRow> {
  const { data, error } = await supabase.from('debts').insert(value).select('*').single()
  if (error) throw error
  return data
}

export async function updateDebt(id: string, value: DebtFormValue): Promise<DebtRow> {
  const { data, error } = await supabase.from('debts').update(value).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteDebt(id: string): Promise<void> {
  const { error } = await supabase.from('debts').delete().eq('id', id)
  if (error) throw error
}
