/**
 * JSON içe/dışa aktarma — Supabase tarafı.
 */
import type { ImportSummary } from './database.types'
import type { ExportRows, NormalizeResult } from './transfer'
import { buildExport, normalizeImport } from './transfer'
import { supabase } from './supabase'
import { todayIso } from './cycle'

export type { ImportSummary }

/** Dosyayı doğrular, sonra tek işlemde (atomik) kullanıcının hesabına yazar. */
export async function importBudgetFile(raw: unknown): Promise<{ summary: ImportSummary; warnings: string[] }> {
  const cats = await supabase.from('categories').select('key')
  if (cats.error) throw cats.error
  const { data, warnings }: NormalizeResult = normalizeImport(
    raw,
    cats.data.map((c) => c.key),
  )

  const { data: summary, error } = await supabase.rpc('import_data', { p_data: data })
  if (error) throw error
  return { summary, warnings }
}

const PAGE = 1000

/** Bir tablonun tüm satırlarını sayfalayarak çeker (PostgREST satır sınırını aşmak için). */
async function fetchAll<T extends keyof ExportTables>(table: T): Promise<ExportTables[T]> {
  const out: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out as ExportTables[T]
}

interface ExportTables {
  categories: ExportRows['categories']
  debts: ExportRows['debts']
  cycles: ExportRows['cycles']
  income: ExportRows['income']
  fixed_expenses: ExportRows['fixed']
  variable_expenses: ExportRows['variable']
}

/** Kullanıcının tüm verisini içe aktarılabilir JSON olarak indirir. */
export async function downloadBudgetExport(): Promise<void> {
  const [categories, debts, cycles, income, fixed, variable] = await Promise.all([
    fetchAll('categories'),
    fetchAll('debts'),
    fetchAll('cycles'),
    fetchAll('income'),
    fetchAll('fixed_expenses'),
    fetchAll('variable_expenses'),
  ])
  const today = todayIso()
  const file = buildExport({ categories, debts, cycles, income, fixed, variable }, today)

  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `butcem-yedek-${today}.json`
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
