/** Kategori dağılımı kartı: donut + adlı/tutarlı tablo (tablo görünümü). */
import { lazy, Suspense } from 'react'
import type { CategorySlice } from '../../lib/budget'
import { formatEur, formatShare } from '../../lib/format'
import { CategoryDot } from '../CategoryBadge'
import { Card, CardTitle } from '../ui'

const CategoryDonut = lazy(() => import('./CategoryDonut'))

export function CategoryCard({ slices, total }: { slices: CategorySlice[]; total: number }) {
  return (
    <Card>
      <CardTitle>Kategori dağılımı</CardTitle>
      {slices.length === 0 ? (
        <div className="mt-3 flex h-40 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">
          Bu döngüde henüz harcama yok
        </div>
      ) : (
        <div className="mt-3 grid items-center gap-4 sm:grid-cols-2">
          <div role="img" aria-label={`Kategori dağılımı, toplam ${formatEur(total)}`}>
            <Suspense fallback={<div className="mx-auto aspect-square w-full max-w-[220px] rounded-full bg-slate-100 dark:bg-slate-800" />}>
              <CategoryDonut slices={slices} total={total} />
            </Suspense>
          </div>
          <table className="w-full text-sm">
            <caption className="sr-only">Bu döngüde kategoriye göre değişken harcamalar</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Kategori</th>
                <th scope="col">Tutar</th>
                <th scope="col">Pay</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((s) => (
                <tr key={s.key} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <CategoryDot color={s.color} />
                      <span className="truncate">{s.label}</span>
                    </span>
                  </th>
                  <td className="py-1.5 text-right font-medium tabular-nums">{formatEur(s.amount)}</td>
                  <td className="w-12 py-1.5 text-right text-xs text-slate-500 tabular-nums dark:text-slate-400">{formatShare(s.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
