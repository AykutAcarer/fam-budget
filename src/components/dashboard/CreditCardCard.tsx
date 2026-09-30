/**
 * Ana ekran: kredi kartı borç takibi — dönem başı borç, bu dönem ödenen,
 * kalan borç. Ödenen = bu döngüdeki "kredi karti" harcamaları (sohbetten
 * girilen ödemeler anında yansır); kalan kodla hesaplanır (creditCard.ts).
 * Dönem başı borç elle düzeltilebilir (yeni ekstre, faiz, karta gelen harcamalar).
 */
import { useState, type FormEvent } from 'react'
import { creditCardStatus } from '../../lib/creditCard'
import { parseBalance } from '../../lib/debts'
import { formatAmountInput, formatEur } from '../../lib/format'
import { Card, CardTitle, inputClass } from '../ui'

interface Props {
  /** Aktif döngünün dönem başı borcu; döngü henüz yoksa null. */
  opening: number | null
  /** Bu döngüde karta ödenen (bekleyenler dahil). */
  paid: number
  /** Salt okunur (çevrimdışı) ya da döngü yoksa düzenleme kapalı. */
  readOnly: boolean
  onSaveOpening: (amount: number) => Promise<void>
}

const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function CreditCardCard({ opening, paid, readOnly, onSaveOpening }: Props) {
  const status = creditCardStatus(opening ?? 0, paid)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function startEdit() {
    setValue(formatAmountInput(status.opening))
    setError(null)
    setEditing(true)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const amount = parseBalance(value)
    if (amount === null) {
      setError('Geçerli bir tutar gir (ör. 6.026,31).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSaveOpening(amount)
      setEditing(false)
    } catch (err) {
      setError(`Kaydedilemedi: ${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <CardTitle>Kredi kartı ödemesi</CardTitle>
        {!editing && opening !== null && (
          <button
            type="button"
            onClick={startEdit}
            disabled={readOnly}
            className="min-h-9 rounded-lg px-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
          >
            Düzenle
          </button>
        )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-slate-50 py-2.5 dark:bg-slate-800/60">
          <dt className="text-xs text-slate-500 dark:text-slate-400">Dönem başı borç</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums sm:text-lg">{formatEur(status.opening)}</dd>
        </div>
        <div className="rounded-xl bg-emerald-50 py-2.5 dark:bg-emerald-950/40">
          <dt className="text-xs text-emerald-800 dark:text-emerald-300">Bu dönem ödenen</dt>
          <dd className="mt-0.5 text-base font-semibold text-emerald-800 tabular-nums sm:text-lg dark:text-emerald-200">{formatEur(status.paid)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 py-2.5 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:ring-slate-700">
          <dt className="text-xs text-slate-500 dark:text-slate-400">Kalan borç</dt>
          <dd className="mt-0.5 text-base font-bold tabular-nums sm:text-lg">{formatEur(status.remaining)}</dd>
        </div>
      </dl>

      {status.overpaid > 0 && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
          Bu dönem dönem başı borçtan {formatEur(status.overpaid)} fazla ödendi. Ekstre geldiyse dönem başı borcu güncelle.
        </p>
      )}

      {editing ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-2" noValidate>
          <label className="block text-sm font-medium">
            Dönem başı borç (€)
            <input
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                setError(null)
              }}
              aria-invalid={!!error}
              aria-describedby={error ? 'cc-error' : 'cc-hint'}
              className={inputClass}
              autoFocus
            />
          </label>
          <p id="cc-hint" className="text-xs text-slate-500 dark:text-slate-400">
            Ekstre geldiğinde ya da karta yeni harcama / faiz eklendiğinde güncelle. Kalan borç buna göre yeniden hesaplanır.
          </p>
          {error && (
            <p id="cc-error" role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60">
              {busy ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Vazgeç
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {opening === null
            ? 'Bu döngü henüz başlamadı; ilk harcamayla birlikte oluşur.'
            : 'Karta yaptığın ödemeleri sohbette “kredi kartı 200 ödedim” gibi yaz; kalan borç kendiliğinden düşer.'}
        </p>
      )}
    </Card>
  )
}
