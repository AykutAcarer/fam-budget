/**
 * Döngü (cycle) mantığı — maaş gününe bağlı.
 *
 * Döngü takvim ayı DEĞİLDİR: her ayın 15'inde başlar, ertesi ayın 14'ünde
 * biter (ör. 15 Eyl – 14 Eki). Döngü günü 1 = 15'i, 2 = 16'sı, ...
 *
 * Tüm tarihler 'YYYY-MM-DD' dizgisi olarak ele alınır (saat dilimi yok);
 * böylece gün hesapları DST veya UTC kaymasından etkilenmez.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'

/** Maaş günü: döngünün başladığı ayın günü. */
export const PAYDAY = 15

const ISO = 'YYYY-MM-DD'

export interface CycleWindow {
  /** Kullanıcı içinde tekil kimlik, başlangıç ayı: '2026-09'. */
  key: string
  label: string
  start: string
  end: string
}

/** Bir tarihin içinde bulunduğu döngünün sınırları. */
export function cycleWindowFor(date: string): CycleWindow {
  const d = dayjs(date)
  const startMonth = d.date() >= PAYDAY ? d.startOf('month') : d.subtract(1, 'month').startOf('month')
  const start = startMonth.date(PAYDAY)
  const end = start.add(1, 'month').subtract(1, 'day')
  return {
    key: start.format('YYYY-MM'),
    label: cycleLabel(start.format(ISO), end.format(ISO)),
    start: start.format(ISO),
    end: end.format(ISO),
  }
}

/** '15 Eyl – 14 Eki 2026' biçiminde etiket. */
export function cycleLabel(start: string, end: string): string {
  const s = dayjs(start).locale('tr')
  const e = dayjs(end).locale('tr')
  const startFmt = s.year() === e.year() ? 'D MMM' : 'D MMM YYYY'
  return `${s.format(startFmt)} – ${e.format('D MMM YYYY')}`
}

/**
 * Döngü günü indeksi (1'den başlar). Kıyaslar hep bu indekse göre yapılır:
 * bu döngünün 5. günü, baz ayın 5. günüyle karşılaştırılır.
 */
export function cycleDay(cycleStart: string, date: string): number {
  return dayjs(date).diff(dayjs(cycleStart), 'day') + 1
}

/** Döngünün toplam gün sayısı (ay uzunluğuna göre 28–31). */
export function cycleLength(start: string, end: string): number {
  return cycleDay(start, end)
}

/** Bugünün tarihi, yerel saatle 'YYYY-MM-DD'. */
export function todayIso(): string {
  return dayjs().format(ISO)
}

/** İki etiket yalnızca noktalama/boşlukta mı farklı? ("15 Eyl - 14 Eki" ≈ "15 Eyl – 14 Eki") */
export function sameLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]/gu, '')
  return norm(a) === norm(b)
}
