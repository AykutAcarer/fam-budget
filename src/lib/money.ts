/**
 * Para aritmetiği. Kayan nokta hatalarını (0.1 + 0.2) önlemek için toplamlar
 * sent cinsinden tam sayılarla yapılır; dışarıya euro (2 haneli) döner.
 */

export const toCents = (euros: number): number => Math.round(euros * 100)

export const fromCents = (cents: number): number => cents / 100

/** 2 ondalık haneye yuvarlar: 3.456 → 3.46 */
export const roundMoney = (euros: number): number => fromCents(toCents(euros))

/** Tutarları sent hassasiyetiyle toplar. */
export function sumMoney(amounts: Iterable<number>): number {
  let cents = 0
  for (const a of amounts) cents += toCents(a)
  return fromCents(cents)
}
