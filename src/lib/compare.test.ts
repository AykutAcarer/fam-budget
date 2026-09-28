import { describe, expect, it } from 'vitest'
import { compareToBaseline, cumulativeByCategory, DORTLU, dortluTotal, type CycleExpenses, type ExpenseLike } from './compare'

const e = (date: string, category: string, amount: number): ExpenseLike => ({ date, category, amount })

// Baz ay: 15 Ağu – 14 Eyl 2026 (31 gün). Aktif: 15 Eyl – 14 Eki 2026 (30 gün).
const baseline: CycleExpenses = {
  start: '2026-08-15',
  end: '2026-09-14',
  expenses: [
    e('2026-08-15', 'kahvalti', 4.45), // gün 1
    e('2026-08-15', 'mutfak', 34.37), //  gün 1, dörtlü dışı
    e('2026-08-16', 'is', 6.89), //       gün 2
    e('2026-08-17', 'halisaha', 8.25), // gün 3
    e('2026-08-17', 'yakit', 50), //      gün 3, dörtlü dışı
    e('2026-08-17', 'kredi karti', 200), // gün 3, dörtlü dışı
    e('2026-08-18', 'sosyal', 20), //     gün 4 — 3. güne kadar sayılmamalı
    e('2026-09-10', 'halisaha', 8.25), // gün 27
  ],
}

const active = (expenses: ExpenseLike[]): CycleExpenses => ({ start: '2026-09-15', end: '2026-10-14', expenses })

describe('cumulativeByCategory', () => {
  it('yalnızca verilen döngü gününe kadar toplar', () => {
    expect(cumulativeByCategory(baseline, 3)).toEqual({
      kahvalti: 4.45,
      mutfak: 34.37,
      is: 6.89,
      halisaha: 8.25,
      yakit: 50,
      'kredi karti': 200,
    })
    expect(cumulativeByCategory(baseline, 1)).toEqual({ kahvalti: 4.45, mutfak: 34.37 })
  })

  it('döngü aralığı dışındaki kayıtları saymaz', () => {
    const c = active([e('2026-09-14', 'sosyal', 99), e('2026-09-15', 'sosyal', 1), e('2026-10-15', 'sosyal', 99)])
    expect(cumulativeByCategory(c, 31)).toEqual({ sosyal: 1 })
  })

  it('sent hassasiyetiyle toplar (kayan nokta hatası yok)', () => {
    const c = active([e('2026-09-15', 'is', 0.1), e('2026-09-15', 'is', 0.2), e('2026-09-16', 'is', 3.72)])
    expect(cumulativeByCategory(c, 2).is).toBe(4.02)
  })
})

describe('dortluTotal', () => {
  it('dörtlü = kahvalti + is + halisaha + sosyal', () => {
    expect(DORTLU).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
    expect(dortluTotal({ kahvalti: 1, is: 2, halisaha: 3, sosyal: 4, mutfak: 100, yakit: 100, 'kredi karti': 100 })).toBe(10)
  })

  it('kategori dışı kalemler (mutfak, yakit, kredi karti) dörtlüye girmez', () => {
    expect(dortluTotal({ mutfak: 34.37, yakit: 50, 'kredi karti': 200, temizlik: 5, hanim: 20, mensemax: 45 })).toBe(0)
  })
})

describe('compareToBaseline', () => {
  it('baz ay 3. güne kadar X, aktif döngü 3. güne kadar Y → fark Y − X', () => {
    // Baz ay 3. güne kadar dörtlü: 4.45 + 6.89 + 8.25 = 19.59
    const c = active([
      e('2026-09-15', 'kahvalti', 3.1), // gün 1
      e('2026-09-16', 'halisaha', 8.25), // gün 2
      e('2026-09-17', 'mutfak', 60), //    gün 3, dörtlü dışı
      e('2026-09-17', 'sosyal', 2.5), //   gün 3
      e('2026-09-18', 'sosyal', 50), //    gün 4 — bugünden sonra, sayılmaz
    ])
    const r = compareToBaseline({ active: c, baseline, today: '2026-09-17' })
    expect(r).toEqual({ cycleDay: 3, dortluBuAy: 13.85, dortluBazAy: 19.59, fark: -5.74, kategori: null })
  })

  it('pozitif fark = baz ayın gerisinde', () => {
    const c = active([e('2026-09-15', 'sosyal', 25)])
    const r = compareToBaseline({ active: c, baseline, today: '2026-09-17' })!
    expect(r.fark).toBe(5.41)
  })

  it('kategori dışı kalemler dörtlü kıyasını değiştirmez', () => {
    const base = compareToBaseline({ active: active([]), baseline, today: '2026-09-17' })!
    const withOthers = compareToBaseline({
      active: active([e('2026-09-15', 'mutfak', 80), e('2026-09-16', 'yakit', 55), e('2026-09-16', 'kredi karti', 210)]),
      baseline,
      today: '2026-09-17',
    })!
    expect(withOthers.dortluBuAy).toBe(0)
    expect(withOthers.fark).toBe(base.fark)
  })

  it('baz ay yoksa null döner', () => {
    expect(compareToBaseline({ active: active([e('2026-09-15', 'is', 3)]), baseline: null, today: '2026-09-17' })).toBeNull()
  })

  it('ilgili kategori için bu ay (bugüne kadar) ve baz ay (tüm ay) döner', () => {
    const c = active([e('2026-09-16', 'halisaha', 8.25), e('2026-09-25', 'halisaha', 8.25)])
    const r = compareToBaseline({ active: c, baseline, today: '2026-09-17', category: 'halisaha' })!
    expect(r.kategori).toEqual({ key: 'halisaha', buAy: 8.25, bazAyTumAy: 16.5 })
  })

  it('hiç harcanmamış kategori 0 döner', () => {
    const r = compareToBaseline({ active: active([]), baseline, today: '2026-09-17', category: 'temizlik' })!
    expect(r.kategori).toEqual({ key: 'temizlik', buAy: 0, bazAyTumAy: 0 })
  })

  it('baz ay daha kısaysa son günlerde baz ayın tamamı alınır', () => {
    // Şubat döngüsü: 15 Şub – 14 Mar 2027 = 28 gün.
    const shortBase: CycleExpenses = {
      start: '2027-02-15',
      end: '2027-03-14',
      expenses: [e('2027-02-15', 'sosyal', 10), e('2027-03-14', 'sosyal', 5)],
    }
    const longActive: CycleExpenses = { start: '2027-03-15', end: '2027-04-14', expenses: [] } // 31 gün
    const r = compareToBaseline({ active: longActive, baseline: shortBase, today: '2027-04-14' })!
    expect(r.cycleDay).toBe(31)
    expect(r.dortluBazAy).toBe(15)
  })

  it('bugün döngü dışındaysa döngü sınırına sıkıştırılır', () => {
    const r = compareToBaseline({ active: active([]), baseline, today: '2026-11-01' })!
    expect(r.cycleDay).toBe(30)
  })

  it('1. gün: yalnızca 15\'inin harcamaları', () => {
    const r = compareToBaseline({ active: active([e('2026-09-15', 'kahvalti', 2)]), baseline, today: '2026-09-15' })!
    expect(r).toMatchObject({ cycleDay: 1, dortluBuAy: 2, dortluBazAy: 4.45, fark: -2.45 })
  })
})
