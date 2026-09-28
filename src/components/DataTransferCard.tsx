/**
 * Ayarlar > Veri: JSON içe aktar / dışa aktar (yedek).
 */
import { useRef, useState, type ChangeEvent } from 'react'
import { ImportValidationError } from '../lib/transfer'
import { downloadBudgetExport, importBudgetFile, type ImportSummary } from '../lib/transferApi'
import { Card, CardTitle } from './ui'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; text: string }
  | { kind: 'done'; summary: ImportSummary; warnings: string[] }
  | { kind: 'exported' }
  | { kind: 'error'; text: string }

const buttonClass =
  'flex-1 rounded-xl px-4 py-3 text-sm font-semibold shadow-sm ring-1 transition-colors disabled:opacity-60'

export function DataTransferCard({ onImported }: { onImported?: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const busy = status.kind === 'busy'

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // aynı dosya tekrar seçilebilsin
    if (!file) return

    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      setStatus({ kind: 'error', text: 'Dosya geçerli bir JSON değil.' })
      return
    }
    const ok = window.confirm(
      'Dosyadaki döngüler hesabına yazılacak. Aynı döngü zaten varsa o döngünün gelir, sabit gider ve harcamaları dosyadakilerle değiştirilecek. Devam edilsin mi?',
    )
    if (!ok) return

    setStatus({ kind: 'busy', text: 'İçe aktarılıyor…' })
    try {
      const { summary, warnings } = await importBudgetFile(raw)
      setStatus({ kind: 'done', summary, warnings })
      onImported?.()
    } catch (err) {
      const text =
        err instanceof ImportValidationError ? err.message : `İçe aktarılamadı: ${err instanceof Error ? err.message : String(err)}`
      setStatus({ kind: 'error', text })
    }
  }

  async function onExport() {
    setStatus({ kind: 'busy', text: 'Yedek hazırlanıyor…' })
    try {
      await downloadBudgetExport()
      setStatus({ kind: 'exported' })
    } catch (err) {
      setStatus({ kind: 'error', text: `Dışa aktarılamadı: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return (
    <Card>
      <CardTitle>Veri</CardTitle>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Eski verilerini JSON dosyasından içe aktar ya da tüm verini yedek olarak indir.
      </p>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className={`${buttonClass} bg-emerald-600 text-white ring-emerald-700/20 hover:bg-emerald-700`}
        >
          Veriyi içe aktar
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onExport}
          className={`${buttonClass} bg-white text-slate-800 ring-slate-900/10 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-slate-700`}
        >
          Dışa aktar
        </button>
        <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
      </div>

      <div aria-live="polite">
        {status.kind === 'busy' && <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{status.text}</p>}
        {status.kind === 'exported' && (
          <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">Yedek dosyası indirildi.</p>
        )}
        {status.kind === 'error' && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm whitespace-pre-line text-red-700 dark:bg-red-950/50 dark:text-red-300">
            {status.text}
          </p>
        )}
        {status.kind === 'done' && (
          <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200">
            <p className="font-semibold">İçe aktarma tamam 🎉</p>
            <p className="mt-0.5">
              {status.summary.cycles} döngü · {status.summary.variable} harcama · {status.summary.fixed} sabit gider ·{' '}
              {status.summary.income} gelir · {status.summary.debts} borç
              {status.summary.categories > 0 && ` · ${status.summary.categories} yeni kategori`}
            </p>
            {status.warnings.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer">{status.warnings.length} kayıt düzeltildi</summary>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {status.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
