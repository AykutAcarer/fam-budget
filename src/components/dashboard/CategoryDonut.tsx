/**
 * Kategori dağılımı donut'u (Recharts). Tembel yüklenir; kimlik yalnızca renge
 * bırakılmaz — yanında adlı ve tutarlı tablo vardır (CategoryCard).
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { CategorySlice } from '../../lib/budget'
import { sortForDonut } from '../../lib/categoryColors'
import { formatEur, formatShare } from '../../lib/format'
import { CategoryBadge } from '../CategoryBadge'

function SliceTooltip({ active, payload }: { active?: boolean; payload?: readonly { payload?: unknown }[] }) {
  const slice = active ? (payload?.[0]?.payload as CategorySlice | undefined) : undefined
  if (!slice) return null
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
      <CategoryBadge color={slice.color}>{slice.label}</CategoryBadge>
      <p className="mt-1 text-slate-600 tabular-nums dark:text-slate-300">
        {formatEur(slice.amount)} · {formatShare(slice.share)}
      </p>
    </div>
  )
}

export default function CategoryDonut({ slices, total }: { slices: CategorySlice[]; total: number }) {
  // Sabit halka sırası: komşu dilim renkleri doğrulanmış çiftlerdir (bkz. _shared/categories.ts).
  const ordered = sortForDonut(slices)
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={ordered}
            dataKey="amount"
            nameKey="label"
            innerRadius="62%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            isAnimationActive={false}
            className="donut"
          >
            {ordered.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
          <Tooltip content={SliceTooltip} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-slate-500 dark:text-slate-400">Toplam</span>
        <span className="text-lg font-semibold">{formatEur(total)}</span>
      </div>
    </div>
  )
}
