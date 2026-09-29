/** Kategoriler — Supabase işlemleri (RLS: yalnız kullanıcının kendi kategorileri). */
import type { CategoryFormValue } from './categories'
import { uniqueKey } from './categories'
import type { CategoryRow } from './database.types'
import { supabase } from './supabase'

export async function loadCategories(): Promise<CategoryRow[]> {
  const { data, error } = await supabase.from('categories').select('*').order('sort_order').order('created_at')
  if (error) throw error
  return data
}

/** Yeni kategori listenin sonuna eklenir; key etiketten türetilir ve tekildir. */
export async function createCategory(value: CategoryFormValue, existing: readonly CategoryRow[]): Promise<CategoryRow> {
  const key = uniqueKey(value.label, existing.map((c) => c.key))
  const sortOrder = existing.reduce((max, c) => Math.max(max, c.sort_order), 0) + 1
  const { data, error } = await supabase
    .from('categories')
    .insert({ ...value, key, sort_order: sortOrder })
    .select('*')
    .single()
  if (error) throw error
  return data
}

/** key değişmez (harcamalar key'e bağlı); etiket, tür, renk ve anahtar kelimeler güncellenir. */
export async function updateCategory(id: string, value: CategoryFormValue): Promise<CategoryRow> {
  const { data, error } = await supabase.from('categories').update(value).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

/** Kategorideki harcama sayısı (tüm döngüler). */
export async function countCategoryExpenses(key: string): Promise<number> {
  const { count, error } = await supabase.from('variable_expenses').select('id', { count: 'exact', head: true }).eq('category', key)
  if (error) throw error
  return count ?? 0
}

/** Siler; harcaması varsa önce moveTo'ya taşır (tek işlem). Taşınan harcama sayısını döner. */
export async function deleteCategory(key: string, moveTo: string | null = null): Promise<number> {
  const { data, error } = await supabase.rpc('delete_category', { p_key: key, p_move_to: moveTo })
  if (error) throw error
  return data
}
