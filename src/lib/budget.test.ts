import { describe, expect, it } from 'vitest'
import { buildComparison, cycleSummary, type BudgetData } from './budget'
import type { CategoryRow, CycleRow, VariableExpenseRow } from './database.types'

const cat = (key: string, color: string, sort_order: number): CategoryRow => ({
  id: key, user_id: 'u', key, label: key.toUpperCase(), type: 'kisilabilir', color, sort_order, created_at: '',
})
const cycle = (id: string, start: string, end: string): CycleRow => ({
  id, user_id: 'u', key: id, label: id, start_date: start, end_date: end, is_baseline: id === 'b', created_at: '',
})
const v = (date: string, category: string, amount: number): VariableExpenseRow => ({
  id: `${date}${category}${amount}`, user_id: 'u', cycle_id: 'a', date, category, description: '', amount, created_at: '',
})

function data(): BudgetData {
  return {
    categories: [cat('mutfak', '#C6EFCE', 1), cat('sosyal', '#D9D2E9', 7), cat('kredi karti', '#BFBFBF', 10)],
    active: {
      cycle: cycle('a', '2026-09-15', '2026-10-14'),
      window: { label: 'x', start: '2026-09-15', end: '2026-10-14' },
      income: [
        { id: '1', user_id: 'u', cycle_id: 'a', date: '2026-09-15', source: 'Maaş', amount: 2250, received: true, note: null, recurring: true, created_at: '' },
        { id: '2', user_id: 'u', cycle_id: 'a', date: '2026-09-30', source: 'Yardım', amount: 180.1, received: false, note: null, recurring: true, created_at: '' },
      ],
      fixed: [
        { id: '3', user_id: 'u', cycle_id: 'a', date: '2026-09-15', item: 'Kira', amount: 850, paid: true, source: null, note: null, installments_left: null, recurring: true, created_at: '' },
        { id: '4', user_id: 'u', cycle_id: 'a', date: '2026-09-20', item: 'Elektrik', amount: 72.5, paid: true, source: null, note: null, installments_left: null, recurring: true, created_at: '' },
        { id: '5', user_id: 'u', cycle_id: 'a', date: '2026-10-01', item: 'İnternet', amount: 34.99, paid: false, source: null, note: null, installments_left: null, recurring: true, created_at: '' },
      ],
      variable: [v('2026-09-15', 'mutfak', 30.1), v('2026-09-16', 'mutfak', 0.2), v('2026-09-16', 'sosyal', 9.7), v('2026-09-20', 'kredi karti', 150)],
    },
    baseline: { cycle: cycle('b', '2026-08-15', '2026-09-14'), variable: [v('2026-08-15', 'sosyal', 20)] },
  }
}

describe('cycleSummary', () => {
  it('KPI\'lar', () => {
    const s = cycleSummary(data())
    expect(s.income).toEqual({ total: 2430.1, received: 2250, expected: 180.1 })
    expect(s.fixed).toEqual({ total: 957.49, paid: 922.5, remaining: 34.99 })
    expect(s.variable).toBe(190)
    expect(s.creditCard).toBe(150)
  })

  it('kategori dağılımı: tutara göre azalan, renkler kategoriden, paylar toplamı 1', () => {
    const { byCategory } = cycleSummary(data())
    expect(byCategory.map((c) => [c.key, c.amount, c.color])).toEqual([
      ['kredi karti', 150, '#BFBFBF'],
      ['mutfak', 30.3, '#C6EFCE'],
      ['sosyal', 9.7, '#D9D2E9'],
    ])
    expect(byCategory.reduce((a, c) => a + c.share, 0)).toBeCloseTo(1)
  })

  it('cihazda bekleyen kalemler dahil edilir, döngü dışındakiler edilmez', () => {
    const s = cycleSummary(data(), [
      { date: '2026-09-28', category: 'sosyal', amount: 8.25 },
      { date: '2026-09-14', category: 'sosyal', amount: 99 },
    ])
    expect(s.variable).toBe(198.25)
    expect(s.byCategory.find((c) => c.key === 'sosyal')?.amount).toBe(17.95)
  })

  it('boş döngü', () => {
    const d = data()
    d.active = { ...d.active, income: [], fixed: [], variable: [] }
    expect(cycleSummary(d)).toEqual({
      income: { total: 0, received: 0, expected: 0 },
      fixed: { total: 0, paid: 0, remaining: 0 },
      variable: 0,
      creditCard: 0,
      byCategory: [],
    })
  })
})

describe('buildComparison', () => {
  it('aktif döngü baz ayın kendisiyse kıyas yok', () => {
    const d = data()
    d.baseline = { cycle: d.active.cycle!, variable: [] }
    expect(buildComparison(d, '2026-09-20')).toBeNull()
  })

  it('bekleyen kalemler bu aya eklenir', () => {
    const c = buildComparison(data(), '2026-09-16', { pending: [{ date: '2026-09-16', category: 'sosyal', amount: 8.25 }] })
    expect(c).toMatchObject({ cycleDay: 2, dortluBuAy: 17.95, dortluBazAy: 20, fark: -2.05 })
  })
})
