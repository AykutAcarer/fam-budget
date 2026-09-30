/** KPI kartları: gelir, sabit gider, değişken harcama, nakit akışı. (Kredi kartı: CreditCardCard.) */
import type { CycleSummary } from '../../lib/budget'
import { formatEur, formatSignedEur } from '../../lib/format'
import { Card } from '../ui'

function Tile({ label, value, sub, tone = '' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500 tabular-nums dark:text-slate-400">{sub}</p>
    </Card>
  )
}

export function KpiGrid({ summary }: { summary: CycleSummary }) {
  const { income, fixed, variable, cashFlow } = summary
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Toplam gelir" value={formatEur(income.total)} sub={`Alınan ${formatEur(income.received)} · Beklenen ${formatEur(income.expected)}`} />
      <Tile label="Sabit gider" value={formatEur(fixed.total)} sub={`Ödenen ${formatEur(fixed.paid)} · Kalan ${formatEur(fixed.remaining)}`} />
      <Tile label="Değişken harcama" value={formatEur(variable)} sub="Bugüne kadar, kredi kartı dahil" />
      <Tile
        label="Nakit akışı"
        value={formatSignedEur(cashFlow)}
        sub="Gelir − sabit − değişken"
        tone={cashFlow < 0 ? 'text-rose-700 dark:text-rose-300' : cashFlow > 0 ? 'text-emerald-700 dark:text-emerald-300' : ''}
      />
    </div>
  )
}
