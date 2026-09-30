/**
 * PDF üretimi ve indirme — tamamen istemcide, çevrimdışı çalışır (font gömülü,
 * ağ isteği yok). Ana ekran bu modülü tembel yükler (react-pdf büyük).
 */
import { pdf } from '@react-pdf/renderer'
import type { BudgetReport } from '../lib/report'
import { reportFileName } from '../lib/report'
import { BudgetReportDocument } from './BudgetReportDocument'
import { registerPdfFonts } from './fonts'

export async function renderReportBlob(report: BudgetReport): Promise<Blob> {
  registerPdfFonts()
  return pdf(<BudgetReportDocument report={report} />).toBlob()
}

/** Blob'u dosya olarak indirir (tarayıcı yazdırma diyaloğu kullanılmaz). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // İndirme başlasın diye biraz bekleyip URL'yi bırak.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function exportReportPdf(report: BudgetReport): Promise<void> {
  const blob = await renderReportBlob(report)
  downloadBlob(blob, reportFileName(report))
}
