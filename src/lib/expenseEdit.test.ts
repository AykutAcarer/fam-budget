import { describe, expect, it } from 'vitest'
import { validateExpenseEdit } from './expenseEdit'

const cycle = { start: '2026-09-15', end: '2026-10-14' }
const keys = ['halisaha', 'sosyal']
const base = { category: 'halisaha', amount: '8,25', date: '2026-09-20', description: ' halısaha ' }

describe('validateExpenseEdit', () => {
  it('geçerli girdi', () => {
    expect(validateExpenseEdit(base, cycle, keys)).toEqual({
      ok: true,
      value: { category: 'halisaha', amount: 8.25, date: '2026-09-20', description: 'halısaha' },
    })
  })

  it('döngü sınırları dahil, dışı reddedilir', () => {
    expect(validateExpenseEdit({ ...base, date: '2026-09-15' }, cycle, keys).ok).toBe(true)
    expect(validateExpenseEdit({ ...base, date: '2026-10-14' }, cycle, keys).ok).toBe(true)
    expect(validateExpenseEdit({ ...base, date: '2026-10-15' }, cycle, keys)).toMatchObject({ ok: false, errors: { date: expect.any(String) } })
  })

  it('bilinmeyen kategori, bozuk tutar, boş tarih', () => {
    const r = validateExpenseEdit({ category: 'yok', amount: 'on', date: '', description: '' }, cycle, keys)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['amount', 'category', 'date'])
  })

  it('binlik ayırıcılı tutar; boş açıklama kabul', () => {
    expect(validateExpenseEdit({ ...base, amount: '1.250,50', description: '' }, cycle, keys)).toMatchObject({
      ok: true,
      value: { amount: 1250.5, description: '' },
    })
  })
})
