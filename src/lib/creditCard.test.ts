import { describe, expect, it } from 'vitest'
import { activeExpenses, cycleSummary, type BudgetData } from './budget'
import { creditCardStatus, nextOpeningBalance } from './creditCard'

describe('creditCardStatus', () => {
  it('dönem başı 6026,31, bu dönem 300 ödendi → kalan 5726,31', () => {
    expect(creditCardStatus(6026.31, 300)).toEqual({ opening: 6026.31, paid: 300, remaining: 5726.31, overpaid: 0 })
  })

  it('sent hassasiyeti (kayan nokta hatası yok)', () => {
    expect(creditCardStatus(0.3, 0.1).remaining).toBe(0.2)
  })

  it('elle dönem başı borç değişince kalan yeniden hesaplanır', () => {
    expect(creditCardStatus(6026.31, 300).remaining).toBe(5726.31)
    expect(creditCardStatus(6500, 300).remaining).toBe(6200)
  })

  it('fazla ödeme: kalan 0, aşan kısım ayrı', () => {
    expect(creditCardStatus(100, 150)).toEqual({ opening: 100, paid: 150, remaining: 0, overpaid: 50 })
  })

  it('devir: yeni dönem başı = kalan (0\'ın altına inmez)', () => {
    expect(nextOpeningBalance(6026.31, 300)).toBe(5726.31)
    expect(nextOpeningBalance(100, 150)).toBe(0)
  })
})

describe('ödeme eklenince kalan anlık düşer (dashboard verisiyle)', () => {
  const data = (variable: { date: string; category: string; amount: number }[]): BudgetData => ({
    categories: [],
    active: {
      cycle: { id: 'a', user_id: 'u', key: 'a', label: 'a', start_date: '2026-09-15', end_date: '2026-10-14', is_baseline: false, cc_opening_balance: 6026.31, created_at: '' },
      window: { label: 'a', start: '2026-09-15', end: '2026-10-14' },
      income: [],
      fixed: [],
      variable: variable.map((v, i) => ({ id: String(i), user_id: 'u', cycle_id: 'a', description: '', created_at: '', ...v })),
    },
    baseline: null,
  })

  it('kaydedilen ve cihazda bekleyen kredi kartı ödemeleri kalanı düşürür; diğer harcamalar düşürmez', () => {
    const d = data([
      { date: '2026-09-16', category: 'kredi karti', amount: 200 },
      { date: '2026-09-17', category: 'mutfak', amount: 80 },
    ])
    const opening = d.active.cycle!.cc_opening_balance
    expect(creditCardStatus(opening, cycleSummary(d).creditCard).remaining).toBe(5826.31)
    // Yeni ödeme (henüz kuyrukta) anında yansır
    const pending = [{ date: '2026-09-18', category: 'kredi karti', amount: 100 }]
    expect(activeExpenses(d, pending)).toHaveLength(3)
    expect(creditCardStatus(opening, cycleSummary(d, pending).creditCard).remaining).toBe(5726.31)
  })
})
