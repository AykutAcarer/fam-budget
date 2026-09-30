import { describe, expect, it } from 'vitest'
import { buildComparison, buildRepeat, cycleSummary, type BudgetData } from './budget'
import type { CategoryRow, CategoryType, CycleRow, VariableExpenseRow } from './database.types'

const DEFAULT_CUT = ['kahvalti', 'is', 'halisaha', 'sosyal']
const cat = (key: string, color: string, sort_order: number): CategoryRow => ({
  id: key, user_id: 'u', key, label: key.toUpperCase(), type: 'kisilabilir', color, sort_order, keywords: [],
  is_cuttable: DEFAULT_CUT.includes(key), created_at: '',
})
const cycle = (id: string, start: string, end: string): CycleRow => ({
  id, user_id: 'u', key: id, label: id, start_date: start, end_date: end, is_baseline: id === 'b', cc_opening_balance: 0, created_at: '',
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
        { id: '3', user_id: 'u', cycle_id: 'a', date: '2026-09-15', item: 'Kira', amount: 850, paid: true, source: null, note: null, installments_left: null, recurring: true, fixed_kind: 'duzenli', created_at: '' },
        { id: '4', user_id: 'u', cycle_id: 'a', date: '2026-09-20', item: 'Elektrik', amount: 72.5, paid: true, source: null, note: null, installments_left: null, recurring: true, fixed_kind: 'duzenli', created_at: '' },
        { id: '5', user_id: 'u', cycle_id: 'a', date: '2026-10-01', item: 'İnternet', amount: 34.99, paid: false, source: null, note: null, installments_left: null, recurring: true, fixed_kind: 'duzenli', created_at: '' },
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

  it('kısılabilir küme kullanıcının seçiminden gelir; seçim değişince kıyas değişir', () => {
    const d = data()
    const before = buildComparison(d, '2026-09-16')!
    // Sosyal'i kısılabilirden çıkar
    d.categories = d.categories.map((c) => (c.key === 'sosyal' ? { ...c, is_cuttable: false } : c))
    const after = buildComparison(d, '2026-09-16')!
    expect(after.kisilabilir).not.toContain('sosyal')
    expect(after.dortluBuAy).toBeLessThan(before.dortluBuAy)
  })

  it('hiç kısılabilir kategori yoksa kıyas 0 ve küme boş', () => {
    const d = data()
    d.categories = d.categories.map((c) => ({ ...c, is_cuttable: false }))
    expect(buildComparison(d, '2026-09-16')).toMatchObject({ dortluBuAy: 0, dortluBazAy: 0, fark: 0, kisilabilir: [] })
  })

  it('is_cuttable alanı hiç yoksa (migration öncesi) varsayılan dörtlü kullanılır', () => {
    const d = data()
    d.categories = d.categories.map(({ is_cuttable: _omit, ...c }) => c as CategoryRow)
    const legacy = buildComparison(d, '2026-09-16')!
    expect(legacy.kisilabilir.sort()).toEqual(d.categories.map((c) => c.key).filter((k) => DEFAULT_CUT.includes(k)).sort())
  })
})

describe('buildRepeat', () => {
  it('hatırlatma yalnız kısılabilir seçili kategoride', () => {
    const d = data()
    const days = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']
    d.active = { ...d.active, variable: days.map((day) => v(day, 'mutfak', 5)) }
    expect(buildRepeat(d, '2026-09-18', 'mutfak').hatirlat).toBe(false)
    d.categories = d.categories.map((c) => (c.key === 'mutfak' ? { ...c, is_cuttable: true } : c))
    expect(buildRepeat(d, '2026-09-18', 'mutfak').hatirlat).toBe(true)
  })
})

describe('tür (Zorunlu / Esnek / …) yalnız etikettir; hesaplar is_cuttable\'a bakar', () => {
  const withCategories = (categories: CategoryRow[]): BudgetData => ({ ...data(), categories })
  const row = (key: string, type: CategoryType, is_cuttable: boolean, sort_order: number): CategoryRow => ({
    ...cat(key, '#7C4DFF', sort_order), type, is_cuttable,
  })

  it('türü Esnek (kisilabilir) ama anahtarı kapalı kategori kıyasa girmez; Zorunlu ama anahtarı açık olan girer', () => {
    const d = withCategories([row('mutfak', 'zorunlu', true, 1), row('sosyal', 'kisilabilir', false, 7), row('kredi karti', 'borc', false, 10)])
    const c = buildComparison(d, '2026-09-16')!
    expect(c.kisilabilir).toEqual(['mutfak'])
    expect(c.dortluBuAy).toBe(30.3) // yalnız mutfak (30,10 + 0,20); sosyal 9,70 dahil değil
    expect(c.dortluBazAy).toBe(0) // baz aydaki 20 € sosyal
  })

  it('türler ne olursa olsun kıyas, tekrar hatırlatması ve özet aynı kalır', () => {
    const base = data()
    const ALL: CategoryType[] = ['zorunlu', 'kisilabilir', 'yari', 'borc']
    const snapshot = (d: BudgetData) => ({
      comparison: buildComparison(d, '2026-09-16', { category: 'sosyal' }),
      repeat: d.categories.map((c) => buildRepeat(d, '2026-09-16', c.key)),
      summary: cycleSummary(d),
    })
    const expected = snapshot(base)
    for (let shift = 1; shift < ALL.length; shift++) {
      const shuffled = { ...base, categories: base.categories.map((c, i) => ({ ...c, type: ALL[(i + shift) % ALL.length] })) }
      expect(snapshot(shuffled)).toEqual(expected)
    }
  })
})
