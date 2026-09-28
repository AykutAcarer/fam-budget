/**
 * Veritabanı şeması + RLS testleri.
 *
 * Migration'ları gömülü bir Postgres'te (PGlite) çalıştırır; Supabase'in
 * auth şeması, auth.uid() ve anon/authenticated rolleri minimal olarak taklit
 * edilir. Docker veya Supabase CLI gerekmez: `npm test`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { clampIsoDate } from '../../src/lib/date'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const SEED_FILE = join(import.meta.dirname, '..', '..', 'butce_verisi.json')

const USER_A = '00000000-0000-0000-0000-00000000000a'
const USER_B = '00000000-0000-0000-0000-00000000000b'

// Supabase'in hazır sunduğu auth altyapısının test için asgari karşılığı.
const SUPABASE_AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public to anon, authenticated;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
`

let db: PGlite

/** Bir sorgu dizisini verilen kullanıcı (JWT sub) olarak çalıştırır. */
async function asUser<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

async function createCycle(key: string, start: string, end: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.cycles (key, label, start_date, end_date) values ($1, $1, $2, $3) returning id`,
    [key, start, end],
  )
  return res.rows[0].id
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(SUPABASE_AUTH_STUB)
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
  }
  await db.query(`insert into auth.users (id, email) values ($1, 'a@test'), ($2, 'b@test')`, [USER_A, USER_B])
})

describe('yeni kullanıcı', () => {
  it('varsayılan 10 kategoriyle başlar', async () => {
    const rows = await asUser(USER_A, () =>
      db.query<{ key: string; type: string }>('select key, type from public.categories order by sort_order'),
    )
    expect(rows.rows.map((r) => r.key)).toEqual([
      'mutfak', 'yakit', 'mensemax', 'kahvalti', 'is', 'halisaha', 'sosyal', 'temizlik', 'hanim', 'kredi karti',
    ])
  })
})

describe('RLS izolasyonu', () => {
  let cycleA: string

  beforeAll(async () => {
    await asUser(USER_A, async () => {
      cycleA = await createCycle('2026-09', '2026-09-15', '2026-10-14')
      await db.query(`insert into public.income (cycle_id, date, source, amount) values ($1, '2026-09-15', 'Maas', 2347)`, [cycleA])
      await db.query(`insert into public.fixed_expenses (cycle_id, date, item, amount) values ($1, '2026-09-15', 'Kira', 1000)`, [cycleA])
      await db.query(
        `insert into public.variable_expenses (cycle_id, date, category, description, amount)
         values ($1, '2026-09-16', 'halisaha', 'halısaha', 8.25)`,
        [cycleA],
      )
      await db.query(`insert into public.debts (name, balance) values ('Kredi Karti', 6026.31)`)
    })
  })

  it('B, A\'nın hiçbir satırını göremez', async () => {
    for (const table of ['categories', 'cycles', 'income', 'fixed_expenses', 'variable_expenses', 'debts']) {
      const rows = await asUser(USER_B, () =>
        db.query<{ user_id: string }>(`select user_id from public.${table}`),
      )
      expect(rows.rows.every((r) => r.user_id === USER_B), table).toBe(true)
    }
    const cycles = await asUser(USER_B, () => db.query('select * from public.cycles'))
    expect(cycles.rows).toHaveLength(0)
  })

  it('A kendi satırlarını görür', async () => {
    const rows = await asUser(USER_A, () => db.query('select * from public.variable_expenses'))
    expect(rows.rows).toHaveLength(1)
  })

  it('B, user_id olarak A\'yı yazamaz', async () => {
    await expect(
      asUser(USER_B, () => db.query(`insert into public.debts (user_id, name, balance) values ($1, 'x', 1)`, [USER_A])),
    ).rejects.toThrow(/row-level security/)
  })

  it('B, A\'nın döngüsüne kendi adına harcama ekleyemez (bileşik FK)', async () => {
    await expect(
      asUser(USER_B, () =>
        db.query(
          `insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-09-16', 'sosyal', 1)`,
          [cycleA],
        ),
      ),
    ).rejects.toThrow(/foreign key/)
  })

  it('B, A\'nın satırlarını güncelleyemez/silemez', async () => {
    await asUser(USER_B, async () => {
      const upd = await db.query(`update public.variable_expenses set amount = 999`)
      const del = await db.query(`delete from public.cycles`)
      expect(upd.affectedRows).toBe(0)
      expect(del.affectedRows).toBe(0)
    })
    const rows = await asUser(USER_A, () => db.query<{ amount: string }>('select amount from public.variable_expenses'))
    expect(rows.rows[0].amount).toBe('8.25')
  })

  it('anon hiçbir tabloyu okuyamaz', async () => {
    await expect(asUser(null, () => db.query('select * from public.cycles'))).rejects.toThrow(/permission denied/)
  })

  it('bilinmeyen kategori key\'i reddedilir', async () => {
    await expect(
      asUser(USER_A, () =>
        db.query(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-09-16', 'yok', 1)`, [cycleA]),
      ),
    ).rejects.toThrow(/foreign key/)
  })
})

describe('baz ay', () => {
  it('kullanıcı başına tek baz ay; set_baseline_cycle eskiyi kaldırır', async () => {
    await asUser(USER_B, async () => {
      const c1 = await createCycle('2026-07', '2026-07-15', '2026-08-14')
      const c2 = await createCycle('2026-08', '2026-08-15', '2026-09-14')
      await db.query('select public.set_baseline_cycle($1)', [c1])
      await expect(db.query('update public.cycles set is_baseline = true where id = $1', [c2])).rejects.toThrow(/unique/)
      await db.query('select public.set_baseline_cycle($1)', [c2])
      const res = await db.query<{ id: string }>('select id from public.cycles where is_baseline')
      expect(res.rows.map((r) => r.id)).toEqual([c2])
    })
  })

  it('başkasının döngüsü baz ay yapılamaz', async () => {
    const cycleA = await asUser(USER_A, async () => (await db.query<{ id: string }>('select id from public.cycles limit 1')).rows[0].id)
    await expect(asUser(USER_B, () => db.query('select public.set_baseline_cycle($1)', [cycleA]))).rejects.toThrow(/bulunamadı/)
  })
})

describe('seed verisi (butce_verisi.json)', () => {
  // Not: seed'de '2026-09-31' gibi geçersiz tarihler var; importer gibi clampIsoDate ile düzeltilir.
  it('şema kısıtlarına uyar ve eksiksiz yazılabilir', async () => {
    type SeedCycle = {
      id: string; label: string; start: string; end: string; isBaseline: boolean
      income: { date: string; source: string; amount: number; received: boolean; note?: string }[]
      fixed: { date: string; item: string; amount: number; paid: boolean; source?: string; note?: string }[]
      variable: { date: string; category: string; description: string; amount: number }[]
    }
    const seed = JSON.parse(readFileSync(SEED_FILE, 'utf8')) as {
      debts: { name: string; balance: number; interest: string | null; hasInterest: boolean; dueDate: string | null; priority: number; note?: string }[]
      cycles: SeedCycle[]
    }
    const userC = '00000000-0000-0000-0000-00000000000c'
    await db.query(`insert into auth.users (id) values ($1)`, [userC])

    await asUser(userC, async () => {
      for (const d of seed.debts) {
        await db.query(
          `insert into public.debts (name, balance, interest, has_interest, due_date, priority, note) values ($1,$2,$3,$4,$5,$6,$7)`,
          [d.name, d.balance, d.interest, d.hasInterest, d.dueDate, d.priority, d.note ?? null],
        )
      }
      for (const c of seed.cycles) {
        const res = await db.query<{ id: string }>(
          `insert into public.cycles (key, label, start_date, end_date, is_baseline) values ($1,$2,$3,$4,$5) returning id`,
          [c.id, c.label, c.start, c.end, c.isBaseline],
        )
        const cycleId = res.rows[0].id
        for (const i of c.income) {
          await db.query(
            `insert into public.income (cycle_id, date, source, amount, received, note) values ($1,$2,$3,$4,$5,$6)`,
            [cycleId, clampIsoDate(i.date), i.source, i.amount, i.received, i.note ?? null],
          )
        }
        for (const f of c.fixed) {
          await db.query(
            `insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, note) values ($1,$2,$3,$4,$5,$6,$7)`,
            [cycleId, clampIsoDate(f.date), f.item, f.amount, f.paid, f.source ?? null, f.note ?? null],
          )
        }
        for (const v of c.variable) {
          await db.query(
            `insert into public.variable_expenses (cycle_id, date, category, description, amount) values ($1,$2,$3,$4,$5)`,
            [cycleId, clampIsoDate(v.date), v.category, v.description, v.amount],
          )
        }
      }

      const counts = await db.query<{ n: number }>('select count(*)::int as n from public.variable_expenses')
      expect(counts.rows[0].n).toBe(seed.cycles.reduce((s, c) => s + c.variable.length, 0))
    })
  })
})
