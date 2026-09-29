/** Ödendi / alındı anahtarı (sabit gider ve gelir satırlarında ortak). */
import { CheckIcon } from '../icons'

export function PaidSwitch({
  checked,
  label,
  pending,
  onToggle,
}: {
  checked: boolean
  /** Ekran okuyucu etiketi, ör. "Kira: ödendi". */
  label: string
  pending: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      disabled={pending}
      className="flex min-h-11 min-w-11 items-center justify-center disabled:opacity-60"
    >
      <span
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-600'
        }`}
      >
        <span
          className={`inline-flex size-6 items-center justify-center rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5.5' : 'translate-x-0.5'
          }`}
        >
          {checked && <CheckIcon className="size-3.5 text-emerald-700" strokeWidth={3} />}
        </span>
      </span>
    </button>
  )
}

/** "tek seferlik" rozeti (devirde taşınmayan kalemler). */
export function OneOffBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      tek seferlik
    </span>
  )
}
