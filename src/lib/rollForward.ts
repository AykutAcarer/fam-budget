/**
 * Döngü devri — saf karar fonksiyonları. Kopyalama kuralları veritabanında
 * (roll_forward_cycle, tek işlem); burada yalnızca "hangi döngüden kaç kez
 * devretmeli" kararı verilir.
 */
import dayjs from 'dayjs'
import { cycleLabel, type CycleWindow } from './cycle'

/** Güvenlik sınırı: bir açılışta en fazla bu kadar döngü üretilir (3 yıl). */
export const MAX_ROLLS = 36

export interface CycleSpan {
  id: string
  start_date: string
  end_date: string
}

/** Bir döngünün hemen ardından gelen döngü (başlangıç = bitiş + 1 gün, 1 ay). SQL'deki roll_forward_cycle ile aynı. */
export function nextCycleWindow(end: string): CycleWindow {
  const start = dayjs(end).add(1, 'day')
  const next = start.add(1, 'month').subtract(1, 'day')
  const s = start.format('YYYY-MM-DD')
  const e = next.format('YYYY-MM-DD')
  return { key: start.format('YYYY-MM'), label: cycleLabel(s, e), start: s, end: e }
}

/**
 * Devir gerekiyorsa kaynak döngüyü (en yeni döngü) döner; gerekmiyorsa null:
 * - hiç döngü yoksa (yeni kullanıcı),
 * - tarihi kapsayan bir döngü zaten varsa,
 * - tarih en yeni döngünün bitişinden sonra değilse.
 */
export function rollForwardSource<T extends CycleSpan>(cycles: readonly T[], date: string): T | null {
  if (cycles.some((c) => c.start_date <= date && date <= c.end_date)) return null
  const latest = [...cycles].sort((a, b) => b.start_date.localeCompare(a.start_date))[0]
  return latest && date > latest.end_date ? latest : null
}

/** En yeni döngünün bitişinden tarihe ulaşmak için kaç devir gerekir (en az 1). */
export function rollsNeeded(latestEnd: string, date: string): number {
  let n = 0
  let end = latestEnd
  while (end < date && n < MAX_ROLLS) {
    end = nextCycleWindow(end).end
    n++
  }
  return n
}
