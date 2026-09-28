/**
 * Kategori özeti: bu döngü vs baz ay (tüm ay). Kısılabilir dörtlü ayrı grup +
 * ara toplam. Fark ok + işaret + metinle (yalnız renge dayanmaz).
 * Rakamlar compare.ts'teki categoryBreakdown'dan.
 */
import type { CategoryBreakdown, CategoryBreakdownRow } from '../../lib/compare'
import type { ColorLookup } from '../../lib/categoryColors'
import { formatEur, formatSignedEur } from '../../lib/format'
import { CategoryDot } from '../CategoryBadge'

const TYPE_LABEL: Record<string, string> = { zorunlu: 'zorunlu', kisilabilir: 'kısılabilir', yari: 'yarı', borc: 'borç' }

function Diff({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-slate-400 dark:text-slate-500">—</span>
  if (diff === 0) return <span className="text-slate-500 dark:text-slate-400">= aynı</span>
  const up = diff > 0
  return (
    <span className={`whitespace-nowrap ${up ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-400'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'} </span>
      <span className="sr-only">{up ? 'arttı' : 'azaldı'} </span>
      {formatSignedEur(diff)}
    </span>
  )
}

/** Bu döngü tutarı; altında baz ay (tüm ay). Dar ekranda 3 sütuna sığsın diye tek hücrede. */
function Amounts({ current, baseline, strong = false }: { current: number; baseline: number | null; strong?: boolean }) {
  return (
    <td className="py-2 text-right tabular-nums">
      <span className={`block ${strong ? 'font-semibold' : 'font-medium'}`}>{formatEur(current)}</span>
      {baseline !== null && (
        <span className="block text-[11px] text-slate-500 dark:text-slate-400">
          <span className="sr-only">baz ay </span>baz {formatEur(baseline)}
        </span>
      )}
    </td>
  )
}

function Row({ row, colorOf }: { row: CategoryBreakdownRow; colorOf: ColorLookup }) {
  return (
    <tr className="border-t border-slate-100 dark:border-slate-800">
      <th scope="row" className="py-2 pr-2 text-left font-normal">
        <span className="flex items-center gap-2">
          <CategoryDot color={colorOf(row.key)} />
          <span className="min-w-0">
            <span className="block truncate">{row.label}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{TYPE_LABEL[row.type] ?? row.type}</span>
          </span>
        </span>
      </th>
      <Amounts current={row.current} baseline={row.baseline} />
      <td className="py-2 pl-2 text-right text-xs tabular-nums">
        <Diff diff={row.diff} />
      </td>
    </tr>
  )
}

export function CategorySummaryTable({ breakdown, colorOf }: { breakdown: CategoryBreakdown; colorOf: ColorLookup }) {
  const { dortlu, others, dortluTotal } = breakdown
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Kategori özeti: bu döngü, baz ay (tüm ay) ve fark</caption>
      <thead>
        <tr className="text-xs text-slate-500 dark:text-slate-400">
          <th scope="col" className="pb-1 text-left font-medium">Kategori</th>
          <th scope="col" className="pb-1 text-right font-medium">Bu döngü · baz</th>
          <th scope="col" className="pb-1 pl-2 text-right font-medium">Fark</th>
        </tr>
      </thead>
      {dortlu.length > 0 && (
        <tbody className="bg-emerald-50/60 dark:bg-emerald-950/20">
          <tr>
            <th colSpan={3} scope="rowgroup" className="px-1 pt-2 pb-1 text-left text-xs font-semibold text-emerald-800 dark:text-emerald-300">
              Kısılabilir dörtlü
            </th>
          </tr>
          {dortlu.map((r) => (
            <Row key={r.key} row={r} colorOf={colorOf} />
          ))}
          <tr className="border-t border-emerald-200 font-semibold dark:border-emerald-900">
            <th scope="row" className="py-2 text-left">Dörtlü toplam</th>
            <Amounts current={dortluTotal.current} baseline={dortluTotal.baseline} strong />
            <td className="py-2 pl-2 text-right text-xs tabular-nums">
              <Diff diff={dortluTotal.diff} />
            </td>
          </tr>
        </tbody>
      )}
      {others.length > 0 && (
        <tbody>
          <tr>
            <th colSpan={3} scope="rowgroup" className="px-1 pt-3 pb-1 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
              Diğer kategoriler
            </th>
          </tr>
          {others.map((r) => (
            <Row key={r.key} row={r} colorOf={colorOf} />
          ))}
        </tbody>
      )}
    </table>
  )
}
