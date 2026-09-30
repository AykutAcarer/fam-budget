/**
 * Dashboard verisini Supabase'den yükler: kategoriler, aktif döngü (gelir,
 * sabit gider, değişken harcama) ve baz ayın değişken harcamaları.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BudgetData } from './budget'
import { cycleLabel, cycleWindowFor } from './cycle'
import { cachedLoad } from './offlineCache'
import { supabase } from './supabase'

/** Supabase sonucundan veriyi alır; hata varsa fırlatır. */
function unwrap<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error
  return res.data
}

/** Çevrimdışıyken son görülen dashboard verisi (bkz. offlineCache). */
export function loadBudgetData(today: string): Promise<BudgetData> {
  return cachedLoad('budget', () => fetchBudgetData(today))
}

async function fetchBudgetData(today: string): Promise<BudgetData> {
  const [categoriesRes, activeRes, baselineRes] = await Promise.all([
    supabase.from('categories').select('*').order('sort_order'),
    supabase
      .from('cycles')
      .select('*')
      .lte('start_date', today)
      .gte('end_date', today)
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('cycles').select('*').eq('is_baseline', true).maybeSingle(),
  ])
  const categories = unwrap(categoriesRes) ?? []
  const activeCycle = unwrap(activeRes)
  const baselineCycle = unwrap(baselineRes)

  const loadBaseline = baselineCycle && baselineCycle.id !== activeCycle?.id
  const [incomeRes, fixedRes, variableRes, baselineVariableRes] = await Promise.all([
    activeCycle ? supabase.from('income').select('*').eq('cycle_id', activeCycle.id).order('date') : null,
    activeCycle ? supabase.from('fixed_expenses').select('*').eq('cycle_id', activeCycle.id).order('date') : null,
    activeCycle
      ? supabase.from('variable_expenses').select('*').eq('cycle_id', activeCycle.id).order('date').order('created_at')
      : null,
    loadBaseline ? supabase.from('variable_expenses').select('*').eq('cycle_id', baselineCycle.id).order('date') : null,
  ])

  const window = activeCycle
    ? { label: cycleLabel(activeCycle.start_date, activeCycle.end_date), start: activeCycle.start_date, end: activeCycle.end_date }
    : cycleWindowFor(today)

  return {
    categories,
    active: {
      cycle: activeCycle,
      window,
      income: incomeRes ? (unwrap(incomeRes) ?? []) : [],
      fixed: fixedRes ? (unwrap(fixedRes) ?? []) : [],
      variable: variableRes ? (unwrap(variableRes) ?? []) : [],
    },
    baseline: baselineCycle
      ? { cycle: baselineCycle, variable: baselineVariableRes ? (unwrap(baselineVariableRes) ?? []) : [] }
      : null,
  }
}

export interface BudgetState {
  data: BudgetData | null
  error: string | null
  /** Veriyi yeniden yükler ve yeni veriyi döner (hata olursa null; eski veri korunur). */
  reload: () => Promise<BudgetData | null>
}

export function useBudgetData(today: string): BudgetState {
  const [data, setData] = useState<BudgetData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const req = ++latest.current
    try {
      const d = await loadBudgetData(today)
      if (req === latest.current) {
        setData(d)
        setError(null)
      }
      return d
    } catch (e) {
      if (req === latest.current)
        // Supabase hataları Error örneği değil, { message } nesnesidir.
        setError(e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e))
      return null
    }
  }, [today])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, reload }
}
