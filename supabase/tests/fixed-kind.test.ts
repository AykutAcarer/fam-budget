/**
 * Sabit giderler: Düzenli / Taksit (fixed_expenses.fixed_kind) — backfill,
 * tutarlılık, tipe göre döngü devri (idempotent), içe aktarma ve RLS;
 * gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const KIND_MIGRATION = '20261007000000_fixed_kind.sql'
const A = '00000000-0000-0000-0000-0000000000a7'
const B = '00000000-0000-0000-0000-0000000000b7'

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
const errorOf = (p: Promise<unknown>) => p.then(() => null, (e: Error) => e.message)

type Row = { item: string; fixed_kind: string; installments_left: number | null; paid: boolean; amount: string; date: string }
const rowsOf = (cycleId: string) =>
  q<Row>(
    `select item, fixed_kind, installments_left, paid, amount::text as amount, to_char(date,'YYYY-MM-DD') as date
       from public.fixed_expenses where cycle_id = $1`,
    [cycleId],
  ).then((rows) => rows.sort((x, y) => x.item.localeCompare(y.item, 'tr'))) // Postgres sıralaması Türkçe değil
const roll = async (id: string) => (await q<{ id: string }>(`select public.roll_forward_cycle($1) as id`, [id]))[0].id

let aug: string

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
  expect(files).toContain(KIND_MIGRATION)
  const run = (f: string) => db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))

  // Migration öncesi veri: kalan taksiti olan / olmayan kalemler
  for (const f of files.filter((f) => f < KIND_MIGRATION)) await run(f)
  await q(`insert into auth.users (id) values ($1), ($2)`, [A, B])
  await as(A, async () => {
    aug = (await q<{ id: string }>(`insert into public.cycles (key, label, start_date, end_date) values ('2026-08','Ağu','2026-08-15','2026-09-14') returning id`))[0].id
    const ins = (item: string, day: string, amount: number, inst: number | null, recurring = true) =>
      q(`insert into public.fixed_expenses (cycle_id, date, item, amount, installments_left, recurring, paid) values ($1,$2,$3,$4,$5,$6,true)`, [
        aug, day, item, amount, inst, recurring,
      ])
    await ins('Kira', '2026-08-15', 850, null)
    await ins('İnternet', '2026-09-03', 39.99, null)
    await ins('Radar', '2026-08-20', 25, 5)
    await ins('PS5', '2026-08-25', 45.5, 2)
    await ins('Bulaşık', '2026-09-01', 30, 1) // son taksit bu döngüde
    await ins('Araç sigortası', '2026-08-28', 120, null, false) // tek seferlik
  })
  for (const f of files.filter((f) => f >= KIND_MIGRATION)) await run(f)
})

describe('backfill', () => {
  it('kalan taksiti olanlar taksit, olmayanlar düzenli', async () => {
    const rows = await as(A, () => rowsOf(aug))
    expect(rows.map((r) => [r.item, r.fixed_kind, r.installments_left])).toEqual([
      ['Araç sigortası', 'duzenli', null],
      ['Bulaşık', 'taksit', 1],
      ['İnternet', 'duzenli', null],
      ['Kira', 'duzenli', null],
      ['PS5', 'taksit', 2],
      ['Radar', 'taksit', 5],
    ])
  })
})

describe('tutarlılık', () => {
  it('tipi göndermeyen eski istemci: tip kalan taksitten türetilir', async () => {
    await as(A, () => q(`insert into public.fixed_expenses (cycle_id, date, item, amount, installments_left) values ($1,'2026-08-30','Eski istemci',10,3)`, [aug]))
    const [r] = await as(A, () => q<Row>(`select fixed_kind from public.fixed_expenses where item = 'Eski istemci'`))
    expect(r.fixed_kind).toBe('taksit')
    // Kalan taksit silinince düzenliye döner
    await as(A, () => q(`update public.fixed_expenses set installments_left = null where item = 'Eski istemci'`))
    const [r2] = await as(A, () => q<Row>(`select fixed_kind from public.fixed_expenses where item = 'Eski istemci'`))
    expect(r2.fixed_kind).toBe('duzenli')
    await as(A, () => q(`delete from public.fixed_expenses where item = 'Eski istemci'`))
  })

  it('geçersiz tip reddedilir', async () => {
    expect(
      await as(A, () => errorOf(q(`insert into public.fixed_expenses (cycle_id, date, item, amount, fixed_kind) values ($1,'2026-08-30','x',1,'aylik')`, [aug]))),
    ).toMatch(/check/)
  })
})

describe('döngü devri (tipe göre)', () => {
  let sep: string

  it('düzenli aynen kopyalanır, taksit bir azalır, son taksit düşer, tek seferlik taşınmaz', async () => {
    sep = await as(A, () => roll(aug))
    const rows = await as(A, () => rowsOf(sep))
    expect(rows.map((r) => [r.item, r.fixed_kind, r.installments_left, r.paid, r.amount, r.date])).toEqual([
      ['İnternet', 'duzenli', null, false, '39.99', '2026-10-03'],
      ['Kira', 'duzenli', null, false, '850.00', '2026-09-15'],
      ['PS5', 'taksit', 1, false, '45.50', '2026-09-25'],
      ['Radar', 'taksit', 4, false, '25.00', '2026-09-20'],
    ])
  })

  it('idempotent: aynı devir ikinci kez çalışınca taksitler tekrar azalmaz, kopya oluşmaz', async () => {
    expect(await as(A, () => roll(aug))).toBe(sep)
    const rows = await as(A, () => rowsOf(sep))
    expect(rows).toHaveLength(4)
    expect(rows.find((r) => r.item === 'Radar')?.installments_left).toBe(4)
    expect(rows.find((r) => r.item === 'PS5')?.installments_left).toBe(1)
  })

  it('bir sonraki devirde son taksit (PS5, kalan 1) düşer', async () => {
    const oct = await as(A, () => roll(sep))
    const rows = await as(A, () => rowsOf(oct))
    expect(rows.map((r) => [r.item, r.fixed_kind, r.installments_left])).toEqual([
      ['İnternet', 'duzenli', null],
      ['Kira', 'duzenli', null],
      ['Radar', 'taksit', 3],
    ])
  })
})

describe('içe aktarma', () => {
  it('fixed_kind dosyadaki installmentsLeft\'ten türetilir', async () => {
    await as(A, () =>
      q(`select public.import_data($1::jsonb)`, [
        JSON.stringify({
          cycles: [
            {
              id: '2026-06', label: 'Haz', start: '2026-06-15', end: '2026-07-14',
              income: [], variable: [],
              fixed: [
                { date: '2026-06-15', item: 'Kira', amount: 850 },
                { date: '2026-06-20', item: 'Notebook', amount: 60, installmentsLeft: 8 },
              ],
            },
          ],
        }),
      ]),
    )
    const [c] = await as(A, () => q<{ id: string }>(`select id from public.cycles where key = '2026-06'`))
    expect((await as(A, () => rowsOf(c.id))).map((r) => [r.item, r.fixed_kind, r.installments_left])).toEqual([
      ['Kira', 'duzenli', null],
      ['Notebook', 'taksit', 8],
    ])
  })
})

describe('RLS', () => {
  it('başka kullanıcı sabit giderleri göremez, tipini değiştiremez', async () => {
    expect(await as(B, () => q(`select * from public.fixed_expenses`))).toEqual([])
    await as(B, () => q(`update public.fixed_expenses set fixed_kind = 'duzenli', installments_left = null`))
    expect((await as(A, () => rowsOf(aug))).find((r) => r.item === 'Radar')).toMatchObject({ fixed_kind: 'taksit', installments_left: 5 })
  })
})
