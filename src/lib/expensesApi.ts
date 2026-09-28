/**
 * Değişken harcama kaydı (Supabase). Ağ hatasında kalemler çevrimdışı kuyruğa
 * alınır; harcama asla kaybolmaz.
 */
import { cycleWindowFor } from './cycle'
import { addToOutbox, readOutbox, removeFromOutbox, type NewExpense } from './outbox'
import { supabase } from './supabase'

/** Ağ/bağlantı kaynaklı bir hata mı (kuyruğa alınmalı), yoksa veri hatası mı? */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String(err.message) : String(err)
  return /failed to fetch|network|load failed|fetch failed|timeout|aborted/i.test(msg)
}

/** Tarihi içeren döngünün id'si; yoksa maaş gününe göre oluşturulur. */
export async function ensureCycleFor(date: string): Promise<string> {
  const found = await supabase
    .from('cycles')
    .select('id')
    .lte('start_date', date)
    .gte('end_date', date)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (found.error) throw found.error
  if (found.data) return found.data.id

  const w = cycleWindowFor(date)
  const inserted = await supabase
    .from('cycles')
    .insert({ key: w.key, label: w.label, start_date: w.start, end_date: w.end })
    .select('id')
    .single()
  if (!inserted.error) return inserted.data.id
  // Aynı anda başka bir sekme oluşturduysa (unique ihlali) onu kullan.
  if (inserted.error.code === '23505') {
    const again = await supabase.from('cycles').select('id').eq('key', w.key).single()
    if (again.error) throw again.error
    return again.data.id
  }
  throw inserted.error
}

async function insertOnline(items: NewExpense[]): Promise<void> {
  const cycleIds = new Map<string, string>()
  const rows = []
  for (const item of items) {
    const windowKey = cycleWindowFor(item.date).key
    let cycleId = cycleIds.get(windowKey)
    if (!cycleId) {
      cycleId = await ensureCycleFor(item.date)
      cycleIds.set(windowKey, cycleId)
    }
    rows.push({ ...item, cycle_id: cycleId })
  }
  const { error } = await supabase.from('variable_expenses').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

/** Kaydeder; bağlantı yoksa kuyruğa alır. queued=true ise henüz sunucuda değil. */
export async function saveExpenses(userId: string, items: NewExpense[]): Promise<{ queued: boolean }> {
  try {
    await insertOnline(items)
    return { queued: false }
  } catch (err) {
    if (!isNetworkError(err)) throw err
    addToOutbox(userId, items)
    return { queued: true }
  }
}

/** Kuyruktaki kalemleri göndermeyi dener. Gönderilen sayısını döner. */
export async function flushOutbox(userId: string): Promise<number> {
  const items = readOutbox(userId)
  if (!items.length) return 0
  await insertOnline(items)
  removeFromOutbox(userId, items.map((i) => i.id))
  return items.length
}

/** Harcamayı siler (sunucudan ya da kuyruktan). */
export async function deleteExpenses(userId: string, ids: string[]): Promise<void> {
  removeFromOutbox(userId, ids)
  const { error } = await supabase.from('variable_expenses').delete().in('id', ids)
  if (error) throw error
}
