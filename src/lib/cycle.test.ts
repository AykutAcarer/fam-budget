import { describe, expect, it } from 'vitest'
import { cycleDay, cycleLength, cycleWindowFor, sameLabel } from './cycle'
import { clampIsoDate } from './date'

describe('cycleWindowFor', () => {
  it('15\'i ve sonrası o ayın döngüsüdür', () => {
    expect(cycleWindowFor('2026-09-15')).toMatchObject({ key: '2026-09', start: '2026-09-15', end: '2026-10-14' })
    expect(cycleWindowFor('2026-09-28')).toMatchObject({ key: '2026-09', start: '2026-09-15', end: '2026-10-14' })
  })

  it('14\'ü ve öncesi bir önceki ayın döngüsüdür', () => {
    expect(cycleWindowFor('2026-10-14')).toMatchObject({ key: '2026-09', start: '2026-09-15', end: '2026-10-14' })
    expect(cycleWindowFor('2026-10-01')).toMatchObject({ key: '2026-09' })
  })

  it('yıl geçişi', () => {
    expect(cycleWindowFor('2027-01-05')).toMatchObject({ key: '2026-12', start: '2026-12-15', end: '2027-01-14' })
    expect(cycleWindowFor('2026-12-15').label).toBe('15 Ara 2026 – 14 Oca 2027')
  })

  it('Türkçe etiket', () => {
    expect(cycleWindowFor('2026-09-20').label).toBe('15 Eyl – 14 Eki 2026')
  })
})

describe('cycleDay', () => {
  it('15\'i 1. gündür', () => {
    expect(cycleDay('2026-09-15', '2026-09-15')).toBe(1)
    expect(cycleDay('2026-09-15', '2026-09-16')).toBe(2)
    expect(cycleDay('2026-09-15', '2026-09-28')).toBe(14)
  })

  it('ay sınırını ve DST geçişini doğru sayar', () => {
    // Avrupa'da 25 Ekim 2026'da saat geri alınır.
    expect(cycleDay('2026-10-15', '2026-11-14')).toBe(31)
    expect(cycleLength('2026-10-15', '2026-11-14')).toBe(31)
    expect(cycleLength('2027-01-15', '2027-02-14')).toBe(31)
    expect(cycleLength('2027-02-15', '2027-03-14')).toBe(28)
  })
})

describe('clampIsoDate', () => {
  it('geçerli tarihe dokunmaz', () => {
    expect(clampIsoDate('2026-09-30')).toBe('2026-09-30')
  })
  it('ay sonunu aşan günü ay sonuna çeker', () => {
    expect(clampIsoDate('2026-09-31')).toBe('2026-09-30')
    expect(clampIsoDate('2027-02-30')).toBe('2027-02-28')
    expect(clampIsoDate('2028-02-30')).toBe('2028-02-29')
  })
  it('bozuk biçimi reddeder', () => {
    expect(() => clampIsoDate('2026-9-1')).toThrow()
    expect(() => clampIsoDate('2026-13-01')).toThrow()
  })
})

describe('sameLabel', () => {
  it('yalnız tire/boşluk farkı aynı sayılır', () => {
    expect(sameLabel('15 Eyl - 14 Eki 2026', '15 Eyl – 14 Eki 2026')).toBe(true)
    expect(sameLabel('Baz Ay (15 Ağu - 14 Eyl 2026)', '15 Ağu – 14 Eyl 2026')).toBe(false)
  })
})
