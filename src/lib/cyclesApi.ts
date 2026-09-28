/** Döngüler — Supabase işlemleri (RLS: yalnız kullanıcının kendi döngüleri). */
import type { CycleRow } from './database.types'
import { supabase } from './supabase'

export async function loadCycles(): Promise<CycleRow[]> {
  const { data, error } = await supabase.from('cycles').select('*').order('start_date', { ascending: false })
  if (error) throw error
  return data
}

/** Baz ayı tek işlemde değiştirir (eski baz ay otomatik kalkar). */
export async function setBaselineCycle(id: string): Promise<void> {
  const { error } = await supabase.rpc('set_baseline_cycle', { p_cycle_id: id })
  if (error) throw error
}
