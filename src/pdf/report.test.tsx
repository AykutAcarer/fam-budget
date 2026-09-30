import { writeFileSync } from 'node:fs'
import { renderToBuffer } from '@react-pdf/renderer'
import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { buildComparison, cycleSummary, type BudgetData } from '../lib/budget'
import { creditCardStatus } from '../lib/creditCard'
import type { CategoryRow, CycleRow, DebtRow, FixedExpenseRow } from '../lib/database.types'
import { debtTotals } from '../lib/debts'
import { groupFixed, installmentBadgeText } from '../lib/fixed'
import { buildReport, DEBTS_UNAVAILABLE_NOTE, longCycleLabel, reportFileName, stripEmoji } from '../lib/report'
import { BudgetReportDocument } from './BudgetReportDocument'
import { registerPdfFonts } from './fonts'

const TODAY = '2026-09-28'
const cycle = (id: string, key: string, start: string, end: string, extra: Partial<CycleRow> = {}): CycleRow => ({
  id, user_id: 'u', key, label: key, start_date: start, end_date: end, is_baseline: false, cc_opening_balance: 0, created_at: '', ...extra,
})
const cat = (key: string, label: string, color: string, sort_order: number, is_cuttable = false): CategoryRow => ({
  id: key, user_id: 'u', key, label, type: 'zorunlu', color, sort_order, keywords: [], is_cuttable, created_at: '',
})
const fixed = (item: string, date: string, amount: number, paid: boolean, installments_left: number | null): FixedExpenseRow => ({
  id: item, user_id: 'u', cycle_id: 'a', date, item, amount, paid, source: null, note: null, installments_left, recurring: true,
  fixed_kind: installments_left === null ? 'duzenli' : 'taksit', created_at: '',
})
const v = (date: string, category: string, amount: number) => ({ id: `${date}${category}${amount}`, user_id: 'u', cycle_id: 'a', date, category, description: '', amount, created_at: '' })

function data(): BudgetData {
  return {
    categories: [
      cat('mutfak', 'Mutfak / Market', '#22A06B', 1),
      cat('kahvalti', 'Kahvaltı', '#B78C11', 4, true),
      cat('sosyal', 'Sosyal / diğer', '#7C4DFF', 7, true),
      cat('kredi karti', 'Kredi kartı ödemesi', '#6B7280', 10),
    ],
    active: {
      cycle: cycle('a', '2026-09', '2026-09-15', '2026-10-14', { cc_opening_balance: 6026.31 }),
      window: { label: 'x', start: '2026-09-15', end: '2026-10-14' },
      income: [
        { id: 'i1', user_id: 'u', cycle_id: 'a', date: '2026-09-15', source: 'Maaş', amount: 2250, received: true, note: null, recurring: true, created_at: '' },
        { id: 'i2', user_id: 'u', cycle_id: 'a', date: '2026-10-07', source: 'Kinderzuschlag', amount: 255, received: false, note: null, recurring: true, created_at: '' },
      ],
      fixed: [
        fixed('Kira', '2026-09-15', 850, true, null),
        fixed('İnternet', '2026-10-01', 34.99, false, null),
        fixed('Bulaşık makinesi', '2026-09-22', 30, true, 6),
        fixed('Çamaşır makinesi 🎉', '2026-09-25', 45.5, true, 1),
      ],
      variable: [v('2026-09-15', 'mutfak', 120.4), v('2026-09-16', 'kahvalti', 4.45), v('2026-09-20', 'sosyal', 22.1), v('2026-09-21', 'kredi karti', 300)],
    },
    baseline: { cycle: cycle('b', '2026-08', '2026-08-15', '2026-09-14', { is_baseline: true }), variable: [v('2026-08-16', 'kahvalti', 10), v('2026-08-20', 'sosyal', 30)] },
  }
}
const debts: DebtRow[] = [
  { id: 'd1', user_id: 'u', name: 'Aile büyüğü (Şükrü amca)', balance: 1200, interest: null, has_interest: false, due_date: null, priority: 2, note: null, created_at: '' },
  { id: 'd2', user_id: 'u', name: 'Ev sahibi — yan gider farkı', balance: 420, interest: null, has_interest: false, due_date: '2027-01', priority: 1, note: null, created_at: '' },
]
const NOW = new Date('2026-09-28T10:30:00')

describe('rapor verisi yalnız uygulamanın seçicilerinden gelir (PDF hesap yapmaz)', () => {
  const d = data()
  const r = buildReport({ data: d, today: TODAY, debts, now: NOW })
  const summary = cycleSummary(d)

  it('durum özeti = ana ekrandaki cycleSummary', () => {
    expect(r.summary).toEqual({
      income: summary.income,
      fixed: summary.fixed,
      variable: summary.variable,
      cashFlow: summary.cashFlow,
      creditCard: summary.creditCard,
    })
  })

  it('kategori dağılımı = cycleSummary.byCategory (renkler aynı kaynaktan)', () => {
    expect(r.categories.rows.map(({ key, amount, share, color }) => ({ key, amount, share, color }))).toEqual(
      summary.byCategory.map(({ key, amount, share, color }) => ({ key, amount, share, color })),
    )
    expect(r.categories.total).toBe(summary.variable)
  })

  it('kısılabilir kıyas = buildComparison (yalnız ✂ açık kategoriler)', () => {
    const c = buildComparison(d, TODAY)!
    expect(r.comparison.state).toBe('ok')
    expect(r.comparison.values).toEqual({ dortluBuAy: c.dortluBuAy, dortluBazAy: c.dortluBazAy, fark: c.fark })
    expect(r.comparison.labels).toEqual(['Kahvaltı', 'Sosyal / diğer'])
  })

  it('kredi kartı = creditCardStatus(dönem başı, ödenen)', () => {
    expect(r.creditCard).toEqual(creditCardStatus(6026.31, summary.creditCard))
    expect(r.creditCard?.remaining).toBe(5726.31)
  })

  it('borçlar öncelik sırasıyla, toplam debtTotals; faiz bilgisi yok', () => {
    expect(r.debts.rows.map((x) => x.name)).toEqual(['Ev sahibi — yan gider farkı', 'Aile büyüğü (Şükrü amca)'])
    expect(r.debts.total).toBe(debtTotals(debts).total)
    expect(Object.keys(r.debts.rows[0]).sort()).toEqual(['balance', 'name', 'priority'])
    expect(r.debts.available).toBe(true)
  })

  it('sabitler groupFixed; kalan taksit düzeltilmiş gösterimle (bu ay ödendiyse −1), emojisiz', () => {
    const g = groupFixed(d.active.fixed)
    expect(r.fixed.duzenliTotal).toBe(g.duzenliTotal)
    expect(r.fixed.taksitTotal).toBe(g.taksitTotal)
    expect(r.fixed.taksit.map((t) => [t.item, t.remaining, t.endMonth])).toEqual([
      ['Bulaşık makinesi', '5 taksit kaldı', 'Şubat 2027'],
      ['Çamaşır makinesi', 'son taksit ödendi', null],
    ])
    expect(installmentBadgeText(6, true)).toBe('5 taksit kaldı')
  })

  it('başlık, döngü ve dosya adı', () => {
    expect(r.cycleLabel).toBe('15 Eylül – 14 Ekim 2026')
    expect(longCycleLabel('2026-12-15', '2027-01-14')).toBe('15 Aralık 2026 – 14 Ocak 2027')
    expect(r.generatedAt).toBe('28 Eylül 2026 10:30')
    expect(reportFileName(r)).toBe('aile-butcesi_2026-09.pdf')
  })

  it('kısılabilir seçilmemişse / baz ay yoksa kıyas değerleri yok', () => {
    const none = { ...d, categories: d.categories.map((c) => ({ ...c, is_cuttable: false })) }
    expect(buildReport({ data: none, today: TODAY, debts }).comparison).toMatchObject({ state: 'noCuttable', values: null })
    expect(buildReport({ data: { ...d, baseline: null }, today: TODAY, debts }).comparison).toMatchObject({ state: 'noBaseline', values: null })
  })

  it('stripEmoji', () => {
    expect(stripEmoji('son taksit ödendi 🎉')).toBe('son taksit ödendi')
    expect(stripEmoji('Tatil ✈️ fonu 🇹🇷')).toBe('Tatil fonu')
    expect(stripEmoji('Şükrü – ığüşöç İ')).toBe('Şükrü – ığüşöç İ')
  })
})

describe('PDF üretimi', () => {
  it('Türkçe adlarla gerçek bir PDF üretir; Roboto gömülü, Helvetica yok', async () => {
    registerPdfFonts()
    const report = buildReport({ data: data(), today: TODAY, debts, now: NOW })
    const buf = await renderToBuffer(<BudgetReportDocument report={report} />)
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, buf)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(buf.length).toBeGreaterThan(10_000)
    const raw = buf.toString('latin1')
    expect(raw).toMatch(/\/FontName \/[A-Z]{6}\+Roboto-Regular/)
    expect(raw).toMatch(/\/FontName \/[A-Z]{6}\+Roboto-Bold/)
    expect(raw).not.toMatch(/Helvetica/)
  }, 30_000)

  it('boş döngü (harcama, borç, sabit yok) da hata vermeden çizilir', async () => {
    registerPdfFonts()
    const d = data()
    d.active = { ...d.active, variable: [], fixed: [], income: [] }
    const buf = await renderToBuffer(<BudgetReportDocument report={buildReport({ data: d, today: TODAY, debts: [] })} />)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)
})

/** Belge ağacındaki tüm metinleri toplar (kendi bileşenlerimiz hook kullanmaz, doğrudan çağrılabilir). */
function texts(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(texts).join('')
  if (isValidElement(node)) {
    const { type, props } = node as ReactElement<{ children?: unknown }>
    if (typeof type === 'function') return texts((type as (p: unknown) => unknown)(props))
    return texts(props.children) + ' '
  }
  return ''
}

describe('borç verisi alınamadığında (çevrimdışı, önbellek yok)', () => {
  it.each([null, undefined])('debts=%s: rapor yine üretilir, borç listesi boş ve "görüntülenemedi" notu var', async (missing) => {
    const r = buildReport({ data: data(), today: TODAY, debts: missing, now: NOW })
    expect(r.debts).toEqual({ available: false, rows: [], total: 0 })
    // Raporun geri kalanı normal
    expect(r.summary).toEqual(buildReport({ data: data(), today: TODAY, debts, now: NOW }).summary)
    expect(r.creditCard?.remaining).toBe(5726.31)

    const tree = texts(<BudgetReportDocument report={r} />)
    expect(tree).toContain('Borçlar (öncelik sırasıyla)')
    expect(tree).toContain(DEBTS_UNAVAILABLE_NOTE)
    expect(DEBTS_UNAVAILABLE_NOTE).toMatch(/görüntülenemedi/)
    expect(tree).not.toContain('Toplam borç')

    registerPdfFonts()
    const buf = await renderToBuffer(<BudgetReportDocument report={r} />)
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  }, 30_000)

  it('borç verisi varken davranış aynı: liste + toplam, not yok', () => {
    const tree = texts(<BudgetReportDocument report={buildReport({ data: data(), today: TODAY, debts, now: NOW })} />)
    expect(tree).toContain('Ev sahibi — yan gider farkı')
    expect(tree).toContain('Toplam borç')
    expect(tree).not.toContain(DEBTS_UNAVAILABLE_NOTE)
  })

  it('boş borç listesi (kayıtlı borç yok) "görüntülenemedi" değildir', () => {
    const r = buildReport({ data: data(), today: TODAY, debts: [], now: NOW })
    expect(r.debts.available).toBe(true)
    const tree = texts(<BudgetReportDocument report={r} />)
    expect(tree).toContain('Kayıtlı borç yok.')
    expect(tree).not.toContain(DEBTS_UNAVAILABLE_NOTE)
  })
})
