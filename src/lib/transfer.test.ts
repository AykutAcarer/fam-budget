import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExportRows } from './transfer'
import { buildExport, ImportValidationError, normalizeImport } from './transfer'

const ornek = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'ornek_veri.json'), 'utf8'))

function problemsOf(raw: unknown, known: string[] = []): string[] {
  try {
    normalizeImport(raw, known)
  } catch (e) {
    if (e instanceof ImportValidationError) return e.problems
    throw e
  }
  return []
}

describe('normalizeImport — ornek_veri.json', () => {
  const { data, warnings } = normalizeImport(ornek)

  it('sorunsuz okunur', () => {
    expect(data.categories).toHaveLength(10)
    expect(data.debts).toHaveLength(4)
    expect(data.cycles.map((c) => c.id)).toEqual(['2026-08', '2026-09'])
    expect(data.cycles.filter((c) => c.isBaseline).map((c) => c.id)).toEqual(['2026-08'])
  })

  it('geçersiz tarihi ay sonuna çeker ve uyarır', () => {
    const fixedDates = data.cycles[1].fixed.map((f) => f.date)
    expect(fixedDates).toContain('2026-09-30')
    expect(fixedDates).not.toContain('2026-09-31')
    expect(warnings).toEqual([expect.stringContaining('"2026-09-31" geçersiz, "2026-09-30"')])
  })

  it('ay biçimli borç vadesini korur', () => {
    expect(data.debts.find((d) => d.dueDate)?.dueDate).toBe('2027-01')
  })
})

describe('normalizeImport — hatalar', () => {
  const cycle = (over: object = {}) => ({
    id: '2026-09',
    label: 'x',
    start: '2026-09-15',
    end: '2026-10-14',
    income: [],
    fixed: [],
    variable: [],
    ...over,
  })

  it('JSON nesnesi olmayan girdiyi reddeder', () => {
    expect(problemsOf([])).toEqual(['Dosya bir JSON nesnesi olmalı'])
  })

  it('yol bilgisiyle alan hatalarını toplar', () => {
    const problems = problemsOf({
      cycles: [cycle({ id: '', variable: [{ date: '2026-09-16', category: 'sosyal', amount: 'abc' }] })],
    }, ['sosyal'])
    expect(problems).toContain('cycles[0].id: boş olamaz')
    expect(problems).toContain('cycles[0].variable[0].amount: sayı olmalı')
  })

  it('bilinmeyen kategoriyi reddeder, kullanıcının mevcut kategorisini kabul eder', () => {
    const raw = { cycles: [cycle({ variable: [{ date: '2026-09-16', category: 'yeni', amount: 1 }] })] }
    expect(problemsOf(raw)).toEqual(['cycles[0].variable[0].category: bilinmeyen kategori "yeni"'])
    expect(problemsOf(raw, ['yeni'])).toEqual([])
  })

  it('birden fazla baz ayı ve tekrar eden döngü id\'sini reddeder', () => {
    const problems = problemsOf({ cycles: [cycle({ isBaseline: true }), cycle({ isBaseline: true })] })
    expect(problems).toContain('cycles[1].id: "2026-09" birden fazla kez geçiyor')
    expect(problems).toContain('En fazla bir döngü baz ay (isBaseline) olabilir')
  })

  it('negatif tutar ve ters tarih aralığı', () => {
    const problems = problemsOf({
      debts: [{ name: 'x', balance: -5 }],
      cycles: [cycle({ start: '2026-10-15', end: '2026-10-14' })],
    })
    expect(problems).toContain('debts[0].balance: negatif olamaz')
    expect(problems).toContain('cycles[0]: bitiş tarihi başlangıçtan önce')
  })

  it('tutarları 2 haneye yuvarlar, Türkçe virgüllü metni kabul eder', () => {
    const { data } = normalizeImport(
      { cycles: [cycle({ variable: [{ date: '2026-09-16', category: 'is', amount: '3,725' }] })] },
      ['is'],
    )
    expect(data.cycles[0].variable[0].amount).toBe(3.73)
  })
})

describe('buildExport', () => {
  it('içe aktarılan veri dışa aktarılınca aynı dosya çıkar (gidiş-dönüş)', () => {
    const { data } = normalizeImport(ornek)
    const userId = 'u'
    let seq = 0
    const id = () => `id-${++seq}`
    const rows: ExportRows = { categories: [], debts: [], cycles: [], income: [], fixed: [], variable: [] }
    data.categories.forEach((c, i) =>
      rows.categories.push({ ...c, id: id(), user_id: userId, sort_order: i + 1, created_at: '' }),
    )
    data.debts.forEach((d) =>
      rows.debts.push({
        id: id(), user_id: userId, created_at: '', name: d.name, balance: d.balance, interest: d.interest,
        has_interest: d.hasInterest, due_date: d.dueDate, priority: d.priority, note: d.note ?? null,
      }),
    )
    // Veritabanından sırasız gelse de dosya sıralı çıkmalı.
    for (const c of [...data.cycles].reverse()) {
      const cycleId = id()
      rows.cycles.push({
        id: cycleId, user_id: userId, key: c.id, label: c.label, start_date: c.start, end_date: c.end,
        is_baseline: c.isBaseline, created_at: '',
      })
      for (const x of [...c.income].reverse())
        rows.income.push({ ...x, id: id(), user_id: userId, cycle_id: cycleId, note: x.note ?? null, created_at: '' })
      for (const x of c.fixed)
        rows.fixed.push({ ...x, id: id(), user_id: userId, cycle_id: cycleId, source: x.source ?? null, note: x.note ?? null, created_at: '' })
      for (const x of c.variable) rows.variable.push({ ...x, id: id(), user_id: userId, cycle_id: cycleId, created_at: '' })
    }

    const out = buildExport(rows, '2026-09-28')
    const sortByDate = <T extends { date: string }>(xs: T[]) => [...xs].sort((a, b) => a.date.localeCompare(b.date))
    const expected = data.cycles.map((c) => ({
      ...c,
      income: sortByDate(c.income),
      fixed: sortByDate(c.fixed),
      variable: sortByDate(c.variable),
    }))
    expect(out.categories).toEqual(data.categories)
    expect(out.debts).toEqual(data.debts.map((d) => ({ ...d, note: d.note ?? null })))
    expect(out.cycles).toEqual(expected)
    expect(normalizeImport(out).data.cycles).toEqual(expected)
  })
})
