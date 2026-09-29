/**
 * Döngü devri (roll_forward_cycle) — gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { cycleLabel } from '../../src/lib/cycle'
import { dateForDayInCycle } from '../../src/lib/fixed'
import { normalizeImport } from '../../src/lib/transfer'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const A = '00000000-0000-0000-0000-0000000000f1'
const C = '00000000-0000-0000-0000-0000000000f3'
const B = '00000000-0000-0000-0000-0000000000f2'

let db: PGlite

async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user])
  await db.exec('set role authenticated')
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

const q = <T,>(sql: string, params: unknown[] = []) => db.query<T>(sql, params).then((r) => r.rows)

async function cycle(key: string, start: string, end: string, baseline = false): Promise<string> {
  return (await q<{ id: string }>(`insert into public.cycles (key, label, start_date, end_date, is_baseline) values ($1,$1,$2,$3,$4) returning id`, [key, start, end, baseline]))[0].id
}
const fixed = (cycleId: string, date: string, item: string, amount: number, extra: { paid?: boolean; source?: string | null; inst?: number | null; recurring?: boolean; note?: string } = {}) =>
  q(`insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, installments_left, recurring, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    cycleId, date, item, amount, extra.paid ?? false, extra.source ?? null, extra.inst ?? null, extra.recurring ?? true, extra.note ?? null,
  ])
const income = (cycleId: string, date: string, source: string, amount: number, received: boolean, recurring = true) =>
  q(`insert into public.income (cycle_id, date, source, amount, received, recurring, note) values ($1,$2,$3,$4,$5,$6,'eski not')`, [cycleId, date, source, amount, received, recurring])
const roll = async (id: string) => (await q<{ id: string }>(`select public.roll_forward_cycle($1) as id`, [id]))[0].id

type FixedOut = { date: string; item: string; amount: string; paid: boolean; source: string | null; installments_left: number | null; recurring: boolean; note: string | null }
const fixedOf = (cycleId: string) =>
  q<FixedOut>(`select to_char(date,'YYYY-MM-DD') as date, item, amount, paid, source, installments_left, recurring, note from public.fixed_expenses where cycle_id = $1 order by item`, [cycleId])
const incomeOf = (cycleId: string) =>
  q<{ date: string; source: string; received: boolean; note: string | null }>(`select to_char(date,'YYYY-MM-DD') as date, source, received, note from public.income where cycle_id = $1 order by source`, [cycleId])
const cycleOf = (id: string) =>
  q<{ key: string; label: string; start: string; end: string; is_baseline: boolean }>(
    `select key, label, to_char(start_date,'YYYY-MM-DD') as start, to_char(end_date,'YYYY-MM-DD') as end, is_baseline from public.cycles where id = $1`, [id]).then((r) => r[0])

let sep: string
let oct: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `)
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  await q(`insert into auth.users (id) values ($1), ($2), ($3)`, [A, B, C])

  await as(A, async () => {
    await cycle('2026-08', '2026-08-15', '2026-09-14', true) // baz ay
    sep = await cycle('2026-09', '2026-09-15', '2026-10-14')
    await fixed(sep, '2026-09-15', 'Kira', 850, { paid: true, note: 'eylül notu' })
    await fixed(sep, '2026-10-07', 'Telekom', 39.99, { source: 'kart' })
    await fixed(sep, '2026-09-30', 'Taksit dört', 45, { inst: 4, paid: true })
    await fixed(sep, '2026-09-20', 'Son taksit', 30, { inst: 1 })
    await fixed(sep, '2026-09-25', 'Tek seferlik', 99, { recurring: false })
    await income(sep, '2026-09-15', 'Maaş', 2250, true)
    await income(sep, '2026-10-07', 'Kinderzuschlag', 255, false)
    await income(sep, '2026-09-20', 'İkramiye', 500, true, false)
    await q(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-09-16', 'mutfak', 40)`, [sep])
    oct = await roll(sep)
  })
})

describe('roll_forward_cycle', () => {
  it('15 Eyl – 14 Eki kaynaktan 15 Eki – 14 Kas üretir; baz ay değişmez', async () => {
    await as(A, async () => {
      expect(await cycleOf(oct)).toEqual({ key: '2026-10', label: '15 Eki – 14 Kas 2026', start: '2026-10-15', end: '2026-11-14', is_baseline: false })
      expect((await q<{ key: string }>(`select key from public.cycles where is_baseline`)).map((r) => r.key)).toEqual(['2026-08'])
    })
  })

  it('sabit giderler: recurring taşınır (ödenmedi), tek seferlik ve son taksit taşınmaz, taksit 4 → 3, NULL → NULL', async () => {
    await as(A, async () => {
      expect(await fixedOf(oct)).toEqual([
        { date: '2026-10-15', item: 'Kira', amount: '850.00', paid: false, source: null, installments_left: null, recurring: true, note: null },
        { date: '2026-10-30', item: 'Taksit dört', amount: '45.00', paid: false, source: null, installments_left: 3, recurring: true, note: null },
        { date: '2026-11-07', item: 'Telekom', amount: '39.99', paid: false, source: 'kart', installments_left: null, recurring: true, note: null },
      ])
    })
  })

  it('gelir: recurring "alınmadı" olarak taşınır, tek seferlik taşınmaz; değişken harcama taşınmaz', async () => {
    await as(A, async () => {
      expect(await incomeOf(oct)).toEqual([
        { date: '2026-11-07', source: 'Kinderzuschlag', received: false, note: null },
        { date: '2026-10-15', source: 'Maaş', received: false, note: null },
      ])
      expect(await q(`select 1 from public.variable_expenses where cycle_id = $1`, [oct])).toHaveLength(0)
    })
  })

  it('idempotent: tekrar çağrılınca aynı döngü döner, kopya oluşmaz', async () => {
    await as(A, async () => {
      expect(await roll(sep)).toBe(oct)
      expect(await fixedOf(oct)).toHaveLength(3)
      expect(await incomeOf(oct)).toHaveLength(2)
      expect(await q(`select 1 from public.cycles where start_date = '2026-10-15'`)).toHaveLength(1)
    })
  })

  it('çok atlama: iki döngü üst üste devredilince taksit iki kez azalır', async () => {
    await as(A, async () => {
      const nov = await roll(oct)
      expect(await cycleOf(nov)).toMatchObject({ start: '2026-11-15', end: '2026-12-14', label: '15 Kas – 14 Ara 2026' })
      expect((await fixedOf(nov)).find((f) => f.item === 'Taksit dört')?.installments_left).toBe(2)
      const dec = await roll(nov)
      expect(await cycleOf(dec)).toMatchObject({ start: '2026-12-15', end: '2027-01-14', label: '15 Ara 2026 – 14 Oca 2027' })
      expect((await fixedOf(dec)).find((f) => f.item === 'Taksit dört')?.installments_left).toBe(1)
      // 1 → son taksit Aralık döngüsündeydi; bir sonrakine taşınmaz.
      const jan = await roll(dec)
      expect((await fixedOf(jan)).map((f) => f.item)).toEqual(['Kira', 'Telekom'])
    })
  })

  it('ay günü clamp: 31 → o ayın son günü', async () => {
    await as(B, async () => {
      const src = await cycle('2026-10', '2026-10-15', '2026-11-14')
      await fixed(src, '2026-10-31', 'Ay sonu ödemesi', 10)
      const next = await roll(src) // 15 Kas – 14 Ara: Kasım'da 31 yok → 30 Kas
      expect((await fixedOf(next))[0].date).toBe('2026-11-30')
      const after = await roll(next) // 15 Ara – 14 Oca: gün 30 → 30 Ara
      expect((await fixedOf(after))[0].date).toBe('2026-12-30')
    })
  })

  it('bu tarihi kapsayan döngü zaten varsa (ör. içe aktarılmış) kopyalamaz', async () => {
    await as(B, async () => {
      const src = await cycle('2027-03', '2027-03-15', '2027-04-14')
      await fixed(src, '2027-03-20', 'Kira', 900)
      const existing = await cycle('ithal-nisan', '2027-04-15', '2027-05-14')
      expect(await roll(src)).toBe(existing)
      expect(await fixedOf(existing)).toHaveLength(0)
    })
  })

  it('RLS: başka kullanıcının döngüsü devredilemez', async () => {
    await expect(as(B, () => roll(sep))).rejects.toThrow(/bulunamadı/)
  })
})

describe('SQL ↔ TypeScript eşleri', () => {
  it('day_in_cycle = dateForDayInCycle (1–31, farklı pencereler)', async () => {
    const windows = [['2026-09-15', '2026-10-14'], ['2026-10-15', '2026-11-14'], ['2027-01-15', '2027-02-14'], ['2027-02-15', '2027-03-14'], ['2026-12-15', '2027-01-14']]
    for (const [s, e] of windows) {
      const sql = await q<{ d: number; r: string }>(`select d, to_char(public.day_in_cycle($1::date, $2::date, d), 'YYYY-MM-DD') as r from generate_series(1, 31) d`, [s, e])
      for (const row of sql) expect(row.r, `${s} gün ${row.d}`).toBe(dateForDayInCycle(s, e, row.d))
    }
  })

  it('cycle_label = cycleLabel', async () => {
    for (const [s, e] of [['2026-10-15', '2026-11-14'], ['2026-12-15', '2027-01-14'], ['2027-05-15', '2027-06-14'], ['2027-08-15', '2027-09-14']]) {
      const [{ l }] = await q<{ l: string }>(`select public.cycle_label($1::date, $2::date) as l`, [s, e])
      expect(l).toBe(cycleLabel(s, e))
    }
  })
})

describe('ornek_devir_testi.json: içe aktar → devret', () => {
  it('Ağustos döngüsünden Eylül: tek seferlik taşınmaz, taksit 7 → 6, gelir alınmadı, harcama yok', async () => {
    const file = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'ornek_devir_testi.json'), 'utf8'))
    const { data } = normalizeImport(file)
    const aug = data.cycles[0]
    await as(C, async () => {
      await q(`select public.import_data($1)`, [JSON.stringify(data)])
      const [{ id }] = await q<{ id: string }>(`select id from public.cycles where key = '2026-08'`)
      const sep = await roll(id)
      expect(await cycleOf(sep)).toMatchObject({ start: '2026-09-15', end: '2026-10-14', label: '15 Eyl – 14 Eki 2026', is_baseline: false })
      const fx = await fixedOf(sep)
      // Sıralama veritabanı ile JS'te farklı olabilir (İ, Ç); içerik karşılaştırılır.
      const byName = (xs: string[]) => [...xs].sort((a, b) => a.localeCompare(b, 'tr'))
      expect(byName(fx.map((f) => f.item))).toEqual(byName(aug.fixed.filter((f) => f.recurring !== false).map((f) => f.item)))
      expect(fx.find((f) => f.item === 'Araç sigortası')).toBeUndefined()
      expect(fx.find((f) => f.item === 'Beyaz eşya taksiti')).toMatchObject({ installments_left: 6, date: '2026-09-30' })
      expect(fx.every((f) => !f.paid)).toBe(true)
      expect((await incomeOf(sep)).every((i) => !i.received)).toBe(true)
      expect(await q(`select 1 from public.variable_expenses where cycle_id = $1`, [sep])).toHaveLength(0)
    })
  })
})
