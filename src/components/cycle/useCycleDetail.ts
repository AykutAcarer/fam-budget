/**
 * Döngü detay ekranının verisi: tüm döngüler + kategoriler (bir kez), seçili
 * döngünün ve baz ayın değişken harcamaları (gerektikçe, önbellekli).
 * Düzenle/sil önbelleği anında günceller → grafik ve özet hemen yenilenir.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { cycleOptions, defaultCycleId } from '../../lib/compare'
import type { CategoryRow, CycleRow, VariableExpenseRow } from '../../lib/database.types'
import { deleteExpenses, updateExpense } from '../../lib/expensesApi'
import type { ExpenseEditValue } from '../../lib/expenseEdit'
import { supabase } from '../../lib/supabase'

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function useCycleDetail(today: string) {
  const { session } = useAuth()
  const [cycles, setCycles] = useState<CycleRow[] | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [expenses, setExpenses] = useState<ReadonlyMap<string, VariableExpenseRow[]>>(new Map())

  useEffect(() => {
    Promise.all([
      supabase.from('cycles').select('*').order('start_date', { ascending: false }),
      supabase.from('categories').select('*').order('sort_order'),
    ])
      .then(([c, k]) => {
        if (c.error) throw c.error
        if (k.error) throw k.error
        setCycles(c.data)
        setCategories(k.data)
      })
      .catch((e: unknown) => setLoadError(errorText(e)))
  }, [])

  const options = useMemo(() => cycleOptions(cycles ?? [], today), [cycles, today])
  const selected = options.find((o) => o.cycle.id === (selectedId ?? defaultCycleId(options, today)))?.cycle ?? null
  const baseline = options.find((o) => o.isBaseline)?.cycle ?? null

  // Seçili döngü + baz ay harcamalarını (yoksa) yükle.
  useEffect(() => {
    const need = [selected?.id, baseline?.id].filter((id): id is string => !!id && !expenses.has(id))
    if (!need.length) return
    let cancelled = false
    Promise.all(
      need.map(async (id) => {
        const { data, error } = await supabase.from('variable_expenses').select('*').eq('cycle_id', id).order('date')
        if (error) throw error
        return [id, data] as const
      }),
    )
      .then((loaded) => !cancelled && setExpenses((m) => new Map([...m, ...loaded])))
      .catch((e: unknown) => !cancelled && setLoadError(errorText(e)))
    return () => {
      cancelled = true
    }
  }, [selected?.id, baseline?.id, expenses])

  const replaceIn = (cycleId: string, fn: (rows: VariableExpenseRow[]) => VariableExpenseRow[]) =>
    setExpenses((m) => new Map(m).set(cycleId, fn(m.get(cycleId) ?? [])))

  /** Hata fırlatır (form gösterir). */
  const update = useCallback(async (row: VariableExpenseRow, value: ExpenseEditValue) => {
    const saved = await updateExpense(row.id, value)
    replaceIn(row.cycle_id, (rows) => rows.map((r) => (r.id === saved.id ? saved : r)))
  }, [])

  const remove = useCallback(
    async (row: VariableExpenseRow) => {
      await deleteExpenses(session!.user.id, [row.id])
      replaceIn(row.cycle_id, (rows) => rows.filter((r) => r.id !== row.id))
    },
    [session],
  )

  return {
    loadError,
    loading: cycles === null && !loadError,
    options,
    categories,
    selected,
    baseline,
    selectedExpenses: selected ? expenses.get(selected.id) : undefined,
    baselineExpenses: baseline ? expenses.get(baseline.id) : undefined,
    select: setSelectedId,
    update,
    remove,
  }
}
