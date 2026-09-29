import { describe, expect, it } from 'vitest'
import { detectCategory, fallbackParse, foldTurkish, keywordPattern, parseTurkishAmount } from './fallbackParser'

const TODAY = '2026-09-28'

describe('fallbackParse — gerçek Türkçe cümleler', () => {
  it.each([
    ['8,25 halısaha', { amount: 8.25, category: 'halisaha', date: TODAY }],
    ['işte öğlen atıştırmalık 3,72', { amount: 3.72, category: 'is', date: TODAY }],
    ['20 döner', { amount: 20, category: 'sosyal', date: TODAY }],
    ['dün 33 yakıt', { amount: 33, category: 'yakit', date: '2026-09-27' }],
    ['eşime 30 verdim', { amount: 30, category: 'hanim', date: TODAY }],
    ['eşime döner 9', { amount: 9, category: 'sosyal', date: TODAY }],
    ['1,95 hanım kahvaltı', { amount: 1.95, category: 'kahvalti', date: TODAY }],
    ['25 eylülde 15 mutfak', { amount: 15, category: 'mutfak', date: '2026-09-25' }],
    ['Rossmann 6,98', { amount: 6.98, category: 'temizlik', date: TODAY }],
    ['kredi kartı 210 ödedim', { amount: 210, category: 'kredi karti', date: TODAY }],
  ])('"%s"', (text, expected) => {
    expect(fallbackParse(text, TODAY)).toMatchObject({ ...expected, matched: true })
  })
})

describe('fallbackParse — kenar durumlar', () => {
  it('tanınmayan metin "sosyal" olur ve matched=false', () => {
    expect(fallbackParse('12 hediye', TODAY)).toMatchObject({ amount: 12, category: 'sosyal', matched: false })
  })

  it('tutar yoksa null', () => {
    expect(fallbackParse('halısaha', TODAY)).toBeNull()
    expect(fallbackParse('dün yakıt', TODAY)).toBeNull()
    expect(fallbackParse('0 market', TODAY)).toBeNull()
  })

  it('açıklamadan tutar ve tarih çıkarılır', () => {
    expect(fallbackParse('dün 33 yakıt', TODAY)?.description).toBe('yakıt')
    expect(fallbackParse('işte öğlen atıştırmalık 3,72 €', TODAY)?.description).toBe('işte öğlen atıştırmalık')
    expect(fallbackParse('25 eylülde 15 mutfak', TODAY)?.description).toBe('mutfak')
  })

  it('büyük harf ve Türkçe İ/I', () => {
    expect(fallbackParse('İŞTE KAHVE 2,40', TODAY)).toMatchObject({ amount: 2.4, category: 'is' })
    expect(fallbackParse('HALI SAHA 8,25', TODAY)).toMatchObject({ category: 'halisaha' })
  })

  it('evvelsi gün ve "25.09" biçimi', () => {
    expect(fallbackParse('evvelsi gün 5 simit', TODAY)).toMatchObject({ date: '2026-09-26', amount: 5, category: 'kahvalti' })
    expect(fallbackParse('25.09 12,50 market', TODAY)).toMatchObject({ date: '2026-09-25', amount: 12.5, category: 'mutfak' })
    expect(fallbackParse('3.10.2026 40 benzin', '2026-10-05')).toMatchObject({ date: '2026-10-03', amount: 40 })
  })

  it('tek sayı "12.05" tarih değil tutar sayılır', () => {
    expect(fallbackParse('12.05 market', TODAY)).toMatchObject({ amount: 12.05, date: TODAY })
  })

  it('yıl verilmeyen gelecek tarih geçen yıla düşer', () => {
    expect(fallbackParse('28 aralık 30 market', '2027-01-03')).toMatchObject({ date: '2026-12-28' })
  })

  it('kullanıcının kategori listesiyle sınırlanır', () => {
    const rules = [{ key: 'mutfak', keywords: ['market'] }, { key: 'sosyal', keywords: [] }]
    expect(fallbackParse('8,25 halısaha', TODAY, rules)).toMatchObject({ category: 'sosyal', matched: false })
  })

  it('kelime sınırı: "sepet" mutfak(et) değildir, "kahvaltı" iş(kahve) değildir', () => {
    expect(detectCategory(foldTurkish('sepet'))).toEqual({ category: 'sosyal', matched: false })
    expect(detectCategory(foldTurkish('kahvaltı'))).toEqual({ category: 'kahvalti', matched: true })
    expect(detectCategory(foldTurkish('eti aldım'))).toEqual({ category: 'mutfak', matched: true })
  })
})

describe('parseTurkishAmount', () => {
  it.each([
    ['8,25', 8.25],
    ['3,72', 3.72],
    ['20', 20],
    ['1.250', 1250],
    ['1.250,50', 1250.5],
    ['12.345.678', 12345678],
    ['8.25', 8.25],
    ['1,234.5', 1234.5],
    ['3,725', 3.73],
    ['0', null],
  ])('%s → %s', (raw, expected) => {
    expect(parseTurkishAmount(raw)).toBe(expected)
  })
})

describe('kullanıcı kategorileri ve anahtar kelimeleri', () => {
  const rules = [
    { key: 'mutfak', keywords: ['market'] },
    { key: 'spor', keywords: ['spor salonu', 'fitness', 'yüzme'] },
    { key: 'sosyal', keywords: ['döner'] },
  ]

  it('yeni kategorinin anahtar kelimesini tanır (Türkçe harf ve çekim ekiyle)', () => {
    expect(fallbackParse('35 fitness üyeliği', TODAY, rules)).toMatchObject({ amount: 35, category: 'spor', matched: true })
    expect(fallbackParse('YÜZMEYE 12', TODAY, rules)).toMatchObject({ category: 'spor' })
    expect(fallbackParse('spor salonuna 40', TODAY, rules)).toMatchObject({ category: 'spor' })
  })

  it('birden çok eşleşmede kategori sırasında önce gelen kazanır', () => {
    expect(fallbackParse('marketten döner 9', TODAY, rules)).toMatchObject({ category: 'mutfak' })
    expect(fallbackParse('marketten döner 9', TODAY, [...rules].reverse())).toMatchObject({ category: 'sosyal' })
  })

  it('hiçbiri tutmazsa sosyal; sosyal yoksa ilk kategori', () => {
    expect(fallbackParse('20 hediye', TODAY, rules)).toMatchObject({ category: 'sosyal', matched: false })
    expect(fallbackParse('20 hediye', TODAY, rules.slice(0, 2))).toMatchObject({ category: 'mutfak', matched: false })
  })

  it('keywordPattern: kısa kelime tam, uzun kelime kelime başında eşleşir', () => {
    expect(keywordPattern('et')!.test(foldTurkish('sepet'))).toBe(false)
    expect(keywordPattern('et')!.test(foldTurkish('et aldım'))).toBe(true)
    expect(keywordPattern('iş')!.test(foldTurkish('isim'))).toBe(false)
    expect(keywordPattern('Market')!.test(foldTurkish('marketten'))).toBe(true)
    expect(keywordPattern('halı saha')!.test(foldTurkish('HALI SAHA'))).toBe(true)
    expect(keywordPattern('c++')!.test('c++ kursu')).toBe(true) // özel karakterler güvenli
    expect(keywordPattern('   ')).toBeNull()
  })
})
