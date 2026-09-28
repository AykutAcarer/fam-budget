import { describe, expect, it } from 'vitest'
import {
  categoryBreakdown,
  compareToBaseline,
  cumulativeByCategory,
  cycleOptions,
  dailyCumulativeSeries,
  defaultCycleId,
  withBaseline,
  DORTLU,
  dortluTotal,
  type CycleExpenses,
  type ExpenseLike,
} from './compare'

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

// ---------------------------------------------------------------------------
// Döngü detay ekranı
// ---------------------------------------------------------------------------

const cyc = (id: string, start: string, end: string, is_baseline = false) => ({ id, label: id, start_date: start, end_date: end, is_baseline })

describe('cycleOptions / defaultCycleId', () => {
  const cycles = [cyc('2026-08', '2026-08-15', '2026-09-14', true), cyc('2026-10', '2026-10-15', '2026-11-14'), cyc('2026-09', '2026-09-15', '2026-10-14')]

  it('en yeniden eskiye; aktif ve baz ay işaretli', () => {
    const opts = cycleOptions(cycles, '2026-09-28')
    expect(opts.map((o) => [o.cycle.id, o.isActive, o.isBaseline])).toEqual([
      ['2026-10', false, false],
      ['2026-09', true, false],
      ['2026-08', false, true],
    ])
  })

  it('varsayılan: aktif; aktif yoksa bugünden önce başlayan en yeni', () => {
    expect(defaultCycleId(cycleOptions(cycles, '2026-09-28'), '2026-09-28')).toBe('2026-09')
    expect(defaultCycleId(cycleOptions(cycles, '2027-03-01'), '2027-03-01')).toBe('2026-10')
    expect(defaultCycleId(cycleOptions(cycles, '2026-01-01'), '2026-01-01')).toBe('2026-10')
    expect(defaultCycleId([], '2026-09-28')).toBeNull()
  })
})

describe('withBaseline', () => {
  it('seçilen döngü baz ay, diğerleri değil; girdiyi değiştirmez', () => {
    const cycles = [cyc('a', '2026-07-15', '2026-08-14', true), cyc('b', '2026-08-15', '2026-09-14'), cyc('c', '2026-09-15', '2026-10-14')]
    const next = withBaseline(cycles, 'b')
    expect(next.filter((c) => c.is_baseline).map((c) => c.id)).toEqual(['b'])
    expect(cycles[0].is_baseline).toBe(true)
    // Seçici yeni baz ayı gösterir.
    expect(cycleOptions(next, '2026-09-28').find((o) => o.isBaseline)?.cycle.id).toBe('b')
  })
})

describe('dailyCumulativeSeries', () => {
  const selected = active([
    e('2026-09-15', 'kahvalti', 3.1), // gün 1
    e('2026-09-15', 'mutfak', 60), //    dörtlü dışı
    e('2026-09-17', 'sosyal', 2.5), //   gün 3
    e('2026-09-17', 'is', 0.1), //       gün 3
    e('2026-09-17', 'is', 0.2), //       gün 3 (sent hassasiyeti)
    e('2026-10-01', 'halisaha', 8.25), // gün 17 — bugünden sonra
  ])

  it('kümülatif artar; bugünden sonrası (aktif döngü) boş', () => {
    const s = dailyCumulativeSeries({ selected, baseline, today: '2026-09-18' })
    expect(s).toHaveLength(31) // baz ay 31 gün, bu döngü 30
    expect(s.slice(0, 5)).toEqual([
      { day: 1, current: 3.1, baseline: 4.45 },
      { day: 2, current: 3.1, baseline: 11.34 },
      { day: 3, current: 5.9, baseline: 19.59 },
      { day: 4, current: 5.9, baseline: 39.59 },
      { day: 5, current: null, baseline: 39.59 },
    ])
    expect(s.slice(4).every((p) => p.current === null)).toBe(true)
    // Azalmaz.
    const vals = s.map((p) => p.baseline!)
    expect(vals.every((v, i) => i === 0 || v >= vals[i - 1])).toBe(true)
    expect(s[30]).toEqual({ day: 31, current: null, baseline: 47.84 })
  })

  it('geçmiş döngü tamamen çizilir; bu döngü 30 gün, 31. gün boş', () => {
    const s = dailyCumulativeSeries({ selected, baseline, today: '2026-12-01' })
    expect(s[16]).toMatchObject({ day: 17, current: 14.15 })
    expect(s[29].current).toBe(14.15)
    expect(s[30].current).toBeNull()
  })

  it('henüz başlamamış döngü boş', () => {
    const s = dailyCumulativeSeries({ selected, baseline: null, today: '2026-09-01' })
    expect(s.every((p) => p.current === null)).toBe(true)
  })

  it('baz ay yoksa tek seri', () => {
    const s = dailyCumulativeSeries({ selected, baseline: null, today: '2026-09-18' })
    expect(s).toHaveLength(30)
    expect(s.every((p) => p.baseline === null)).toBe(true)
    expect(s[3].current).toBe(5.9)
  })

  it('dashboard kıyas kartıyla aynı rakamlar (bugünkü nokta = dortluBuAy / dortluBazAy)', () => {
    const today = '2026-09-17'
    const s = dailyCumulativeSeries({ selected, baseline, today })
    const c = compareToBaseline({ active: selected, baseline, today })!
    const point = s[c.cycleDay - 1]
    expect(point).toEqual({ day: 3, current: c.dortluBuAy, baseline: c.dortluBazAy })
  })
})

describe('categoryBreakdown', () => {
  const categories = [
    { key: 'mutfak', label: 'Mutfak', type: 'zorunlu', sort_order: 1 },
    { key: 'yakit', label: 'Yakıt', type: 'zorunlu', sort_order: 2 },
    { key: 'kahvalti', label: 'Kahvaltı', type: 'kisilabilir', sort_order: 4 },
    { key: 'is', label: 'İş', type: 'kisilabilir', sort_order: 5 },
    { key: 'halisaha', label: 'Halı saha', type: 'kisilabilir', sort_order: 6 },
    { key: 'sosyal', label: 'Sosyal', type: 'kisilabilir', sort_order: 7 },
    { key: 'kredi karti', label: 'Kredi kartı', type: 'borc', sort_order: 10 },
  ]
  const selected = active([e('2026-09-15', 'mutfak', 80), e('2026-09-16', 'sosyal', 12), e('2026-09-16', 'kahvalti', 3), e('2026-09-20', 'mutfak', 20)])

  it('baz ay (tüm ay) eşleşmesi, fark ve dörtlü gruplama', () => {
    const r = categoryBreakdown({ selected, baseline, categories })
    expect(r.dortlu).toEqual([
      { key: 'sosyal', label: 'Sosyal', type: 'kisilabilir', dortlu: true, current: 12, baseline: 20, diff: -8 },
      { key: 'kahvalti', label: 'Kahvaltı', type: 'kisilabilir', dortlu: true, current: 3, baseline: 4.45, diff: -1.45 },
      { key: 'halisaha', label: 'Halı saha', type: 'kisilabilir', dortlu: true, current: 0, baseline: 16.5, diff: -16.5 },
      { key: 'is', label: 'İş', type: 'kisilabilir', dortlu: true, current: 0, baseline: 6.89, diff: -6.89 },
    ])
    expect(r.others).toEqual([
      { key: 'mutfak', label: 'Mutfak', type: 'zorunlu', dortlu: false, current: 100, baseline: 34.37, diff: 65.63 },
      { key: 'kredi karti', label: 'Kredi kartı', type: 'borc', dortlu: false, current: 0, baseline: 200, diff: -200 },
      { key: 'yakit', label: 'Yakıt', type: 'zorunlu', dortlu: false, current: 0, baseline: 50, diff: -50 },
    ])
    expect(r.dortluTotal).toEqual({ current: 15, baseline: 47.84, diff: -32.84 })
    expect(r.total).toBe(115)
  })

  it('baz ay yoksa baz/fark null, yalnız bu döngünün kategorileri', () => {
    const r = categoryBreakdown({ selected, baseline: null, categories })
    expect([...r.dortlu, ...r.others].map((x) => [x.key, x.current, x.baseline, x.diff])).toEqual([
      ['sosyal', 12, null, null],
      ['kahvalti', 3, null, null],
      ['mutfak', 100, null, null],
    ])
    expect(r.dortluTotal).toEqual({ current: 15, baseline: null, diff: null })
  })

  it('bilinmeyen kategori anahtarı etiket olarak kullanılır', () => {
    const r = categoryBreakdown({ selected: active([e('2026-09-15', 'spor', 5)]), baseline: null, categories })
    expect(r.others[0]).toMatchObject({ key: 'spor', label: 'spor' })
  })
})
