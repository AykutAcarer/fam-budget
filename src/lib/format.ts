/** Para ve tarih biçimlendirme. Para birimi her yerde EUR. */

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })

/** 8.25 → '8,25 €' */
export function formatEur(amount: number): string {
  return eur.format(amount)
}
