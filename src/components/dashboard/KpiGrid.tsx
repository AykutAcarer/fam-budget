/** KPI kartları: gelir, sabit gider, değişken harcama, kredi kartı ödemesi. */
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
  const { income, fixed, variable, creditCard } = summary
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Toplam gelir" value={formatEur(income.total)} sub={`Alınan ${formatEur(income.received)}`} />
      <Tile label="Sabit gider" value={formatEur(fixed.total)} sub={`Ödenen ${formatEur(fixed.paid)} · Kalan ${formatEur(fixed.remaining)}`} />
      <Tile label="Değişken harcama" value={formatEur(variable)} sub="Bu döngü, bugüne kadar" />
      <Tile label="Kredi kartı ödemesi" value={formatEur(creditCard)} sub="Değişken harcamanın içinde" />
    </div>
  )
}
