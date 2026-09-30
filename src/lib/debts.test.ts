import { describe, expect, it } from 'vitest'
import {
  debtTotals,
  dueStatus,
  nextPriority,
  parseBalance,
  sortDebts,
  splitDueDate,
  validateDebtForm,
  type DebtLike,
} from './debts'

const TODAY = '2026-09-28'
const d = (name: string, balance: number, over: Partial<DebtLike> = {}): DebtLike => ({
  name, balance, due_date: null, priority: 100, ...over,
})

describe('sortDebts', () => {
  it('tek düz liste: yalnız öncelik sırası (faiz ayrımı yok)', () => {
    const debts = [
      d('Arkadaş', 750, { priority: 3 }),
      d('Ev sahibi', 420, { priority: 2 }),
      d('Aile büyüğü', 1200, { priority: 4 }),
      d('Annemler', 5000, { priority: 1 }),
    ]
    expect(sortDebts(debts).map((x) => x.name)).toEqual(['Annemler', 'Ev sahibi', 'Arkadaş', 'Aile büyüğü'])
  })

  it('veritabanındaki eski faiz alanları sıralamayı etkilemez', () => {
    const legacy = [
      { ...d('Eski faizli', 10, { priority: 5 }), has_interest: true, interest: '%30' },
      d('Faizsiz', 10, { priority: 1 }),
    ]
    expect(sortDebts(legacy).map((x) => x.name)).toEqual(['Faizsiz', 'Eski faizli'])
  })

  it('öncelik eşitse yüksek bakiye önce, o da eşitse ada göre', () => {
    const debts = [d('B', 100, { priority: 2 }), d('A', 100, { priority: 2 }), d('C', 900, { priority: 2 })]
    expect(sortDebts(debts).map((x) => x.name)).toEqual(['C', 'A', 'B'])
  })

  it('girdiyi değiştirmez', () => {
    const debts = [d('B', 1, { priority: 2 }), d('A', 1, { priority: 1 })]
    sortDebts(debts)
    expect(debts[0].name).toBe('B')
  })
})

describe('debtTotals', () => {
  it('yalnız toplam (faizli/faizsiz ayrımı yok), sent hassasiyetinde', () => {
    expect(debtTotals([d('A', 3000), d('B', 0.1), d('C', 0.2)])).toEqual({ total: 3000.3 })
  })

  it('boş liste', () => {
    expect(debtTotals([])).toEqual({ total: 0 })
  })
})

describe('dueStatus — 30 gün sınırı', () => {
  it.each([
    ['2026-09-27', 'gecti', -1], // dün
    ['2026-09-28', 'yaklasiyor', 0], // bugün
    ['2026-10-28', 'yaklasiyor', 30], // bugün + 30
    ['2026-10-29', 'ileri', 31], // bugün + 31
  ])('%s → %s (%s gün)', (due, kind, days) => {
    expect(dueStatus(due, TODAY)).toEqual({ kind, date: due, days })
  })

  it('ay biçimli vade ayın ilk günü sayılır', () => {
    expect(dueStatus('2026-10', TODAY)).toEqual({ kind: 'yaklasiyor', date: '2026-10-01', days: 3 })
    expect(dueStatus('2027-01', TODAY)).toMatchObject({ kind: 'ileri', date: '2027-01-01' })
  })

  it('vade yoksa', () => {
    expect(dueStatus(null, TODAY)).toEqual({ kind: 'yok' })
  })
})

describe('form', () => {
  const base = { name: ' Aile büyüğü ', balance: '1.200,50', dueMonth: '', dueDay: '', priority: '1', note: '' }

  it('Türkçe bakiye; formda faiz alanı yok', () => {
    expect(validateDebtForm(base)).toEqual({
      ok: true,
      value: { name: 'Aile büyüğü', balance: 1200.5, due_date: null, priority: 1, note: null },
    })
  })

  it('ay veya tam tarih vadesi', () => {
    expect(validateDebtForm({ ...base, dueMonth: '2027-01' })).toMatchObject({ ok: true, value: { due_date: '2027-01' } })
    expect(validateDebtForm({ ...base, dueMonth: '2027-02', dueDay: '30' })).toMatchObject({ ok: true, value: { due_date: '2027-02-28' } })
  })

  it('kapanmış borç: 0 bakiye kabul', () => {
    expect(validateDebtForm({ ...base, balance: '0,00' })).toMatchObject({ ok: true, value: { balance: 0 } })
  })

  it('hatalar alan bazında', () => {
    const r = validateDebtForm({ ...base, name: '', balance: 'çok', dueMonth: '', dueDay: '5', priority: '0' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['balance', 'dueMonth', 'name', 'priority'])
  })

  it('parseBalance', () => {
    expect(parseBalance('1.350')).toBe(1350)
    expect(parseBalance('600 €')).toBe(600)
    expect(parseBalance('-5')).toBeNull()
  })

  it('splitDueDate kayıpsız', () => {
    expect(splitDueDate('2027-01')).toEqual({ dueMonth: '2027-01', dueDay: '' })
    expect(splitDueDate('2027-01-05')).toEqual({ dueMonth: '2027-01', dueDay: '5' })
    expect(splitDueDate(null)).toEqual({ dueMonth: '', dueDay: '' })
  })

  it('nextPriority', () => {
    expect(nextPriority([{ priority: 1 }, { priority: 6 }])).toBe(7)
    expect(nextPriority([])).toBe(1)
  })
})
