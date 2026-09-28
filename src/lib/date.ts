/**
 * Tarih yardımcıları.
 */

/**
 * 'YYYY-MM-DD' tarihini geçerli hale getirir: ayın gün sayısını aşan günleri
 * ayın son gününe sıkıştırır (ör. '2026-09-31' → '2026-09-30').
 * Aylık tekrarlanan ödemeler (her ayın 31'i) içe aktarılırken gerekir.
 * Biçimi bozuk girdide hata fırlatır.
 */
export function clampIsoDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) throw new Error(`Geçersiz tarih biçimi: "${value}" (YYYY-MM-DD bekleniyor)`)
  const [, y, mo, d] = m
  const month = Number(mo)
  if (month < 1 || month > 12) throw new Error(`Geçersiz ay: "${value}"`)
  const daysInMonth = new Date(Date.UTC(Number(y), month, 0)).getUTCDate()
  const day = Math.min(Math.max(Number(d), 1), daysInMonth)
  return `${y}-${mo}-${String(day).padStart(2, '0')}`
}
