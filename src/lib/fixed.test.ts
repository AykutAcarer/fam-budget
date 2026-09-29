import { describe, expect, it } from 'vitest'
import {
  alertItems,
  dateForDayInCycle,
  daysUntil,
  fixedStatus,
  fixedTotals,
  isCardSource,
  nextSource,
  sortFixed,
  validateFixedForm,
} from './fixed'

const TODAY = '2026-09-28'
const f = (date: string, item: string, amount: number, paid = false) => ({ date, item, amount, paid })

describe('sortFixed', () => {
  it('ödeme gününe göre, aynı günde kalem adına göre (Türkçe) sıralar', () => {
    const items = [f('2026-10-05', 'Telefon', 20), f('2026-09-15', 'Kira', 850), f('2026-10-01', 'İnternet', 35), f('2026-10-01', 'Çocuk kulübü', 25)]
    expect(sortFixed(items).map((i) => i.item)).toEqual(['Kira', 'Çocuk kulübü', 'İnternet', 'Telefon'])
  })

  it('girdiyi değiştirmez', () => {
    const items = [f('2026-10-05', 'b', 1), f('2026-09-15', 'a', 1)]
    sortFixed(items)
    expect(items[0].item).toBe('b')
  })
})

describe('fixedTotals', () => {
  it('ödenen ve kalanı ayırır, toplam = ödenen + kalan', () => {
    const t = fixedTotals([f('2026-09-15', 'Kira', 850, true), f('2026-09-20', 'Elektrik', 72.5, true), f('2026-10-01', 'İnternet', 34.99)])
    expect(t).toEqual({ total: 957.49, paid: 922.5, remaining: 34.99 })
  })

  it('sent hassasiyeti (0,1 + 0,2)', () => {
    expect(fixedTotals([f('x', 'a', 0.1), f('x', 'b', 0.2)]).remaining).toBe(0.3)
  })

  it('boş liste', () => {
    expect(fixedTotals([])).toEqual({ total: 0, paid: 0, remaining: 0 })
  })
})

describe('fixedStatus — sınır günler', () => {
  it.each([
    ['2026-09-27', false, 'gecikmis'], // dün
    ['2026-09-01', false, 'gecikmis'],
    ['2026-09-28', false, 'bugun'], // bugün
    ['2026-09-29', false, 'yaklasan'], // yarın
    ['2026-10-01', false, 'yaklasan'], // bugün + 3 (ay geçişi)
    ['2026-10-02', false, 'ileri'], // bugün + 4
    ['2026-09-27', true, 'odendi'], // ödenmişse gecikmiş sayılmaz
    ['2026-10-10', true, 'odendi'],
  ])('%s paid=%s → %s', (date, paid, status) => {
    expect(fixedStatus({ date, paid }, TODAY)).toBe(status)
  })

  it('daysUntil', () => {
    expect(daysUntil('2026-09-27', TODAY)).toBe(-1)
    expect(daysUntil('2026-10-01', TODAY)).toBe(3)
  })
})

describe('alertItems', () => {
  it('gecikmişler önce (eskiden yeniye), sonra bugün/yaklaşan; ödenen ve ileri hariç', () => {
    const items = [
      f('2026-10-01', 'İnternet', 35),
      f('2026-09-20', 'Elektrik', 72),
      f('2026-09-28', 'Sigorta', 49),
      f('2026-09-25', 'Telefon', 20),
      f('2026-09-15', 'Kira', 850, true),
      f('2026-10-10', 'Kulüp', 25),
    ]
    expect(alertItems(items, TODAY).map((i) => i.item)).toEqual(['Elektrik', 'Telefon', 'Sigorta', 'İnternet'])
  })
})

describe('dateForDayInCycle', () => {
  const [S, E] = ['2026-09-15', '2026-10-14']
  it.each([
    [22, '2026-09-22'],
    [15, '2026-09-15'],
    [14, '2026-10-14'],
    [7, '2026-10-07'],
    [31, '2026-09-30'], // Eylül'de 31 yok → ay sonu
    [0, null],
    [32, null],
  ])('%s → %s', (day, date) => {
    expect(dateForDayInCycle(S, E, day)).toBe(date)
  })

  it('yıl geçişi', () => {
    expect(dateForDayInCycle('2026-12-15', '2027-01-14', 5)).toBe('2027-01-05')
    expect(dateForDayInCycle('2026-12-15', '2027-01-14', 20)).toBe('2026-12-20')
  })
})

describe('validateFixedForm', () => {
  const cycle = { start: '2026-09-15', end: '2026-10-14' }
  const base = { day: '7', item: ' Telekom ', amount: '39,99', card: true, installmentsLeft: '', recurring: true }

  it('geçerli form → döngü içi tarih ve sayı', () => {
    expect(validateFixedForm(base, cycle)).toEqual({
      ok: true,
      value: { date: '2026-10-07', item: 'Telekom', amount: 39.99, installmentsLeft: null, recurring: true },
    })
  })

  it('taksit ve binlik ayırıcılı tutar', () => {
    const r = validateFixedForm({ ...base, amount: '1.250,50', installmentsLeft: '6' }, cycle)
    expect(r).toMatchObject({ ok: true, value: { amount: 1250.5, installmentsLeft: 6 } })
  })

  it('hatalar alan bazında', () => {
    const r = validateFixedForm({ day: '40', item: '  ', amount: 'on', card: false, installmentsLeft: '-1', recurring: true }, cycle)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['amount', 'day', 'installmentsLeft', 'item'])
  })

  it('sıfır tutar reddedilir', () => {
    expect(validateFixedForm({ ...base, amount: '0' }, cycle).ok).toBe(false)
  })
})

describe('kart kaynağı', () => {
  it('isCardSource', () => {
    expect(isCardSource('kart')).toBe(true)
    expect(isCardSource('Kredi kartı')).toBe(true)
    expect(isCardSource('KK')).toBe(true)
    expect(isCardSource('Maaş hesabı')).toBe(false)
    expect(isCardSource(null)).toBe(false)
  })

  it('nextSource mevcut açıklamayı korur', () => {
    expect(nextSource(null, true)).toBe('kart')
    expect(nextSource('Kredi kartı', true)).toBe('Kredi kartı')
    expect(nextSource('Kredi kartı', false)).toBeNull()
    expect(nextSource('Maaş hesabı', false)).toBe('Maaş hesabı')
    expect(nextSource('Maaş hesabı', true)).toBe('kart')
  })
})
