/** Para ve tarih biçimlendirme. Para birimi her yerde EUR. */

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/** 8.25 → '8,25 €' */
export function formatEur(amount: number): string {
  return eur.format(amount)
}

/** İşaretli tutar, gerçek eksi işaretiyle: −11,34 € / +5,00 € / 0,00 € */
export function formatSignedEur(amount: number): string {
  if (amount === 0) return formatEur(0)
  return `${amount < 0 ? '−' : '+'}${formatEur(Math.abs(amount))}`
}

const pct = new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: 0 })

/** 0.123 → '%12' */
export function formatShare(share: number): string {
  return pct.format(share)
}
