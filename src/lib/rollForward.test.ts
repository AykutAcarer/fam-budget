import { describe, expect, it } from 'vitest'
import { cycleWindowFor } from './cycle'
import { MAX_ROLLS, nextCycleWindow, rollForwardSource, rollsNeeded } from './rollForward'

const c = (id: string, start_date: string, end_date: string) => ({ id, start_date, end_date })

describe('nextCycleWindow', () => {
  it('15 Eyl – 14 Eki → 15 Eki – 14 Kas', () => {
    expect(nextCycleWindow('2026-10-14')).toEqual({ key: '2026-10', label: '15 Eki – 14 Kas 2026', start: '2026-10-15', end: '2026-11-14' })
  })

  it('yıl geçişi ve Şubat', () => {
    expect(nextCycleWindow('2026-12-14')).toMatchObject({ start: '2026-12-15', end: '2027-01-14', label: '15 Ara 2026 – 14 Oca 2027' })
    expect(nextCycleWindow('2027-02-14')).toMatchObject({ start: '2027-02-15', end: '2027-03-14' })
  })

  it('maaş günü döngüleriyle aynı pencereyi üretir', () => {
    for (const d of ['2026-09-20', '2026-12-31', '2027-02-10']) {
      const w = cycleWindowFor(d)
      expect(nextCycleWindow(w.end)).toEqual(cycleWindowFor(nextCycleWindow(w.end).start))
    }
  })
})

describe('rollForwardSource', () => {
  const cycles = [c('aug', '2026-08-15', '2026-09-14'), c('sep', '2026-09-15', '2026-10-14')]

  it('bugünü kapsayan döngü varsa devir yok', () => {
    expect(rollForwardSource(cycles, '2026-10-14')).toBeNull()
  })

  it('bugün en yeni döngünün bitişinden sonraysa kaynak en yeni döngü', () => {
    expect(rollForwardSource(cycles, '2026-10-15')?.id).toBe('sep')
    expect(rollForwardSource([...cycles].reverse(), '2027-01-02')?.id).toBe('sep')
  })

  it('hiç döngü yoksa ya da tarih tüm döngülerden önceyse devir yok', () => {
    expect(rollForwardSource([], '2026-10-15')).toBeNull()
    expect(rollForwardSource(cycles, '2026-07-01')).toBeNull()
  })
})

describe('rollsNeeded', () => {
  it('bir, iki ve çok döngü atlama', () => {
    expect(rollsNeeded('2026-10-14', '2026-10-15')).toBe(1)
    expect(rollsNeeded('2026-10-14', '2026-11-14')).toBe(1)
    expect(rollsNeeded('2026-10-14', '2026-11-15')).toBe(2)
    expect(rollsNeeded('2026-10-14', '2027-03-01')).toBe(5)
  })

  it('güvenlik sınırı', () => {
    expect(rollsNeeded('2020-01-14', '2030-01-01')).toBe(MAX_ROLLS)
  })
})
