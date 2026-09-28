import { describe, expect, it } from 'vitest'
import {
  debtTotals,
  dueStatus,
  nextPriority,
  parseBalance,
  parseInterestRate,
  sortDebts,
  splitDueDate,
  validateDebtForm,
  type DebtLike,
} from './debts'

const TODAY = '2026-09-28'
const d = (name: string, balance: number, over: Partial<DebtLike> = {}): DebtLike => ({
  name, balance, interest: null, has_interest: false, due_date: null, priority: 100, ...over,
})

describe('sortDebts', () => {
  it('faizliler önce (yüksek oran önce), sonra faizsizler öncelik sırasıyla', () => {
    const debts = [
      d('Arkadaş', 750, { priority: 3 }),
      d('Kredi kartı', 2480.5, { has_interest: true, interest: '~%18/yıl', priority: 1 }),
      d('Ev sahibi', 420, { priority: 2 }),
      d('Taksitli kredi', 5000, { has_interest: true, interest: '%9,9', priority: 5 }),
      d('Aile büyüğü', 1200, { priority: 4 }),
    ]
    expect(sortDebts(debts).map((x) => x.name)).toEqual(['Kredi kartı', 'Taksitli kredi', 'Ev sahibi', 'Arkadaş', 'Aile büyüğü'])
  })

  it('faiz oranı okunamayan faizli borç, oranlı faizlilerden sonra ama faizsizlerden önce', () => {
    const debts = [d('Faizsiz', 1, { priority: 1 }), d('Bilinmeyen faiz', 1, { has_interest: true, interest: 'değişken' }), d('Faizli', 1, { has_interest: true, interest: '12%' })]
    expect(sortDebts(debts).map((x) => x.name)).toEqual(['Faizli', 'Bilinmeyen faiz', 'Faizsiz'])
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
  it('toplam = faizli + faizsiz, sent hassasiyetinde', () => {
    const t = debtTotals([
      d('KK', 6026.31, { has_interest: true }),
      d('A', 3000),
      d('B', 0.1),
      d('C', 0.2),
    ])
    expect(t).toEqual({ total: 9026.61, interest: 6026.31, interestFree: 3000.3 })
  })

  it('boş liste', () => {
    expect(debtTotals([])).toEqual({ total: 0, interest: 0, interestFree: 0 })
  })
})

describe('parseInterestRate', () => {
  it.each([
    ['~%17,5/yil', 17.5],
    ['%18', 18],
    ['18%', 18],
    ['yıllık % 9.9', 9.9],
    ['değişken', null],
    [null, null],
  ])('%s → %s', (text, rate) => {
    expect(parseInterestRate(text)).toBe(rate)
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
  const base = { name: ' Kredi Kartı ', balance: '6.026,31', hasInterest: true, interest: ' ~%17,5/yıl ', dueMonth: '', dueDay: '', priority: '1', note: '' }

  it('Türkçe bakiye ve faiz', () => {
    expect(validateDebtForm(base)).toEqual({
      ok: true,
      value: { name: 'Kredi Kartı', balance: 6026.31, has_interest: true, interest: '~%17,5/yıl', due_date: null, priority: 1, note: null },
    })
  })

  it('faizsizde faiz metni kaydedilmez; ay veya tam tarih vadesi', () => {
    expect(validateDebtForm({ ...base, hasInterest: false, dueMonth: '2027-01' })).toMatchObject({
      ok: true, value: { interest: null, has_interest: false, due_date: '2027-01' },
    })
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
