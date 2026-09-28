import { describe, expect, it } from 'vitest'
import type { Comparison } from './compare'
import { numbersIn, replyIsGrounded, summaryText } from './chatText'

const TODAY = '2026-09-28'
const labels = new Map([
  ['halisaha', 'Halı saha'],
  ['yakit', 'Yakıt'],
  ['sosyal', 'Sosyal / diğer'],
])
const cmp = (fark: number): Comparison => ({
  cycleDay: 14,
  dortluBuAy: 120.5,
  dortluBazAy: 120.5 - fark,
  fark,
  kategori: { key: 'halisaha', buAy: 16.5, bazAyTumAy: 33 },
})
const item = { amount: 8.25, category: 'halisaha', date: TODAY, description: 'halısaha' }

// Intl biçimlendirmesi para ile sembol arasına bölünemez boşluk koyar; karşılaştırmada normalleştir.
const norm = (s: string) => s.replace(/ /g, ' ')

describe('summaryText', () => {
  it('öndeyken', () => {
    expect(norm(summaryText([item], cmp(-12.4), { today: TODAY, labels }))).toBe(
      'Halı saha 8,25 € kaydedildi. Kısılabilir harcamalarda baz ayın 12,40 € altındasın 🎯',
    )
  })

  it('gerideyken nazik uyarı', () => {
    expect(norm(summaryText([item], cmp(5), { today: TODAY, labels }))).toContain('baz ayın 5,00 € üstündesin')
  })

  it('baz ay yoksa kıyas cümlesi yok; eski tarih gösterilir', () => {
    const t = summaryText([{ ...item, category: 'yakit', amount: 33, date: '2026-09-27' }], null, { today: TODAY, labels })
    expect(norm(t)).toBe('Yakıt 33,00 € (27 Eyl) kaydedildi.')
  })

  it('çevrimdışı ve tanınmayan kategori notları', () => {
    const t = summaryText([{ ...item, category: 'sosyal' }], null, { today: TODAY, labels, queued: true, unmatched: true })
    expect(t).toContain('Sosyal / diğer')
    expect(t).toContain('internet gelince')
  })
})

describe('numbersIn', () => {
  it('Türkçe biçimli sayılar', () => {
    expect(numbersIn('8,25 € kaydettim, baz ayın 1.250,50 € altında, 14. gün')).toEqual([8.25, 1250.5, 14])
  })
})

describe('replyIsGrounded', () => {
  it('yalnızca verilen rakamları kullanan cevabı kabul eder', () => {
    expect(replyIsGrounded('Halı saha 8,25 € kaydettim. Hâlâ baz ayın 12,40 € altındasın 🎯', [item], cmp(-12.4))).toBe(true)
    expect(replyIsGrounded('14. gündesin, bu ay 120,50 €; 2 kez halı saha', [item], cmp(-12.4))).toBe(true)
  })

  it('uydurma rakam içeren cevabı reddeder', () => {
    expect(replyIsGrounded('Baz ayın 15,00 € altındasın', [item], cmp(-12.4))).toBe(false)
    expect(replyIsGrounded('8,25 € kaydettim; toplam 128,75 € oldu', [item], cmp(-12.4))).toBe(false)
  })

  it('baz ay yokken kıyas rakamı kullanılamaz', () => {
    expect(replyIsGrounded('8,25 € kaydettim', [item], null)).toBe(true)
    expect(replyIsGrounded('8,25 € kaydettim, baz ayın 12,40 € altındasın', [item], null)).toBe(false)
  })
})

describe('replyIsGrounded — tekrar bilgisi', () => {
  const repeat = { category: 'kahvalti', gunSayisi: 5, pencereGun: 7, kategoriToplam: 18.4, hatirlat: true }
  it('verilen tekrar toplamı kabul, uydurma toplam red', () => {
    expect(replyIsGrounded('Bu hafta 5. gün kahvaltı dışarıda, toplam 18,40 €.', [item], null, repeat)).toBe(true)
    expect(replyIsGrounded('Bu hafta kahvaltıya 25,00 € gitti.', [item], null, repeat)).toBe(false)
    expect(replyIsGrounded('toplam 18,40 €', [item], null)).toBe(false)
  })
})
