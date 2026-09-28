/**
 * Gün gün kümülatif kısılabilir dörtlü (Recharts, tembel yüklenir).
 * "Bu döngü" düz + kalın, "Baz ay" gri + kesikli: çizgiler yalnız renkle ayrılmaz.
 * Değerler compare.ts'teki dailyCumulativeSeries'ten gelir; burada hesap yok.
 */
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { DailyPoint } from '../../lib/compare'
import { formatEur } from '../../lib/format'
import { useIsDark } from '../../lib/useIsDark'
import { CHART_COLORS } from './chartColors'

const compact = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: readonly { payload?: unknown }[]; label?: number | string }) {
  const p = active ? (payload?.[0]?.payload as DailyPoint | undefined) : undefined
  if (!p) return null
  return (
    <div className="rounded-lg bg-white px-3 py-2 text-xs shadow-md ring-1 ring-slate-900/10 dark:bg-slate-800 dark:ring-white/10">
      <p className="font-semibold text-slate-900 dark:text-slate-100">{label}. gün</p>
      {p.current !== null && (
        <p className="mt-0.5 text-slate-700 tabular-nums dark:text-slate-200">Bu döngü: {formatEur(p.current)}</p>
      )}
      {p.baseline !== null && (
        <p className="mt-0.5 text-slate-600 tabular-nums dark:text-slate-300">Baz ay: {formatEur(p.baseline)}</p>
      )}
    </div>
  )
}

export default function CycleChart({ data, hasBaseline }: { data: DailyPoint[]; hasBaseline: boolean }) {
  const c = CHART_COLORS[useIsDark() ? 'dark' : 'light']
  const lastIndex = data.reduce((last, p, i) => (p.current !== null ? i : last), -1)
  const ticks = [1, 5, 10, 15, 20, 25, 30].filter((t) => t <= data.length)

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis
            dataKey="day"
            ticks={ticks}
            tick={{ fill: c.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={0}
          />
          <YAxis
            width={44}
            tick={{ fill: c.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${compact.format(v)} €`}
          />
          <Tooltip content={ChartTooltip} cursor={{ stroke: c.axis, strokeWidth: 1 }} />
          {hasBaseline && (
            <Line
              type="monotone"
              dataKey="baseline"
              name="Baz ay"
              stroke={c.baseline}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          )}
          <Line
            type="monotone"
            dataKey="current"
            name="Bu döngü"
            stroke={c.current}
            strokeWidth={2.5}
            connectNulls={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) =>
              props.index === lastIndex && props.cx !== undefined && props.cy !== undefined ? (
                <circle key="son" cx={props.cx} cy={props.cy} r={4.5} fill={c.current} stroke={c.surface} strokeWidth={2} />
              ) : (
                <g key={props.index} />
              )
            }
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
