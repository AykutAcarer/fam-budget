/** KPI kartları: gelir, sabit gider, değişken harcama. (Kredi kartı: CreditCardCard.) */
import type { CycleSummary } from '../../lib/budget'
import { formatEur } from '../../lib/format'
import { Card } from '../ui'

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">{sub}</p>
    </Card>
  )
}

export function KpiGrid({ summary }: { summary: CycleSummary }) {
  const { income, fixed, variable } = summary
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Toplam gelir" value={formatEur(income.total)} sub={`Alınan ${formatEur(income.received)} · Beklenen ${formatEur(income.expected)}`} />
      <Tile label="Sabit gider" value={formatEur(fixed.total)} sub={`Ödenen ${formatEur(fixed.paid)} · Kalan ${formatEur(fixed.remaining)}`} />
      <div className="col-span-2">
        <Tile label="Değişken harcama" value={formatEur(variable)} sub="Bu döngü, bugüne kadar (kredi kartı ödemeleri dahil)" />
      </div>
    </div>
  )
}
