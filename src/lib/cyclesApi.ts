/** Döngüler — Supabase işlemleri (RLS: yalnız kullanıcının kendi döngüleri). */
import type { CycleRow } from './database.types'
import { rollForwardSource, rollsNeeded } from './rollForward'
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

/**
 * Tarihi kapsayan döngü yoksa en yeni döngüden devrederek oraya ulaşır
 * (arada atlanmış döngüler sırayla üretilir → taksitler doğru azalır).
 * Kapsayan döngünün id'sini döner; hiç döngü yoksa ya da tarih tüm
 * döngülerden önceyse null (devir yapılmaz).
 */
export async function rollForwardUntil(date: string): Promise<string | null> {
  const cycles = await loadCycles()
  const covering = cycles.find((c) => c.start_date <= date && date <= c.end_date)
  if (covering) return covering.id
  const source = rollForwardSource(cycles, date)
  if (!source) return null

  let current: CycleRow = source
  for (let i = 0; i < rollsNeeded(source.end_date, date); i++) {
    const { data: id, error } = await supabase.rpc('roll_forward_cycle', { p_cycle_id: current.id })
    if (error) throw error
    const next = await supabase.from('cycles').select('*').eq('id', id).single()
    if (next.error) throw next.error
    if (next.data.start_date <= date && date <= next.data.end_date) return next.data.id
    current = next.data
  }
  return null
}
