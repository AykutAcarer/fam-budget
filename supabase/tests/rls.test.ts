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
import { compareToBaseline } from '../../src/lib/compare'
import { normalizeImport } from '../../src/lib/transfer'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const SEED_FILE = join(import.meta.dirname, '..', '..', 'ornek_veri.json')

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

  it('B, A\'nın borcunu güncelleyemez/silemez', async () => {
    await asUser(USER_B, async () => {
      expect((await db.query(`update public.debts set balance = 0`)).affectedRows).toBe(0)
      expect((await db.query(`delete from public.debts`)).affectedRows).toBe(0)
    })
    const rows = await asUser(USER_A, () => db.query<{ balance: string }>(`select balance from public.debts`))
    expect(rows.rows).toEqual([{ balance: '6026.31' }])
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

  it('baz ay değişince tek baz ay kalır ve kıyas yeni baz ayın harcamalarını kullanır', async () => {
    await asUser(USER_B, async () => {
      const ids = (await db.query<{ id: string; key: string }>(`select id, key from public.cycles order by key`)).rows
      const byKey = Object.fromEntries(ids.map((r) => [r.key, r.id]))
      // Aynı döngü gününde (3. gün) farklı dörtlü harcamalar.
      await db.query(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-07-17', 'sosyal', 10)`, [byKey['2026-07']])
      await db.query(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-08-17', 'sosyal', 25)`, [byKey['2026-08']])

      const comparisonWithBaseline = async () => {
        const base = (await db.query<{ id: string; start_date: string; end_date: string }>(
          `select id, to_char(start_date,'YYYY-MM-DD') as start_date, to_char(end_date,'YYYY-MM-DD') as end_date from public.cycles where is_baseline`,
        )).rows
        expect(base).toHaveLength(1)
        const exp = (await db.query<{ date: string; category: string; amount: string }>(
          `select to_char(date,'YYYY-MM-DD') as date, category, amount from public.variable_expenses where cycle_id = $1`,
          [base[0].id],
        )).rows.map((r) => ({ ...r, amount: Number(r.amount) }))
        return compareToBaseline({
          active: { start: '2026-09-15', end: '2026-10-14', expenses: [] },
          baseline: { start: base[0].start_date, end: base[0].end_date, expenses: exp },
          today: '2026-09-17',
        })!
      }

      await db.query('select public.set_baseline_cycle($1)', [byKey['2026-07']])
      expect((await comparisonWithBaseline()).dortluBazAy).toBe(10)
      await db.query('select public.set_baseline_cycle($1)', [byKey['2026-08']])
      expect((await comparisonWithBaseline()).dortluBazAy).toBe(25)
      const n = await db.query<{ n: number }>(`select count(*)::int as n from public.cycles where is_baseline`)
      expect(n.rows[0].n).toBe(1)
    })
  })

  it('başkasının döngüsü baz ay yapılamaz', async () => {
    const cycleA = await asUser(USER_A, async () => (await db.query<{ id: string }>('select id from public.cycles limit 1')).rows[0].id)
    await expect(asUser(USER_B, () => db.query('select public.set_baseline_cycle($1)', [cycleA]))).rejects.toThrow(/bulunamadı/)
  })
})

describe('import_data (ornek_veri.json)', () => {
  const USER_C = '00000000-0000-0000-0000-00000000000c'
  const { data } = normalizeImport(JSON.parse(readFileSync(SEED_FILE, 'utf8')))
  const counts = () =>
    db.query<Record<string, number>>(`
      select (select count(*)::int from public.cycles) as cycles,
             (select count(*)::int from public.income) as income,
             (select count(*)::int from public.fixed_expenses) as fixed,
             (select count(*)::int from public.variable_expenses) as variable,
             (select count(*)::int from public.debts) as debts,
             (select count(*)::int from public.categories) as categories`)
  const expected = {
    cycles: data.cycles.length,
    income: data.cycles.reduce((s, c) => s + c.income.length, 0),
    fixed: data.cycles.reduce((s, c) => s + c.fixed.length, 0),
    variable: data.cycles.reduce((s, c) => s + c.variable.length, 0),
    debts: data.debts.length,
    categories: 10,
  }

  beforeAll(async () => {
    await db.query(`insert into auth.users (id) values ($1)`, [USER_C])
  })

  it('tüm veriyi kullanıcının hesabına yazar', async () => {
    await asUser(USER_C, async () => {
      // Kullanıcının kendi kategori etiketi korunmalı.
      await db.query(`update public.categories set label = 'Benim marketim' where key = 'mutfak'`)
      const res = await db.query<{ s: Record<string, number> }>('select public.import_data($1) as s', [JSON.stringify(data)])
      expect(res.rows[0].s).toEqual({ ...expected, categories: 0 })
      expect((await counts()).rows[0]).toEqual(expected)

      const baseline = await db.query<{ key: string }>('select key from public.cycles where is_baseline')
      expect(baseline.rows.map((r) => r.key)).toEqual(['2026-08'])
      const label = await db.query<{ label: string }>(`select label from public.categories where key = 'mutfak'`)
      expect(label.rows[0].label).toBe('Benim marketim')
      const clamped = await db.query(`select 1 from public.fixed_expenses where date = '2026-09-30'`)
      expect(clamped.rows).toHaveLength(1)
    })
  })

  it('idempotent: tekrar içe aktarınca kopya oluşmaz', async () => {
    await asUser(USER_C, async () => {
      await db.query(`select public.import_data($1)`, [JSON.stringify(data)])
      expect((await counts()).rows[0]).toEqual(expected)
    })
  })

  it('aynı döngüdeki eski kayıtları dosyadakilerle değiştirir, baz ayı taşır', async () => {
    const edited = structuredClone(data)
    edited.cycles[1].variable = [{ date: '2026-09-16', category: 'halisaha', description: 'halısaha', amount: 8.25 }]
    edited.cycles[0].isBaseline = false
    edited.cycles[1].isBaseline = true
    edited.debts[0].balance = 100
    await asUser(USER_C, async () => {
      await db.query(`select public.import_data($1)`, [JSON.stringify(edited)])
      const c = (await counts()).rows[0]
      expect(c.variable).toBe(data.cycles[0].variable.length + 1)
      expect(c.debts).toBe(data.debts.length)
      const baseline = await db.query<{ key: string }>('select key from public.cycles where is_baseline')
      expect(baseline.rows.map((r) => r.key)).toEqual(['2026-09'])
      const debt = await db.query<{ balance: string }>('select balance from public.debts where name = $1', [data.debts[0].name])
      expect(debt.rows[0].balance).toBe('100.00')
    })
  })

  it('kalan taksit sayısı içe aktarılır; negatif değer reddedilir', async () => {
    await asUser(USER_C, async () => {
      const res = await db.query<{ date: string; installments_left: number | null }>(
        `select to_char(date, 'YYYY-MM-DD') as date, installments_left from public.fixed_expenses
          where item = 'Beyaz eşya taksiti' order by date`,
      )
      expect(res.rows).toEqual([
        { date: '2026-08-31', installments_left: 7 },
        { date: '2026-09-30', installments_left: 6 },
      ])
      const nulls = await db.query<{ n: number }>(`select count(*)::int as n from public.fixed_expenses where installments_left is null`)
      expect(nulls.rows[0].n).toBe(expected.fixed - 2)
      await expect(
        db.query(`update public.fixed_expenses set installments_left = -1 where item = 'Beyaz eşya taksiti'`),
      ).rejects.toThrow(/check constraint/)
    })
  })

  it('başka kullanıcı sabit gideri ödendi işaretleyemez', async () => {
    // 'Beyaz eşya taksiti' yalnızca USER_C'de var.
    const res = await asUser(USER_A, () =>
      db.query(`update public.fixed_expenses set paid = true, installments_left = 0 where item = 'Beyaz eşya taksiti'`),
    )
    expect(res.affectedRows).toBe(0)
    const still = await asUser(USER_C, () =>
      db.query<{ n: number }>(`select count(*)::int as n from public.fixed_expenses where item = 'Beyaz eşya taksiti' and installments_left > 0`),
    )
    expect(still.rows[0].n).toBe(2)
  })

  it('hata olursa hiçbir şey yazılmaz (atomik)', async () => {
    const broken = structuredClone(data)
    broken.cycles[0].id = '2027-01'
    broken.cycles[1].variable.push({ date: '2026-09-20', category: 'yok-boyle-kategori', description: '', amount: 1 })
    await asUser(USER_C, async () => {
      const before = (await counts()).rows[0]
      await expect(db.query(`select public.import_data($1)`, [JSON.stringify(broken)])).rejects.toThrow(/foreign key/)
      expect((await counts()).rows[0]).toEqual(before)
    })
  })

  it('başka kullanıcı içe aktarılan veriyi göremez; anon çağıramaz', async () => {
    const rows = await asUser(USER_A, () => db.query(`select 1 from public.cycles where key = '2026-08'`))
    expect(rows.rows).toHaveLength(0)
    await expect(asUser(null, () => db.query(`select public.import_data('{}')`))).rejects.toThrow(/permission denied/)
  })
})
