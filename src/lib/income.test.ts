import { describe, expect, it } from 'vitest'
import { formatAmountInput } from './format'
import { incomeTotals, sortIncome, validateIncomeForm, withReceived } from './income'

const inc = (id: string, date: string, source: string, amount: number, received = false) => ({ id, date, source, amount, received })

describe('incomeTotals', () => {
  it('alınan / beklenen ayrımı, toplam = ikisinin toplamı', () => {
    const items = [inc('1', '2026-09-15', 'Maaş', 2155, true), inc('2', '2026-10-07', 'Kinderzuschlag', 530), inc('3', '2026-09-30', 'Wohngeld', 219.5)]
    expect(incomeTotals(items)).toEqual({ total: 2904.5, received: 2155, expected: 749.5 })
  })

  it('sent hassasiyeti ve boş liste', () => {
    expect(incomeTotals([inc('a', 'x', 's', 0.1), inc('b', 'x', 's', 0.2)]).expected).toBe(0.3)
    expect(incomeTotals([])).toEqual({ total: 0, received: 0, expected: 0 })
  })
})

describe('withReceived — anahtar sonrası anlık güncelleme', () => {
  it('yalnız ilgili kalem değişir, toplamlar hemen yeni değerle hesaplanır', () => {
    const items = [inc('1', '2026-09-15', 'Maaş', 2155, true), inc('2', '2026-10-07', 'Kinderzuschlag', 530)]
    const next = withReceived(items, '2', true)
    expect(incomeTotals(next)).toEqual({ total: 2685, received: 2685, expected: 0 })
    expect(items[1].received).toBe(false) // girdi değişmez
    expect(incomeTotals(withReceived(next, '1', false))).toEqual({ total: 2685, received: 530, expected: 2155 })
  })
})

describe('sortIncome', () => {
  it('tarihe göre, aynı günde kaynağa göre', () => {
    const items = [inc('1', '2026-10-07', 'Kinderzuschlag', 1), inc('2', '2026-09-15', 'Maaş', 1), inc('3', '2026-09-15', 'Ek iş', 1)]
    expect(sortIncome(items).map((i) => i.source)).toEqual(['Ek iş', 'Maaş', 'Kinderzuschlag'])
  })
})

describe('validateIncomeForm', () => {
  const cycle = { start: '2026-09-15', end: '2026-10-14' }
  const base = { day: '7', source: ' Kinderzuschlag ', amount: '530,00', recurring: true, note: '' }

  it('gün döngü içindeki tarihe yerleşir, Türkçe tutar', () => {
    expect(validateIncomeForm(base, cycle)).toEqual({
      ok: true,
      value: { date: '2026-10-07', source: 'Kinderzuschlag', amount: 530, recurring: true, note: null },
    })
    expect(validateIncomeForm({ ...base, day: '15', amount: '2.155,00' }, cycle)).toMatchObject({
      ok: true,
      value: { date: '2026-09-15', amount: 2155 },
    })
  })

  it('tek seferlik gelir ve 0 tutar (gelmedi) kabul', () => {
    expect(validateIncomeForm({ ...base, amount: '0', recurring: false, note: 'gecikti' }, cycle)).toMatchObject({
      ok: true,
      value: { amount: 0, recurring: false, note: 'gecikti' },
    })
  })

  it('hatalar alan bazında', () => {
    const r = validateIncomeForm({ day: '40', source: ' ', amount: 'iki bin', recurring: true, note: '' }, cycle)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['amount', 'day', 'source'])
  })
})

describe('formatAmountInput', () => {
  it('forma "2.250,00" biçiminde yazılır ve doğrulama aynı tutarı geri okur', () => {
    expect(formatAmountInput(2250)).toBe('2.250,00')
    expect(formatAmountInput(0.5)).toBe('0,50')
    const r = validateIncomeForm({ day: '15', source: 'Maaş', amount: formatAmountInput(2250), recurring: true, note: '' }, { start: '2026-09-15', end: '2026-10-14' })
    expect(r).toMatchObject({ ok: true, value: { amount: 2250 } })
  })
})
