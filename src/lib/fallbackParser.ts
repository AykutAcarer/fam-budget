/**
 * Kural tabanlı yedek parser — internet yoksa veya yapay zeka yanıt vermezse
 * harcama KAYBOLMASIN diye.
 *
 * - Tutar: tarih ifadeleri çıkarıldıktan sonra metindeki ilk sayı. Türkçe
 *   ondalık virgül ("8,25" = 8.25); nokta binlik ayırıcıdır ("1.250" = 1250).
 * - Kategori: app_system_prompt.md'deki kategori tanımlarıyla aynı anahtar
 *   kelimeler, öncelik sırasıyla; hiçbiri tutmazsa "sosyal".
 * - Tarih: varsayılan bugün; "dün", "evvelsi gün", "25 eylülde", "25.09".
 */
import dayjs from 'dayjs'
import { clampIsoDate } from './date'
import { roundMoney } from './money'

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

/**
 * Kategori kuralları — SIRA ÖNEMLİ: ilk eşleşen kazanır.
 * Ör. "hanım kahvaltı" → kahvalti (hanim'dan önce), "eşime döner" → sosyal
 * (dışarıda yemek; hanim yalnızca nakit içindir ve en sonda denenir).
 */
const CATEGORY_RULES: [key: string, patterns: RegExp[]][] = [
  ['kredi karti', [/\bkredi ?kart/, /\bkk\b/]],
  ['halisaha', [/\bhali ?saha/, /\bmac(a|ta|tan|i|in)?\b/, /\bsaha kira/]],
  ['yakit', [/\bbenzin/, /\bmazot/, /\bdizel/, /\bdepo/, /\byakit/]],
  ['mensemax', [/\bmens[ae]/, /\bokul yemeg/]],
  ['temizlik', [/\brossmann?/, /\bdm\b/, /\bdeterjan/, /\btemizlik/, /\bkisisel bakim/]],
  ['kahvalti', [/\bkahvalti/, /\bpogaca/, /\bsimit/, /\bborek/]],
  ['is', [/\biste\b/, /\bis\b/, /\bis ?yeri/, /\bogle/, /\batistirmalik/, /\bkahve\b/, /\bmola/]],
  ['mutfak', [/\bmarket/, /\bmutfak/, /\bet(ten|i|e)?\b/, /\bmanav/, /\bbakkal/, /\bkasap/]],
  ['sosyal', [/\bdoner/, /\bdondurma/, /\bsinema/, /\boyuncak/, /\bgiyim/, /\bgezme/, /\byemek/, /\brestoran/, /\bpizza/, /\bkafe/]],
  ['hanim', [/\besim(e|e para)?\b/, /\bhanim(a|im|ima)?\b/, /\bharclik/]],
]

const DEFAULT_CATEGORY = 'sosyal'

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

/** Kategoriyi anahtar kelimelerle bulur. */
export function detectCategory(folded: string, allowed?: ReadonlySet<string>): { category: string; matched: boolean } {
  for (const [key, patterns] of CATEGORY_RULES) {
    if (allowed && !allowed.has(key)) continue
    if (patterns.some((p) => p.test(folded))) return { category: key, matched: true }
  }
  return { category: DEFAULT_CATEGORY, matched: false }
}

/**
 * Serbest Türkçe metinden tek bir harcama çıkarır. Tutar bulunamazsa null.
 * @param today 'YYYY-MM-DD' (tarih çözümü buna göre yapılır)
 * @param categoryKeys Kullanıcının kategorileri (verilirse yalnızca bunlar seçilir)
 */
export function fallbackParse(text: string, today: string, categoryKeys?: Iterable<string>): FallbackExpense | null {
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

  const { category, matched } = detectCategory(folded, categoryKeys ? new Set(categoryKeys) : undefined)

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
