/**
 * PDF raporu için veri — saf fonksiyon, YENİ HESAP YAPMAZ.
 *
 * Her sayı uygulamanın zaten kullandığı seçicilerden gelir (ana ekran, döngü,
 * sabitler, borçlar, kredi kartı ekranlarıyla birebir aynı):
 *   cycleSummary / buildComparison (budget.ts), cuttableLabels (categories.ts),
 *   creditCardStatus (creditCard.ts), sortDebts / debtTotals (debts.ts),
 *   groupFixed / installmentBadgeText / installmentEndDate (fixed.ts).
 * PDF bileşeni yalnızca bu yapıyı çizer.
 */
import dayjs from 'dayjs'
import 'dayjs/locale/tr'
import { buildComparison, cycleSummary, type BudgetData, type CategorySlice, type CycleSummary } from './budget'
import { cuttableLabels } from './categories'
import type { Comparison } from './compare'
import { clampedCycleDay } from './compare'
import { creditCardStatus, type CreditCardStatus } from './creditCard'
import { cycleLabel, cycleLength } from './cycle'
import type { DebtRow } from './database.types'
import { debtTotals, sortDebts } from './debts'
import { groupFixed, installmentBadgeText, installmentEndDate } from './fixed'
import type { ExpenseLike } from './compare'

export const REPORT_TITLE = 'Aile Bütçesi'
/** Borç verisi alınamadığında (çevrimdışı, önbellek yok) Borçlar bölümünde gösterilen not. */
export const DEBTS_UNAVAILABLE_NOTE = 'Borçlar çevrimdışı görüntülenemedi. Bağlantı gelince ya da Borçlar ekranı bir kez açıldıktan sonra rapora eklenir.'

/** PDF fontunda emoji yok (kutu çıkar): piktogramlar ve varyasyon seçicileri atılır. */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}‍︎️]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** "15 Eylül – 14 Ekim 2026" (yıl farklıysa iki tarafta da). */
export function longCycleLabel(start: string, end: string): string {
  const s = dayjs(start).locale('tr')
  const e = dayjs(end).locale('tr')
  return s.year() === e.year() ? `${s.format('D MMMM')} – ${e.format('D MMMM YYYY')}` : `${s.format('D MMMM YYYY')} – ${e.format('D MMMM YYYY')}`
}

export type ComparisonState = 'ok' | 'noCuttable' | 'noBaseline' | 'activeIsBaseline'

export interface ReportFixedRow {
  item: string
  amount: number
  date: string
  paid: boolean
}

export interface ReportInstallmentRow extends ReportFixedRow {
  /** Katman 12'deki düzeltilmiş gösterim (bu ay ödendiyse −1), emojisiz. */
  remaining: string
  /** Tahmini son taksit ayı ("Şubat 2027"); yoksa null. */
  endMonth: string | null
}

export interface BudgetReport {
  title: string
  cycleKey: string
  cycleLabel: string
  /** Bugünün döngü günü / döngü uzunluğu. */
  day: number
  totalDays: number
  generatedAt: string
  summary: Pick<CycleSummary, 'income' | 'fixed' | 'variable' | 'cashFlow' | 'creditCard'>
  categories: { rows: (CategorySlice & { label: string })[]; total: number }
  comparison: {
    state: ComparisonState
    labels: string[]
    baselineLabel: string | null
    values: Pick<Comparison, 'dortluBuAy' | 'dortluBazAy' | 'fark'> | null
  }
  /** Döngü henüz veritabanında yoksa null. */
  creditCard: CreditCardStatus | null
  /** available=false: borç verisi alınamadı (liste boş, raporda not gösterilir). */
  debts: { available: boolean; rows: { name: string; balance: number; priority: number }[]; total: number }
  fixed: {
    duzenli: ReportFixedRow[]
    duzenliTotal: number
    taksit: ReportInstallmentRow[]
    taksitTotal: number
  }
}

export function buildReport(params: {
  data: BudgetData
  today: string
  /** Borçlar; alınamadıysa (çevrimdışı ve önbellek yok) null/undefined — rapor yine üretilir. */
  debts: readonly DebtRow[] | null | undefined
  /** Cihazda bekleyen harcamalar (ana ekrandaki gibi hesaba katılır). */
  pending?: readonly ExpenseLike[]
  /** Oluşturulma anı (test için sabitlenebilir). */
  now?: Date
}): BudgetReport {
  const { data, today, debts, pending = [], now = new Date() } = params
  const { window, cycle } = data.active
  const summary = cycleSummary(data, pending)
  const comparison = buildComparison(data, today, { pending })
  const labels = cuttableLabels(data.categories).map(stripEmoji)
  const baseline = data.baseline?.cycle ?? null

  const state: ComparisonState = !labels.length
    ? 'noCuttable'
    : !baseline
      ? 'noBaseline'
      : baseline.id === cycle?.id
        ? 'activeIsBaseline'
        : 'ok'

  const groups = groupFixed(data.active.fixed)
  const fixedRow = (r: (typeof groups.duzenli)[number]): ReportFixedRow => ({
    item: stripEmoji(r.item),
    amount: r.amount,
    date: r.date,
    paid: r.paid,
  })
  const sorted = sortDebts(debts ?? [])

  return {
    title: REPORT_TITLE,
    cycleKey: cycle?.key ?? window.start.slice(0, 7),
    cycleLabel: longCycleLabel(window.start, window.end),
    day: clampedCycleDay(window, today),
    totalDays: cycleLength(window.start, window.end),
    generatedAt: dayjs(now).locale('tr').format('D MMMM YYYY HH:mm'),
    summary: {
      income: summary.income,
      fixed: summary.fixed,
      variable: summary.variable,
      cashFlow: summary.cashFlow,
      creditCard: summary.creditCard,
    },
    categories: { rows: summary.byCategory.map((c) => ({ ...c, label: stripEmoji(c.label) })), total: summary.variable },
    comparison: {
      state,
      labels,
      baselineLabel: baseline ? cycleLabel(baseline.start_date, baseline.end_date) : null,
      values: state === 'ok' && comparison ? { dortluBuAy: comparison.dortluBuAy, dortluBazAy: comparison.dortluBazAy, fark: comparison.fark } : null,
    },
    creditCard: cycle ? creditCardStatus(Number(cycle.cc_opening_balance ?? 0), summary.creditCard) : null,
    debts: {
      available: Array.isArray(debts),
      rows: sorted.map((d) => ({ name: stripEmoji(d.name), balance: d.balance, priority: d.priority })),
      total: debtTotals(sorted).total,
    },
    fixed: {
      duzenli: groups.duzenli.map(fixedRow),
      duzenliTotal: groups.duzenliTotal,
      taksit: groups.taksit.map((r) => {
        const end = installmentEndDate(r.date, r.installments_left)
        return {
          ...fixedRow(r),
          remaining: stripEmoji(installmentBadgeText(r.installments_left, r.paid) ?? ''),
          endMonth: end && r.installments_left !== null && r.installments_left > 1 ? dayjs(end).locale('tr').format('MMMM YYYY') : null,
        }
      }),
      taksitTotal: groups.taksitTotal,
    },
  }
}

/** İndirilecek dosya adı: aile-butcesi_2026-09.pdf */
export function reportFileName(report: Pick<BudgetReport, 'cycleKey'>): string {
  const key = report.cycleKey.replace(/[^0-9A-Za-z_-]+/g, '-')
  return `aile-butcesi_${key}.pdf`
}
