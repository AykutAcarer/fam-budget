import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES } from '../../supabase/functions/_shared/categories'
import {
  checkCategoryColor,
  cuttableKeys,
  cuttableLabels,
  keywordConflicts,
  parseKeywords,
  PALETTE_SWATCHES,
  slugify,
  suggestColor,
  uniqueKey,
  validateCategoryForm,
} from './categories'
import { fallbackParse, rulesFor } from './fallbackParser'

describe('slugify / uniqueKey', () => {
  it.each([
    ['Spor', 'spor'],
    ['Spor & Sağlık', 'spor-saglik'],
    ['  Çocuk   giyim ', 'cocuk-giyim'],
    ['İŞ YERİ', 'is-yeri'],
    ['Café 2', 'cafe-2'],
    ['!!!', 'kategori'],
  ])('"%s" → %s', (label, key) => {
    expect(slugify(label)).toBe(key)
  })

  it('çakışmada sayı eki eklenir', () => {
    const keys = DEFAULT_CATEGORIES.map((c) => c.key)
    expect(uniqueKey('Spor', keys)).toBe('spor')
    expect(uniqueKey('Mutfak', keys)).toBe('mutfak-2')
    expect(uniqueKey('Mutfak', [...keys, 'mutfak-2', 'mutfak-3'])).toBe('mutfak-4')
    expect(uniqueKey('Sosyal', ['sosyal', 'sosyal-3'])).toBe('sosyal-2')
  })
})

describe('renk kontrolü', () => {
  it('varsayılan paletteki tüm renkler geçer', () => {
    for (const c of PALETTE_SWATCHES) expect(checkCategoryColor(c).ok, c).toBe(true)
  })

  it.each(['#FFFF00', '#FFFFFF', '#C6EFCE', '#000000', '#0F172A', '#1E1B4B'])('%s reddedilir ve aynı tonda öneri gelir', (color) => {
    const check = checkCategoryColor(color)
    expect(check.ok).toBe(false)
    if (color !== '#FFFFFF' && color !== '#000000') {
      expect(check.suggestion).not.toBeNull()
      expect(checkCategoryColor(check.suggestion!).ok).toBe(true)
    }
  })

  it('öneri geçen bir renktir (gri için bile)', () => {
    const s = suggestColor('#EEEEEE')
    expect(s).not.toBeNull()
    expect(checkCategoryColor(s!).ok).toBe(true)
  })
})

describe('parseKeywords', () => {
  it('virgülle ayırır, boşlukları toplar, küçük harfe çevirir, tekrarları atar', () => {
    expect(parseKeywords('Market,  kasap ,, MANAV, market, İşte,  spor   salonu')).toEqual(['market', 'kasap', 'manav', 'işte', 'spor salonu'])
    expect(parseKeywords('   ')).toEqual([])
  })

  it('Türkçe harf farkı tekrar sayılır ("yuzme" ≈ "yüzme")', () => {
    expect(parseKeywords('yüzme, yuzme')).toEqual(['yüzme'])
  })

  it('başka kategoride olan kelimeler uyarı olarak döner', () => {
    const others = DEFAULT_CATEGORIES.map((c) => ({ key: c.key, label: c.label, keywords: c.keywords }))
    expect(keywordConflicts(['market', 'fitness', 'KAHVE'], others)).toEqual([
      { keyword: 'market', label: 'Mutfak / Market' },
      { keyword: 'KAHVE', label: 'İş / öğlen / atıştırmalık' },
    ])
  })
})

describe('validateCategoryForm', () => {
  const others = DEFAULT_CATEGORIES.map((c) => c.label)
  const base = { label: 'Spor', type: 'kisilabilir' as const, color: '#3e89de', keywords: 'fitness, yüzme' }

  it('geçerli form: etiket temizlenir, renk büyük harf, kelimeler ayrılır', () => {
    expect(validateCategoryForm({ ...base, label: '  Spor   salonu ' }, others)).toEqual({
      ok: true,
      value: { label: 'Spor salonu', type: 'kisilabilir', color: '#3E89DE', keywords: ['fitness', 'yüzme'] },
    })
  })

  it('boş ad, aynı ad (Türkçe harf/büyük-küçük duyarsız), tür yok', () => {
    const r = validateCategoryForm({ ...base, label: ' ', type: '' }, others)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['label', 'type'])
    const dup = validateCategoryForm({ ...base, label: 'YAKIT' }, others)
    expect(!dup.ok && dup.errors.label).toMatch(/zaten var/)
  })

  it('erişilemez renk reddedilir ve hangi temada sorun olduğu söylenir', () => {
    const light = validateCategoryForm({ ...base, color: '#FFD966' }, others)
    expect(!light.ok && light.errors.color).toMatch(/açık temada/)
    const dark = validateCategoryForm({ ...base, color: '#1E1B4B' }, others)
    expect(!dark.ok && dark.errors.color).toMatch(/koyu temada/)
    const bad = validateCategoryForm({ ...base, color: 'mavi' }, others)
    expect(!bad.ok && bad.errors.color).toMatch(/#RRGGBB/)
  })

  it('çok fazla ya da çok uzun anahtar kelime', () => {
    const many = Array.from({ length: 31 }, (_, i) => `k${i}`).join(',')
    expect(validateCategoryForm({ ...base, keywords: many }, others).ok).toBe(false)
    expect(validateCategoryForm({ ...base, keywords: 'x'.repeat(41) }, others).ok).toBe(false)
  })
})

describe('yeni kategori → yedek parser', () => {
  it('formdan gelen anahtar kelimeler parser tarafından tanınır', () => {
    const r = validateCategoryForm({ label: 'Spor', type: 'kisilabilir', color: '#3E89DE', keywords: 'Fitness, yüzme havuzu' }, [])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const categories = [
      ...DEFAULT_CATEGORIES.map((c) => ({ key: c.key, keywords: [...c.keywords] })),
      { key: uniqueKey(r.value.label, DEFAULT_CATEGORIES.map((c) => c.key)), keywords: r.value.keywords },
    ]
    expect(fallbackParse('fitness 29,90', '2026-09-28', rulesFor(categories))).toMatchObject({ category: 'spor', amount: 29.9, matched: true })
    expect(fallbackParse('YÜZME HAVUZUNA 6', '2026-09-28', rulesFor(categories))).toMatchObject({ category: 'spor' })
  })

  it('keywords alanı hiç yoksa (eski veri) varsayılan kelimeler kullanılır; boş liste bilinçlidir', () => {
    expect(fallbackParse('market 12', '2026-09-28', rulesFor([{ key: 'mutfak' }, { key: 'sosyal' }]))).toMatchObject({ category: 'mutfak', matched: true })
    expect(fallbackParse('market 12', '2026-09-28', rulesFor([{ key: 'mutfak', keywords: [] }, { key: 'sosyal' }]))).toMatchObject({ category: 'sosyal', matched: false })
  })
})

describe('kısılabilir küme (is_cuttable)', () => {
  const rows = [
    { key: 'mutfak', label: 'Mutfak', is_cuttable: false },
    { key: 'kahvalti', label: 'Kahvaltı', is_cuttable: true },
    { key: 'spor', label: 'Spor', is_cuttable: true },
  ]

  it('yalnız işaretli kategoriler, kategori sırasıyla', () => {
    expect(cuttableKeys(rows)).toEqual(['kahvalti', 'spor'])
    expect(cuttableLabels(rows)).toEqual(['Kahvaltı', 'Spor'])
  })

  it('hiçbiri işaretli değilse boş', () => {
    expect(cuttableKeys(rows.map((r) => ({ ...r, is_cuttable: false })))).toEqual([])
  })

  it('alan hiç yoksa (migration öncesi) varsayılan dörtlü; kullanıcıda olmayan key eklenmez', () => {
    expect(cuttableKeys([{ key: 'kahvalti' }, { key: 'mutfak' }, { key: 'sosyal' }])).toEqual(['kahvalti', 'sosyal'])
    expect(cuttableKeys([])).toEqual([])
  })

  it('varsayılan kategorilerde kısılabilir dörtlü tek kaynakta tanımlı', () => {
    expect(DEFAULT_CATEGORIES.filter((c) => c.cuttable).map((c) => c.key)).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
  })
})
