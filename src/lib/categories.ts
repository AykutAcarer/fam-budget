/**
 * Kategori yönetimi — saf fonksiyonlar (Ayarlar > Kategoriler).
 *
 * - key: etiketten türetilir, kullanıcı içinde tekildir (çakışırsa "-2", "-3" …).
 *   Etiket sonradan değişse de key sabit kalır (harcamalar key'e bağlı).
 * - Renk: açık (#ffffff) ve koyu (#0f172a) grafik zemininde ≥ 3:1 kontrast
 *   (donut dilimi ve noktalar iki temada da seçilebilsin). Geçmezse reddedilir
 *   ve aynı tonda geçen bir renk önerilir.
 * - Anahtar kelimeler: virgülle ayrılmış; yedek (çevrimdışı) parser bunları kullanır.
 */
import type { CategoryType } from '../../supabase/functions/_shared/categories'
import { DEFAULT_CATEGORIES } from '../../supabase/functions/_shared/categories'
import { contrastRatio, fromOklch, toOklch } from './categoryColors'
import { foldTurkish } from './fallbackParser'

/**
 * Kullanıcının kısılabilir seçtiği kategori key'leri (kategori sırasıyla).
 * is_cuttable alanı hiç gelmemişse (migration öncesi / eski önbellek) varsayılan
 * kısılabilir kategoriler kullanılır — davranış değişmesin.
 */
export function cuttableKeys(categories: readonly { key: string; is_cuttable?: boolean | null }[]): string[] {
  if (categories.length && categories.every((c) => c.is_cuttable === undefined || c.is_cuttable === null)) {
    const own = new Set(categories.map((c) => c.key))
    return DEFAULT_CATEGORIES.filter((d) => d.cuttable && own.has(d.key)).map((d) => d.key)
  }
  return categories.filter((c) => c.is_cuttable === true).map((c) => c.key)
}

/** Kısılabilir kategorilerin adları (kart alt başlıkları için), kategori sırasıyla. */
export function cuttableLabels(categories: readonly { key: string; label: string; is_cuttable?: boolean | null }[]): string[] {
  const keys = new Set(cuttableKeys(categories))
  return categories.filter((c) => keys.has(c.key)).map((c) => c.label)
}

/**
 * Kategori türünün görünen adları. Tür YALNIZCA açıklayıcı bir etikettir; hiçbir
 * hesaba (kıyas, kategori özeti, tekrar hatırlatması) girmez — onlar `is_cuttable`
 * anahtarına bakar. Saklanan değer `kisilabilir` tarihsel olarak aynı kalır, ama
 * anahtarla karışmasın diye kullanıcıya "Esnek" gösterilir.
 */
export const CATEGORY_TYPE_LABELS: Readonly<Record<CategoryType, string>> = {
  zorunlu: 'Zorunlu',
  kisilabilir: 'Esnek',
  yari: 'Yarı zorunlu',
  borc: 'Borç ödemesi',
}

/** Kısa (küçük harf) tür etiketi — tablolarda; bilinmeyen tür için boş. */
export function categoryTypeShort(type: string): string {
  const short: Record<CategoryType, string> = { zorunlu: 'zorunlu', kisilabilir: 'esnek', yari: 'yarı', borc: 'borç' }
  return short[type as CategoryType] ?? ''
}

/** Formda hazır renkler: doğrulanmış varsayılan palet. */
export const PALETTE_SWATCHES: readonly string[] = DEFAULT_CATEGORIES.map((c) => c.color)

export const CHART_SURFACES = { light: '#ffffff', dark: '#0f172a' } as const
export const MIN_GRAPHIC_CONTRAST = 3

export const MAX_LABEL_LENGTH = 60
export const MAX_KEYWORDS = 30
export const MAX_KEYWORD_LENGTH = 40

// ---------------------------------------------------------------------------
// key
// ---------------------------------------------------------------------------

/** Etiketten key tabanı: Türkçe harfler katlanır, harf/rakam dışı "-" olur. "Spor & Sağlık" → "spor-saglik". */
export function slugify(label: string): string {
  const slug = foldTurkish(label.trim())
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || 'kategori'
}

/** Kullanıcının mevcut key'leriyle çakışmayan key: "spor", "spor-2", "spor-3" … */
export function uniqueKey(label: string, existingKeys: Iterable<string>): string {
  const taken = new Set(existingKeys)
  const base = slugify(label)
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

// ---------------------------------------------------------------------------
// Renk
// ---------------------------------------------------------------------------

export interface ColorCheck {
  ok: boolean
  light: number
  dark: number
  /** Geçmiyorsa aynı tonda, iki zeminde de geçen öneri. */
  suggestion: string | null
}

const HEX = /^#[0-9a-f]{6}$/i

export function isHexColor(value: string): boolean {
  return HEX.test(value)
}

/** Renk iki temada da grafik zemininden yeterince ayrışıyor mu? */
export function checkCategoryColor(color: string): ColorCheck {
  const light = contrastRatio(color, CHART_SURFACES.light)
  const dark = contrastRatio(color, CHART_SURFACES.dark)
  const ok = light >= MIN_GRAPHIC_CONTRAST && dark >= MIN_GRAPHIC_CONTRAST
  return { ok, light, dark, suggestion: ok ? null : suggestColor(color) }
}

/** Ton korunur, açıklık iki zemin için de geçen banda çekilir (orta noktadan başlayarak). */
export function suggestColor(color: string): string | null {
  const [L0, C, H] = toOklch(color)
  const passes = (hex: string) =>
    contrastRatio(hex, CHART_SURFACES.light) >= MIN_GRAPHIC_CONTRAST && contrastRatio(hex, CHART_SURFACES.dark) >= MIN_GRAPHIC_CONTRAST
  // Özgün açıklığa en yakın geçen değeri ara.
  for (let d = 0; d <= 0.5; d += 0.01) {
    for (const L of [L0 - d, L0 + d]) {
      if (L <= 0 || L >= 1) continue
      const hex = fromOklch(L, C, H).toUpperCase()
      if (passes(hex)) return hex
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Anahtar kelimeler
// ---------------------------------------------------------------------------

/** "market, Kasap ,  manav,,market" → ['market', 'kasap', 'manav'] (küçük harf, tekrarsız). */
export function parseKeywords(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const k = part.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR')
    if (!k) continue
    const folded = foldTurkish(k)
    if (seen.has(folded)) continue
    seen.add(folded)
    out.push(k)
  }
  return out
}

export const formatKeywords = (keywords: readonly string[]): string => keywords.join(', ')

/** Başka kategoride de olan anahtar kelimeler (uyarı: sırada önce gelen kazanır). */
export function keywordConflicts(
  keywords: readonly string[],
  others: readonly { key: string; label: string; keywords: readonly string[] }[],
): { keyword: string; label: string }[] {
  const out: { keyword: string; label: string }[] = []
  for (const kw of keywords) {
    const f = foldTurkish(kw)
    const other = others.find((o) => o.keywords.some((x) => foldTurkish(x) === f))
    if (other) out.push({ keyword: kw, label: other.label })
  }
  return out
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export interface CategoryFormInput {
  label: string
  type: CategoryType | ''
  color: string
  keywords: string
}

export interface CategoryFormValue {
  label: string
  type: CategoryType
  color: string
  keywords: string[]
}

export type CategoryFormResult =
  | { ok: true; value: CategoryFormValue }
  | { ok: false; errors: Partial<Record<keyof CategoryFormInput, string>> }

const TYPES = Object.keys(CATEGORY_TYPE_LABELS) as CategoryType[]

/**
 * Formu doğrular.
 * @param otherLabels düzenlenen kategori HARİÇ diğer kategorilerin etiketleri
 */
export function validateCategoryForm(input: CategoryFormInput, otherLabels: readonly string[]): CategoryFormResult {
  const errors: Partial<Record<keyof CategoryFormInput, string>> = {}

  const label = input.label.trim().replace(/\s+/g, ' ')
  if (!label) errors.label = 'Kategori adı boş olamaz.'
  else if (label.length > MAX_LABEL_LENGTH) errors.label = `Kategori adı en fazla ${MAX_LABEL_LENGTH} karakter.`
  else if (otherLabels.some((l) => foldTurkish(l.trim()) === foldTurkish(label))) errors.label = 'Bu adda bir kategori zaten var.'

  if (!TYPES.includes(input.type as CategoryType)) errors.type = 'Bir tür seç.'

  const color = input.color.trim().toUpperCase()
  if (!isHexColor(color)) errors.color = 'Renk #RRGGBB biçiminde olmalı.'
  else {
    const check = checkCategoryColor(color)
    if (!check.ok) {
      errors.color =
        `Bu renk ${check.light < MIN_GRAPHIC_CONTRAST ? 'açık' : 'koyu'} temada zeminden yeterince ayrışmıyor ` +
        `(kontrast ${Math.min(check.light, check.dark).toFixed(1).replace('.', ',')}:1, en az 3:1 gerekli).`
    }
  }

  const keywords = parseKeywords(input.keywords)
  if (keywords.length > MAX_KEYWORDS) errors.keywords = `En fazla ${MAX_KEYWORDS} anahtar kelime.`
  else if (keywords.some((k) => k.length > MAX_KEYWORD_LENGTH)) errors.keywords = `Her anahtar kelime en fazla ${MAX_KEYWORD_LENGTH} karakter.`

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { label, type: input.type as CategoryType, color, keywords } }
}
