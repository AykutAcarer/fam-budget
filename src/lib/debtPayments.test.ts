import { describe, expect, it } from 'vitest'
import { balanceAfter, maxPayment, paymentsByDebt, sortPayments, totalPaid, validatePaymentForm } from './debtPayments'

const p = (id: string, debt_id: string, date: string, amount: number, created_at = '2026-09-01T00:00:00Z') => ({ id, debt_id, date, amount, created_at })
const TODAY = '2026-09-28'

describe('toplam ve sıralama', () => {
  it('toplam sent hassasiyetinde (0,1 + 0,2 = 0,3)', () => {
    expect(totalPaid([{ amount: 0.1 }, { amount: 0.2 }])).toBe(0.3)
    expect(totalPaid([])).toBe(0)
  })

  it('en yeni önce; aynı gün kayıt zamanına göre', () => {
    const list = [p('a', 'd', '2026-09-01', 1), p('b', 'd', '2026-09-20', 1, 'T1'), p('c', 'd', '2026-09-20', 1, 'T2')]
    expect(sortPayments(list).map((x) => x.id)).toEqual(['c', 'b', 'a'])
  })

  it('borç başına gruplar', () => {
    const map = paymentsByDebt([p('a', 'x', '2026-09-01', 100.1), p('b', 'y', '2026-09-02', 5), p('c', 'x', '2026-09-03', 0.2)])
    expect(map.get('x')).toEqual({ list: [expect.objectContaining({ id: 'c' }), expect.objectContaining({ id: 'a' })], total: 100.3 })
    expect(map.get('y')?.total).toBe(5)
    expect(map.get('z')).toBeUndefined()
  })
})

describe('sınır ve önizleme', () => {
  it('yeni ödeme en fazla bakiye kadar; düzenlemede eski tutar geri eklenir', () => {
    expect(maxPayment(99.9)).toBe(99.9)
    expect(maxPayment(0.1, 0.2)).toBe(0.3)
  })

  it('kalan bakiye önizlemesi', () => {
    expect(balanceAfter(1000.1, 0.3)).toBe(999.8)
    expect(balanceAfter(800, 60, 100)).toBe(840)
    expect(balanceAfter(50, 50)).toBe(0)
  })
})

describe('validatePaymentForm', () => {
  it('geçerli form', () => {
    expect(validatePaymentForm({ date: '2026-09-20', amount: '1.250,50', note: '  eylül ' }, 2000, TODAY)).toEqual({
      ok: true,
      value: { date: '2026-09-20', amount: 1250.5, note: 'eylül' },
    })
    expect(validatePaymentForm({ date: TODAY, amount: '50', note: '' }, 50, TODAY)).toMatchObject({ ok: true, value: { amount: 50, note: null } })
  })

  it('bakiyeden büyük tutar, sıfır, bozuk tutar', () => {
    const over = validatePaymentForm({ date: TODAY, amount: '50,01', note: '' }, 50, TODAY)
    expect(!over.ok && over.errors.amount).toMatch(/en fazla 50,00 €/)
    expect(validatePaymentForm({ date: TODAY, amount: '0', note: '' }, 50, TODAY).ok).toBe(false)
    expect(validatePaymentForm({ date: TODAY, amount: 'abc', note: '' }, 50, TODAY).ok).toBe(false)
  })

  it('gelecek ve bozuk tarih reddedilir', () => {
    const future = validatePaymentForm({ date: '2026-09-29', amount: '5', note: '' }, 50, TODAY)
    expect(!future.ok && future.errors.date).toMatch(/Gelecek/)
    expect(validatePaymentForm({ date: '', amount: '5', note: '' }, 50, TODAY).ok).toBe(false)
  })

  it('çok uzun not', () => {
    expect(validatePaymentForm({ date: TODAY, amount: '5', note: 'x'.repeat(201) }, 50, TODAY).ok).toBe(false)
  })
})
