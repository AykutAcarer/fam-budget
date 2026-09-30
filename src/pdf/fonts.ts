/**
 * PDF fontu: Roboto (normal, kalın, italik) — Türkçe ğ, ş, ı, İ için Unicode TTF.
 * react-pdf'in varsayılan Helvetica'sı bu harfleri bozar.
 *
 * Dosyalar repoda (src/pdf/fonts, SIL OFL 1.1 — OFL.txt) ve `?inline` ile
 * data URL olarak pakete gömülür: çalışma anında hiçbir ağ isteği yapılmaz,
 * PDF çevrimdışı da üretilir. Bu modül yalnız PDF üretilirken (tembel) yüklenir.
 */
import { Font } from '@react-pdf/renderer'
import bold from './fonts/Roboto-Bold.ttf?inline'
import italic from './fonts/Roboto-Italic.ttf?inline'
import regular from './fonts/Roboto-Regular.ttf?inline'

export const PDF_FONT = 'Roboto'

let registered = false

export function registerPdfFonts(): void {
  if (registered) return
  Font.register({
    family: PDF_FONT,
    fonts: [
      { src: regular, fontWeight: 400 },
      { src: bold, fontWeight: 700 },
      { src: italic, fontWeight: 400, fontStyle: 'italic' },
    ],
  })
  // Türkçe kelimeler İngilizce kurallarla bölünmesin.
  Font.registerHyphenationCallback((word) => [word])
  registered = true
}
