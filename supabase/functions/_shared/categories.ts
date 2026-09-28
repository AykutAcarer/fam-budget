/**
 * Varsayılan kategoriler ve renk paleti — TEK KAYNAK.
 *
 * Kullananlar: istemci (renkler, rozetler, donut sırası, yedek kategori listesi),
 * chat-expense Edge Function (varsayılan kategori enum'u) ve veritabanı seed'i.
 * SQL bu dosyayı okuyamadığı için seed_default_categories() bunun birebir
 * aynasıdır; supabase/tests/category-colors.test.ts ikisinin aynı olduğunu doğrular.
 * Renk değişirse: burayı güncelle + seed'i ve eski renkleri taşıyan bir migration ekle.
 *
 * Palet, dataviz doğrulayıcısından geçirildi (açık zemin #ffffff, koyu zemin #0f172a):
 *  - her renk iki zeminde de ≥ 3:1 kontrast, OKLCH L 0.48–0.67 bandında
 *  - donut'ta komşu dilimler (DONUT_ORDER, halka) renk körlüğü ΔE ≥ 8, normal görüş ΔE ≥ 15
 *  - halisaha ↔ sosyal: renk körlüğü ΔE 8.3, normal görüş ΔE 15.7
 *  - kredi karti bilinçli olarak nötr gridir (renk doygunluğu eşiğinden muaf)
 */

export type CategoryType = 'zorunlu' | 'kisilabilir' | 'yari' | 'borc'

export interface DefaultCategory {
  key: string
  label: string
  type: CategoryType
  color: string
}

/** sort_order sırasıyla (1'den başlar). */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { key: 'mutfak', label: 'Mutfak / Market', type: 'zorunlu', color: '#22A06B' },
  { key: 'yakit', label: 'Yakıt', type: 'zorunlu', color: '#E47007' },
  { key: 'mensemax', label: 'MensaMax (okul yemeği)', type: 'zorunlu', color: '#C026D3' },
  { key: 'kahvalti', label: 'Kahvaltı', type: 'kisilabilir', color: '#B78C11' },
  { key: 'is', label: 'İş / öğlen / atıştırmalık', type: 'kisilabilir', color: '#E23B3B' },
  { key: 'halisaha', label: 'Halı saha', type: 'kisilabilir', color: '#3E89DE' },
  { key: 'sosyal', label: 'Sosyal / diğer', type: 'kisilabilir', color: '#7C4DFF' },
  { key: 'temizlik', label: 'Temizlik / Rossmann', type: 'yari', color: '#17A2B8' },
  { key: 'hanim', label: 'Hanıma verilen', type: 'yari', color: '#A1592B' },
  { key: 'kredi karti', label: 'Kredi kartı ödemesi', type: 'borc', color: '#6B7280' },
]

export const DEFAULT_CATEGORY_KEYS: readonly string[] = DEFAULT_CATEGORIES.map((c) => c.key)

/**
 * Donut dilim sırası (halka). Komşu dilimlerin renkleri en iyi ayrışacak
 * şekilde seçildi; sort_order'dan farklıdır. Listede olmayan (kullanıcının
 * eklediği) kategoriler sona eklenir.
 */
export const DONUT_ORDER: readonly string[] = [
  'mutfak', 'yakit', 'mensemax', 'kahvalti', 'halisaha', 'is', 'kredi karti', 'sosyal', 'temizlik', 'hanim',
]

/** Bilinmeyen kategori rengi (nötr gri, iki temada da ≥ 3:1). */
export const NEUTRAL_CATEGORY_COLOR = '#6B7280'

/** Eski (pastel) varsayılan renkler → yeni renkler; taşıma migration'ı bununla aynıdır. */
export const LEGACY_PASTEL_COLORS: Readonly<Record<string, string>> = {
  mutfak: '#C6EFCE',
  yakit: '#FFD966',
  mensemax: '#FF99CC',
  kahvalti: '#FFF2CC',
  is: '#F4B183',
  halisaha: '#9DC3E6',
  sosyal: '#D9D2E9',
  temizlik: '#CC99FF',
  hanim: '#99E6E6',
  'kredi karti': '#BFBFBF',
}
