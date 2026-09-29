/**
 * Kategori renkleri — uygulamadaki tüm kullanımlar (donut, tablo noktaları,
 * rozetler) buradan geçer. Kaynak: kullanıcının kategori rengi (veritabanı),
 * yoksa varsayılan palet (supabase/functions/_shared/categories.ts), o da
 * yoksa nötr gri.
 *
 * Rozet tonları renkten hesaplanır: metin aynı rengin koyu (açık temada) ya da
 * açık (koyu temada) tonudur ve kendi zeminiyle WCAG AA (≥ 4.5:1) kontrast sağlar.
 */
import {
  DEFAULT_CATEGORIES,
  DONUT_ORDER,
  NEUTRAL_CATEGORY_COLOR,
} from '../../supabase/functions/_shared/categories'

// ---------------------------------------------------------------------------
// Renk kaynağı
// ---------------------------------------------------------------------------

const DEFAULT_COLORS = new Map(DEFAULT_CATEGORIES.map((c) => [c.key, c.color]))

export type ColorLookup = (key: string) => string

/** Kullanıcının kategorilerinden renk bulucu; eksikse varsayılan palet, o da yoksa nötr. */
export function createColorLookup(categories: readonly { key: string; color: string }[] = []): ColorLookup {
  const own = new Map(categories.map((c) => [c.key, c.color]))
  return (key) => own.get(key) ?? DEFAULT_COLORS.get(key) ?? NEUTRAL_CATEGORY_COLOR
}

/** Donut dilimlerini sabit halka sırasına dizer (bilinmeyenler sona, kendi sıralarıyla). */
export function sortForDonut<T extends { key: string }>(items: readonly T[]): T[] {
  const rank = (k: string) => {
    const i = DONUT_ORDER.indexOf(k)
    return i === -1 ? DONUT_ORDER.length : i
  }
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item.key) - rank(b.item.key) || a.i - b.i)
    .map((x) => x.item)
}

// ---------------------------------------------------------------------------
// Renk matematiği (sRGB ↔ OKLab/OKLCH, WCAG kontrast)
// ---------------------------------------------------------------------------

const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lin2s = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function hexToLin(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => s2lin(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number]
}

/** WCAG göreli parlaklık kontrastı. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = hexToLin(hex)
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** OKLCH: [L, C, H (radyan)]. */
export function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = hexToLin(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [L, Math.hypot(A, B), Math.atan2(B, A)]
}

function oklchToLin(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos(H)
  const b = C * Math.sin(H)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** OKLCH → hex; gamut dışındaysa ton ve açıklık korunarak doygunluk azaltılır. */
export function fromOklch(L: number, C: number, H: number): string {
  let c = C
  let rgb = oklchToLin(L, c, H)
  while (rgb.some((v) => v < 0 || v > 1) && c > 0) {
    c = Math.max(0, c - 0.005)
    rgb = oklchToLin(L, c, H)
  }
  return (
    '#' +
    rgb
      .map((v) => Math.round(lin2s(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  )
}

// ---------------------------------------------------------------------------
// Rozet tonları
// ---------------------------------------------------------------------------

export interface BadgeTones {
  /** Açık tema: soluk zemin + aynı rengin koyu tonu. */
  light: { bg: string; fg: string }
  /** Koyu tema: koyu zemin + aynı rengin açık tonu. */
  dark: { bg: string; fg: string }
}

const MIN_TEXT_CONTRAST = 4.6 // WCAG AA 4.5:1 + küçük pay

const tonesCache = new Map<string, BadgeTones>()

/** Bir kategori renginden rozet zemin/metin tonlarını üretir (deterministik, önbellekli). */
export function badgeTones(color: string): BadgeTones {
  const cached = tonesCache.get(color)
  if (cached) return cached
  const [L0, C0, H] = toOklch(color)

  // Metin her zaman rengin belirgin biçimde koyu (açık temada) / açık (koyu temada)
  // bir tonundan başlar; yeterli kontrasta ulaşana kadar koyulaşır/açılır.
  const lightBg = fromOklch(0.96, Math.min(C0 * 0.25, 0.035), H)
  let L = Math.min(L0 - 0.08, 0.5)
  let lightFg = fromOklch(L, Math.min(C0, 0.16), H)
  while (L > 0 && contrastRatio(lightFg, lightBg) < MIN_TEXT_CONTRAST) lightFg = fromOklch((L -= 0.01), Math.min(C0, 0.16), H)

  const darkBg = fromOklch(0.3, Math.min(C0 * 0.4, 0.06), H)
  L = Math.max(L0 + 0.1, 0.78)
  let darkFg = fromOklch(L, Math.min(C0, 0.14), H)
  while (L < 1 && contrastRatio(darkFg, darkBg) < MIN_TEXT_CONTRAST) darkFg = fromOklch((L += 0.01), Math.min(C0, 0.14), H)

  const tones = { light: { bg: lightBg, fg: lightFg }, dark: { bg: darkBg, fg: darkFg } }
  tonesCache.set(color, tones)
  return tones
}
