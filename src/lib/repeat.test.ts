import { describe, expect, it } from 'vitest'
import type { ExpenseLike } from './compare'
import { repeatInfo } from './repeat'

const TODAY = '2026-09-28'
const e = (date: string, category: string, amount: number): ExpenseLike => ({ date, category, amount })
const cycle = (expenses: ExpenseLike[], start = '2026-09-15', end = '2026-10-14') => ({ start, end, expenses })
const info = (expenses: ExpenseLike[], categoryType = 'kisilabilir', category = 'kahvalti', c = cycle(expenses)) =>
  repeatInfo({ category, categoryType, today: TODAY, cycle: c })

describe('repeatInfo', () => {
  it('3 gün → hatırlatma yok, 4 gün → var (kısılabilir)', () => {
    const three = [e('2026-09-28', 'kahvalti', 4), e('2026-09-26', 'kahvalti', 3), e('2026-09-24', 'kahvalti', 2)]
    expect(info(three)).toMatchObject({ gunSayisi: 3, hatirlat: false })
    expect(info([...three, e('2026-09-22', 'kahvalti', 5)])).toMatchObject({ gunSayisi: 4, hatirlat: true })
  })

  it('aynı gündeki birden çok harcama tek gün sayılır', () => {
    const r = info([e('2026-09-28', 'kahvalti', 1), e('2026-09-28', 'kahvalti', 2), e('2026-09-27', 'kahvalti', 3)])
    expect(r.gunSayisi).toBe(2)
  })

  it('pencere bugün dahil 7 gün: bugün−6 sayılır, bugün−7 sayılmaz', () => {
    expect(info([e('2026-09-22', 'kahvalti', 1)]).gunSayisi).toBe(1) // bugün − 6
    expect(info([e('2026-09-21', 'kahvalti', 1)]).gunSayisi).toBe(0) // bugün − 7
  })

  it('pencere döngü başlangıcından öteye gitmez; başka kategoriler sayılmaz', () => {
    const c = cycle([e('2026-09-14', 'kahvalti', 9), e('2026-09-15', 'kahvalti', 1), e('2026-09-16', 'sosyal', 1)], '2026-09-15', '2026-10-14')
    expect(repeatInfo({ category: 'kahvalti', categoryType: 'kisilabilir', today: '2026-09-17', cycle: c })).toMatchObject({
      gunSayisi: 1,
      kategoriToplam: 1,
    })
  })

  it('zorunlu ve yarı kategorilerde eşik aşılsa da hatırlatma yok', () => {
    const daily = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map((d) => e(d, 'mutfak', 10))
    expect(info(daily, 'zorunlu', 'mutfak')).toMatchObject({ gunSayisi: 4, hatirlat: false })
    expect(info(daily.map((x) => ({ ...x, category: 'temizlik' })), 'yari', 'temizlik')).toMatchObject({ hatirlat: false })
  })

  it('kategori toplamı tüm döngü, sent hassasiyetinde', () => {
    const r = info([e('2026-09-15', 'kahvalti', 0.1), e('2026-09-16', 'kahvalti', 0.2), e('2026-09-28', 'kahvalti', 4.45)])
    expect(r).toEqual({ category: 'kahvalti', gunSayisi: 1, pencereGun: 7, kategoriToplam: 4.75, hatirlat: false })
  })
})
