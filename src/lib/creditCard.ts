/**
 * Kredi kartı borç takibi — saf fonksiyonlar (yan etkisiz, testli).
 *
 * Döngü başına:
 *  - dönem başı borç: cycles.cc_opening_balance (devirle gelir; kullanıcı elle düzeltebilir)
 *  - bu dönem ödenen: bu döngüdeki "kredi karti" kategorisindeki harcamaların toplamı
 *  - kalan borç: dönem başı − ödenen (sent hassasiyetinde)
 * Devirde yeni döngünün dönem başı borcu = önceki döngünün kalanı (0'ın altına inmez);
 * aynı kural veritabanında roll_forward_cycle'dadır.
 */
import { fromCents, toCents } from './money'

export interface CreditCardStatus {
  /** Dönem başı borç. */
  opening: number
  /** Bu dönem karta yapılan ödemeler. */
  paid: number
  /** Kalan borç = dönem başı − ödenen; fazla ödemede 0. */
  remaining: number
  /** Ödenen dönem başı borcu aştıysa aşan kısım (ör. yeni harcamalar elle eklenmemişse). */
  overpaid: number
}

export function creditCardStatus(opening: number, paid: number): CreditCardStatus {
  const diff = toCents(opening) - toCents(paid)
  return {
    opening: fromCents(toCents(opening)),
    paid: fromCents(toCents(paid)),
    remaining: fromCents(Math.max(0, diff)),
    overpaid: fromCents(Math.max(0, -diff)),
  }
}

/** Devirde yeni döngünün dönem başı borcu (SQL roll_forward_cycle ile aynı). */
export function nextOpeningBalance(opening: number, paid: number): number {
  return creditCardStatus(opening, paid).remaining
}
