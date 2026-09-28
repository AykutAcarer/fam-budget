/**
 * Sohbet metinleri — saf fonksiyonlar.
 *
 * - summaryText: yapay zeka kullanılamadığında gösterilen sade, KODLA üretilmiş özet.
 * - replyIsGrounded: yapay zekanın cevabındaki her sayının, kodun verdiği
 *   rakamlardan biri olduğunu doğrular (yapay zeka rakam uyduramaz).
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import type { Comparison } from './compare'
import type { RepeatInfo } from './repeat'
import { formatEur } from './format'

export interface SavedItem {
  amount: number
  category: string
  date: string
  description: string
}

export interface SummaryOptions {
  today: string
  labels: ReadonlyMap<string, string>
  /** Çevrimdışı kuyruğa alındı mı? */
  queued?: boolean
  /** Yedek parser kategoriyi tanıyamadı mı? */
  unmatched?: boolean
}

/** "Halı saha 8,25 € kaydedildi. Kısılabilir harcamalarda baz ayın 12,40 € altındasın 🎯" */
export function summaryText(items: readonly SavedItem[], comparison: Comparison | null, opts: SummaryOptions): string {
  const parts: string[] = []
  const what = items
    .map((i) => {
      const label = opts.labels.get(i.category) ?? i.category
      const when = i.date === opts.today ? '' : ` (${dayjs(i.date).locale('tr').format('D MMM')})`
      return `${label} ${formatEur(i.amount)}${when}`
    })
    .join(', ')
  parts.push(`${what} kaydedildi.`)

  if (opts.unmatched) parts.push('Kategoriyi tanıyamadım, “Sosyal / diğer” olarak yazdım; yanlışsa geri alabilirsin.')
  if (opts.queued) parts.push('Şu an bağlantı yok; internet gelince otomatik gönderilecek.')

  if (comparison) parts.push(comparisonSentence(comparison))
  return parts.join(' ')
}

/** Kıyas cümlesi (yalnızca verilen rakamlarla). */
export function comparisonSentence(c: Comparison): string {
  if (c.fark < 0) return `Kısılabilir harcamalarda baz ayın ${formatEur(-c.fark)} altındasın 🎯`
  if (c.fark > 0) return `Kısılabilir harcamalarda baz ayın ${formatEur(c.fark)} üstündesin; ayın geri kalanında biraz dikkat 💪`
  return 'Kısılabilir harcamalarda baz ayla başa baş gidiyorsun.'
}

/** Metindeki sayıları çıkarır (Türkçe biçim: "1.250,50", "8,25", "14."). */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    let s = m[0]
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
    const n = Number(s)
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * Yapay zeka cevabındaki her sayı izin verilen rakamlardan biri mi?
 * İzinli: kaydedilen tutarlar, kıyas rakamları (farkın mutlak değeri dahil),
 * döngü günü, tekrar bilgisi (gün sayısı, pencere, kategori toplamı) ve 0–10
 * arası küçük tam sayılar ("2 kez" gibi).
 */
export function replyIsGrounded(
  reply: string,
  items: readonly SavedItem[],
  comparison: Comparison | null,
  repeat: RepeatInfo | null = null,
): boolean {
  const allowed: number[] = items.map((i) => i.amount)
  if (repeat) allowed.push(repeat.gunSayisi, repeat.pencereGun, repeat.kategoriToplam)
  if (comparison) {
    allowed.push(comparison.cycleDay, comparison.dortluBuAy, comparison.dortluBazAy, comparison.fark, Math.abs(comparison.fark))
    if (comparison.kategori) allowed.push(comparison.kategori.buAy, comparison.kategori.bazAyTumAy)
  }
  return numbersIn(reply).every(
    (n) => (Number.isInteger(n) && n <= 10) || allowed.some((a) => Math.abs(a - n) < 0.005),
  )
}
