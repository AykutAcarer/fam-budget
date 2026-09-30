/**
 * Kredi kartı borç takibi (cycles.cc_opening_balance) — veri taşıma, devir
 * (idempotent), içe aktarma ve RLS; gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { creditCardStatus, nextOpeningBalance } from '../../src/lib/creditCard'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const CC_MIGRATION = '20261008000000_credit_card_tracking.sql'
const A = '00000000-0000-0000-0000-0000000000c7' // kredi kartı borcu var
const B = '00000000-0000-0000-0000-0000000000d7' // kredi kartı borcu yok
const C = '00000000-0000-0000-0000-0000000000e7' // borcu var ama hiç döngüsü yok

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
const cc = async (user: string, key: string) =>
  Number((await as(user, () => q<{ v: string }>(`select cc_opening_balance::text as v from public.cycles where key = $1`, [key])))[0]?.v)
const debtNames = (user: string) => as(user, () => q<{ name: string }>(`select name from public.debts order by name`)).then((r) => r.map((x) => x.name))
const cycleId = async (user: string, key: string) => (await as(user, () => q<{ id: string }>(`select id from public.cycles where key = $1`, [key])))[0].id
const roll = (user: string, id: string) => as(user, () => q<{ id: string }>(`select public.roll_forward_cycle($1) as id`, [id])).then((r) => r[0].id)
const pay = (user: string, cycle: string, date: string, amount: number, category = 'kredi karti') =>
  as(user, () => q(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, $2, $3, $4)`, [cycle, date, category, amount]))

// Bugünü kapsayan döngü (migration "bu döngü"yü current_date ile bulur)
const today = new Date()
const iso = (d: Date) => d.toISOString().slice(0, 10)
const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (today.getUTCDate() < 15 ? 1 : 0), 15))
const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 14))
const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 15))
const prevEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 14))
const CUR = 'cur'
const PREV = 'prev'

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    grant usage on schema public to anon, authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `)
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  expect(files).toContain(CC_MIGRATION)
  const run = (f: string) => db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))

  for (const f of files.filter((f) => f < CC_MIGRATION)) await run(f)
  await q(`insert into auth.users (id) values ($1), ($2), ($3)`, [A, B, C])
  for (const u of [A, B]) {
    await as(u, async () => {
      await q(`insert into public.cycles (key, label, start_date, end_date) values ($1, $1, $2, $3)`, [PREV, iso(prevStart), iso(prevEnd)])
      await q(`insert into public.cycles (key, label, start_date, end_date) values ($1, $1, $2, $3)`, [CUR, iso(start), iso(end)])
    })
  }
  await as(A, async () => {
    await q(`insert into public.debts (name, balance, has_interest, interest, priority) values ('Kredi Kartı', 6026.31, true, '~%18/yıl', 1)`)
    await q(`insert into public.debts (name, balance, priority) values ('Aile büyüğü', 1200, 2)`)
  })
  await as(B, () => q(`insert into public.debts (name, balance) values ('Arkadaş borcu', 750)`))
  await as(C, () => q(`insert into public.debts (name, balance) values ('Kredi kartı', 99)`))
  for (const f of files.filter((f) => f >= CC_MIGRATION)) await run(f)
})

describe('veri taşıma', () => {
  it('kredi kartı borcunun bakiyesi bu döngünün dönem başı borcu olur; kayıt Borçlar\'dan silinir', async () => {
    expect(await cc(A, CUR)).toBe(6026.31)
    expect(await cc(A, PREV)).toBe(0)
    expect(await debtNames(A)).toEqual(['Aile büyüğü'])
  })

  it('kredi kartı kaydı olmayan kullanıcıda dönem başı 0; borçları aynen kalır', async () => {
    expect(await cc(B, CUR)).toBe(0)
    expect(await debtNames(B)).toEqual(['Arkadaş borcu'])
  })

  it('döngüsü olmayan kullanıcıda kayıt yerinde bırakılır (taşınacak yer yok)', async () => {
    expect(await debtNames(C)).toEqual(['Kredi kartı'])
  })
})

describe('kalan borç ve devir', () => {
  it('dönem başı 6026,31, bu dönem 300 ödendi → kalan 5726,31; devirde yeni dönem başı = kalan', async () => {
    const cur = await cycleId(A, CUR)
    await pay(A, cur, iso(start), 100)
    await pay(A, cur, iso(start), 200)
    await pay(A, cur, iso(start), 55, 'mutfak') // karta ödeme değil
    expect(creditCardStatus(6026.31, 300)).toMatchObject({ remaining: 5726.31 })

    const next = await roll(A, cur)
    const [row] = await as(A, () => q<{ v: string }>(`select cc_opening_balance::text as v from public.cycles where id = $1`, [next]))
    expect(Number(row.v)).toBe(5726.31)
    expect(Number(row.v)).toBe(nextOpeningBalance(6026.31, 300))
  })

  it('idempotent: devir iki kez çalışınca borç iki kez taşınmaz', async () => {
    const cur = await cycleId(A, CUR)
    const first = await roll(A, cur)
    await pay(A, cur, iso(start), 1000) // devirden sonra eklenen ödeme yeni devri tetiklemez
    const second = await roll(A, cur)
    expect(second).toBe(first)
    const rows = await as(A, () => q<{ v: string }>(`select cc_opening_balance::text as v from public.cycles where start_date > $1`, [iso(end)]))
    expect(rows.map((r) => Number(r.v))).toEqual([5726.31])
  })

  it('fazla ödeme devre negatif borç taşımaz (0)', async () => {
    const cur = await cycleId(B, CUR)
    await pay(B, cur, iso(start), 40)
    const next = await roll(B, cur)
    const [row] = await as(B, () => q<{ v: string }>(`select cc_opening_balance::text as v from public.cycles where id = $1`, [next]))
    expect(Number(row.v)).toBe(0)
  })

  it('elle düzeltme: dönem başı borç doğrudan güncellenir; negatif reddedilir', async () => {
    await as(B, () => q(`update public.cycles set cc_opening_balance = 812.4 where key = $1`, [CUR]))
    expect(await cc(B, CUR)).toBe(812.4)
    await expect(as(B, () => q(`update public.cycles set cc_opening_balance = -1 where key = $1`, [CUR]))).rejects.toThrow(/check/)
  })
})

describe('içe aktarma', () => {
  it('ccOpeningBalance varsa yazılır; yoksa mevcut değer korunur (eski dosyalar sorunsuz)', async () => {
    const file = (extra: object) => JSON.stringify({ cycles: [{ id: CUR, label: CUR, start: iso(start), end: iso(end), income: [], fixed: [], variable: [], ...extra }] })
    await as(B, () => q(`select public.import_data($1::jsonb)`, [file({ ccOpeningBalance: 1500.5 })]))
    expect(await cc(B, CUR)).toBe(1500.5)
    await as(B, () => q(`select public.import_data($1::jsonb)`, [file({})]))
    expect(await cc(B, CUR)).toBe(1500.5)
  })
})

describe('RLS', () => {
  it('başka kullanıcının dönem başı borcu okunamaz / değiştirilemez', async () => {
    await as(B, () => q(`update public.cycles set cc_opening_balance = 1 where user_id = $1`, [A]))
    expect(await cc(A, CUR)).toBe(6026.31)
    expect(await as(B, () => q(`select * from public.cycles where user_id = $1`, [A]))).toEqual([])
  })
})
