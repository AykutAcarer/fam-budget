/** Dashboard: toplam borç satırı (src/lib/debts.ts'teki aynı hesapla). */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { debtTotals, type DebtTotals } from '../../lib/debts'
import { loadDebts } from '../../lib/debtsApi'
import { formatEur } from '../../lib/format'
import { Card } from '../ui'

export function DebtSummaryCard() {
  const [totals, setTotals] = useState<DebtTotals | null>(null)

  useEffect(() => {
    loadDebts()
      .then((d) => setTotals(debtTotals(d)))
      .catch(() => setTotals(null)) // Özet kartı; hata olursa sessizce gizlenir.
  }, [])

  if (!totals || totals.total === 0) return null
  return (
    <Link to="/borclar" className="block rounded-2xl focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:outline-none">
      <Card className="flex items-center justify-between gap-3 p-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/70">
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Toplam borç</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums">{formatEur(totals.total)}</p>
          {totals.interest > 0 && (
            <p className="mt-0.5 text-xs text-red-700 tabular-nums dark:text-red-300">Faizli {formatEur(totals.interest)}</p>
          )}
        </div>
        <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">Borçlar →</span>
      </Card>
    </Link>
  )
}
