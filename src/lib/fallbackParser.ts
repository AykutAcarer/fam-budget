/**
 * Kural tabanlı yedek parser — internet yoksa veya yapay zeka yanıt vermezse
 * harcama KAYBOLMASIN diye.
 *
 * - Tutar: tarih ifadeleri çıkarıldıktan sonra metindeki ilk sayı. Türkçe
 *   ondalık virgül ("8,25" = 8.25); nokta binlik ayırıcıdır ("1.250" = 1250).
 * - Kategori: kullanıcının kategorilerindeki anahtar kelimeler (Ayarlar'dan
 *   düzenlenir; varsayılanlar _shared/categories.ts), kategori sırasıyla;
 *   hiçbiri tutmazsa "sosyal".
 * - Tarih: varsayılan bugün; "dün", "evvelsi gün", "25 eylülde", "25.09".
 */
import dayjs from 'dayjs'
import { clampIsoDate } from './date'
import { roundMoney } from './money'
import { DEFAULT_CATEGORIES } from '../../supabase/functions/_shared/categories'

export interface FallbackExpense {
  amount: number
  category: string
  date: string
  description: string
  /** Bir anahtar kelime eşleşti mi? false ise varsayılan "sosyal" kullanıldı. */
  matched: boolean
}

/** Küçük harfe çevirip Türkçe harfleri ASCII'ye katlar. Uzunluk korunur (indeksler eşleşir). */
export function foldTurkish(text: string): string {
  const lower = text.toLocaleLowerCase('tr-TR')
  const map: Record<string, string> = { ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' }
  const folded = lower.replace(/[ığüşöçâîû]/g, (ch) => map[ch])
  return folded.length === text.length ? folded : text.toLowerCase()
}

/** Yedek parser için kategori kuralı: kullanıcının kategorisi + anahtar kelimeleri. */
export interface CategoryRule {
  key: string
  keywords: readonly string[]
}

/** Varsayılan kurallar (tek kaynak: _shared/categories.ts); kullanıcı kategorileri yoksa. */
export const DEFAULT_RULES: readonly CategoryRule[] = DEFAULT_CATEGORIES

const FALLBACK_KEY = 'sosyal'

/**
 * Kullanıcı kategorilerinden kurallar. Anahtar kelime alanı hiç gelmemişse
 * (eski veri / migration öncesi) varsayılan kategorinin kelimeleri kullanılır;
 * boş liste ise kullanıcı bilinçli olarak boşaltmıştır.
 */
export function rulesFor(categories: readonly { key: string; keywords?: readonly string[] | null }[]): CategoryRule[] {
  return categories.map((c) => ({
    key: c.key,
    keywords: c.keywords ?? DEFAULT_CATEGORIES.find((d) => d.key === c.key)?.keywords ?? [],
  }))
}

/**
 * Anahtar kelime → düzenli ifade (katlanmış metin üzerinde). 4+ harfli kelimeler
 * kelime başında eşleşir ("market" → "marketten"); 3 ve daha kısa olanlar yalnız
 * tam kelime olarak ("et" "sepet"te eşleşmez; "iş" "isim"de eşleşmez).
 */
export function keywordPattern(keyword: string): RegExp | null {
  const k = foldTurkish(keyword.trim()).replace(/\s+/g, ' ')
  if (!k) return null
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // \b yalnız [A-Za-z0-9_] tanır; "c++" gibi kelimeler için harf/rakam sınırı kullanılır.
  const after = k.replace(/\s/g, '').length <= 3 ? '(?![\\p{L}\\p{N}])' : ''
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}${after}`, 'u')
}

const MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik']

interface Span {
  start: number
  end: number
}

/** Metindeki tarih ifadesini bulur; bulunan aralık tutar aranırken yok sayılır. */
function extractDate(folded: string, today: string): { date: string; span: Span | null } {
  const t = dayjs(today)
  const relative: [RegExp, number][] = [
    [/\b(evvelsi|evvelki|onceki) gun\w*/, -2],
    [/\bdun\w*/, -1],
    [/\bbugun\w*/, 0],
  ]
  for (const [re, offset] of relative) {
    const m = re.exec(folded)
    if (m) return { date: t.add(offset, 'day').format('YYYY-MM-DD'), span: { start: m.index, end: m.index + m[0].length } }
  }

  // "25 eylül", "25 eylülde", "3 ekim 2026"
  const named = new RegExp(`\\b(\\d{1,2})\\s*(${MONTHS.join('|')})[a-z]*(?:\\s+(\\d{4}))?`).exec(folded)
  if (named) {
    const day = Number(named[1])
    const month = MONTHS.indexOf(named[2]) + 1
    const date = resolveDate(day, month, named[3] ? Number(named[3]) : null, today)
    if (date) return { date, span: { start: named.index, end: named.index + named[0].length } }
  }

  // "25.09", "25/09", "25.09.2026" — tek başına bir sayıysa tutar olabilir,
  // o yüzden yalnızca metinde tutar olacak başka bir sayı kalıyorsa tarih sayılır.
  const numeric = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?\b/.exec(folded)
  if (numeric) {
    const [, d, m, y] = numeric
    const span = { start: numeric.index, end: numeric.index + numeric[0].length }
    const rest = folded.slice(0, span.start) + ' ' + folded.slice(span.end)
    const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null
    const date = resolveDate(Number(d), Number(m), year, today)
    if (date && (year !== null || /\d/.test(rest))) return { date, span }
  }

  return { date: today, span: null }
}

/** Gün/ay → ISO tarih. Yıl verilmezse bugünden sonraya düşmeyecek en yakın yıl seçilir. */
function resolveDate(day: number, month: number, year: number | null, today: string): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = year ?? Number(today.slice(0, 4))
  let date = clampIsoDate(`${y}-${pad(month)}-${pad(day)}`)
  if (year === null && date > today) date = clampIsoDate(`${y - 1}-${pad(month)}-${pad(day)}`)
  return date
}

/**
 * Türkçe tutar metnini sayıya çevirir.
 * "8,25" → 8.25 · "1.250" → 1250 · "1.250,50" → 1250.5 · "8.25" → 8.25
 */
export function parseTurkishAmount(raw: string): number | null {
  let s = raw
  const hasComma = s.includes(',')
  const hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // Son ayırıcı ondalıktır, diğerleri binlik.
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.'
    const thousandSep = decimalSep === ',' ? '.' : ','
    s = s.split(thousandSep).join('').replace(decimalSep, '.')
  } else if (hasComma) {
    // Türkçede virgül ondalıktır.
    const parts = s.split(',')
    s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
  } else if (hasDot) {
    const parts = s.split('.')
    const thousands = parts.slice(1).every((p) => p.length === 3)
    s = thousands ? parts.join('') : parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
  }
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? roundMoney(n) : null
}

/**
 * Kategoriyi anahtar kelimelerle bulur. Birden çok kategori eşleşirse listede
 * önce gelen kazanır (kategori sırası). Hiçbiri tutmazsa "sosyal" (yoksa ilk kategori).
 */
export function detectCategory(folded: string, rules: readonly CategoryRule[] = DEFAULT_RULES): { category: string; matched: boolean } {
  for (const rule of rules) {
    if (rule.keywords.some((kw) => keywordPattern(kw)?.test(folded))) return { category: rule.key, matched: true }
  }
  const fallback = rules.some((r) => r.key === FALLBACK_KEY) ? FALLBACK_KEY : (rules[0]?.key ?? FALLBACK_KEY)
  return { category: fallback, matched: false }
}

/**
 * Serbest Türkçe metinden tek bir harcama çıkarır. Tutar bulunamazsa null.
 * @param today 'YYYY-MM-DD' (tarih çözümü buna göre yapılır)
 * @param rules Kullanıcının kategorileri ve anahtar kelimeleri, kategori sırasıyla
 */
export function fallbackParse(text: string, today: string, rules: readonly CategoryRule[] = DEFAULT_RULES): FallbackExpense | null {
  const folded = foldTurkish(text)
  const { date, span: dateSpan } = extractDate(folded, today)

  // Tarih aralığını boşlukla maskeleyip ilk sayıyı ara (indeksler korunur).
  const masked = dateSpan
    ? folded.slice(0, dateSpan.start) + ' '.repeat(dateSpan.end - dateSpan.start) + folded.slice(dateSpan.end)
    : folded
  const num = /\d+(?:[.,]\d+)*/.exec(masked)
  if (!num) return null
  const amount = parseTurkishAmount(num[0])
  if (amount === null) return null

  const { category, matched } = detectCategory(folded, rules)

  // Açıklama: kullanıcının kendi ifadesi, tutar ve tarih çıkarılmış.
  const spans = [dateSpan, { start: num.index, end: num.index + num[0].length }].filter((s): s is Span => s !== null)
  let description = text
  for (const s of spans.sort((a, b) => b.start - a.start)) description = description.slice(0, s.start) + ' ' + description.slice(s.end)
  description = description
    .replace(/(€|\beuro?\b)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { amount, category, date, description, matched }
}
