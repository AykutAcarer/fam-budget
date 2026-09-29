/**
 * Borç ödeme geçmişi — debt_payments + bakiye tetikleyicisi ve RLS,
 * gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const A = '00000000-0000-0000-0000-0000000000d1'
const B = '00000000-0000-0000-0000-0000000000d2'

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
const balanceOf = async (id: string) => Number((await q<{ balance: string }>(`select balance from public.debts where id = $1`, [id]))[0]?.balance)
const pay = async (debtId: string, amount: number | string, date = '2026-09-20', note: string | null = null) =>
  (await q<{ id: string }>(`insert into public.debt_payments (debt_id, date, amount, note) values ($1, $2, $3, $4) returning id`, [debtId, date, amount, note]))[0].id
const totalPaid = async (debtId: string) =>
  Number((await q<{ total: string }>(`select coalesce(sum(amount), 0) as total from public.debt_payments where debt_id = $1`, [debtId]))[0].total)

let kart: string
let aile: string
let bDebt: string

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
  await q(`insert into auth.users (id) values ($1), ($2)`, [A, B])
  await as(A, async () => {
    kart = (await q<{ id: string }>(`insert into public.debts (name, balance, has_interest) values ('Kredi kartı', 1000.10, true) returning id`))[0].id
    aile = (await q<{ id: string }>(`insert into public.debts (name, balance) values ('Aile', 300) returning id`))[0].id
  })
  await as(B, async () => {
    bDebt = (await q<{ id: string }>(`insert into public.debts (name, balance) values ('B borcu', 500) returning id`))[0].id
  })
})

describe('ödeme ekle / sil / düzenle → bakiye', () => {
  it('ödeme eklemek bakiyeyi kuruşu kuruşuna azaltır', async () => {
    await as(A, async () => {
      await pay(kart, 0.1)
      await pay(kart, 0.2)
      expect(await balanceOf(kart)).toBe(999.8) // 1000,10 − 0,10 − 0,20 (kayan nokta hatası yok)
      await pay(kart, 199.8, '2026-09-25', 'eylül taksiti')
      expect(await balanceOf(kart)).toBe(800)
    })
  })

  it('toplam ödenen doğru', async () => {
    expect(await as(A, () => totalPaid(kart))).toBe(200.1)
  })

  it('ödemeyi silmek bakiyeyi geri getirir', async () => {
    await as(A, async () => {
      const id = await pay(kart, 50)
      expect(await balanceOf(kart)).toBe(750)
      await q(`delete from public.debt_payments where id = $1`, [id])
      expect(await balanceOf(kart)).toBe(800)
    })
  })

  it('tutarı düzenlemek farkı yansıtır; yalnız tarih/not düzenlemek bakiyeye dokunmaz', async () => {
    await as(A, async () => {
      const id = await pay(aile, 100)
      expect(await balanceOf(aile)).toBe(200)
      await q(`update public.debt_payments set amount = 60 where id = $1`, [id])
      expect(await balanceOf(aile)).toBe(240)
      await q(`update public.debt_payments set date = '2026-09-01', note = 'nakit' where id = $1`, [id])
      expect(await balanceOf(aile)).toBe(240)
      await q(`delete from public.debt_payments where id = $1`, [id])
      expect(await balanceOf(aile)).toBe(300)
    })
  })

  it('kalan bakiyeden büyük ödeme reddedilir, hiçbir şey yazılmaz', async () => {
    await as(A, async () => {
      expect(await errorOf(pay(aile, 300.01))).toMatch(/kalan bakiyeden büyük olamaz \(kalan 300\.00\)/)
      expect(await balanceOf(aile)).toBe(300)
      expect(await totalPaid(aile)).toBe(0)
      // Tam bakiye ödenebilir → 0
      const id = await pay(aile, 300)
      expect(await balanceOf(aile)).toBe(0)
      // Düzenlemede de sınır: eski ödeme geri alınarak hesaplanır (300 → 300 olur, 301 olmaz)
      expect(await errorOf(q(`update public.debt_payments set amount = 301 where id = $1`, [id]))).toMatch(/büyük olamaz/)
      expect(await balanceOf(aile)).toBe(0)
      await q(`delete from public.debt_payments where id = $1`, [id])
      expect(await balanceOf(aile)).toBe(300)
    })
  })

  it('sıfır / negatif tutar reddedilir', async () => {
    await as(A, async () => {
      expect(await errorOf(pay(aile, 0))).toMatch(/check/)
      expect(await errorOf(pay(aile, -5))).toMatch(/check/)
    })
  })

  it('borç silinince ödemeleri de silinir', async () => {
    await as(A, async () => {
      const tmp = (await q<{ id: string }>(`insert into public.debts (name, balance) values ('Geçici', 40) returning id`))[0].id
      await pay(tmp, 10)
      await q(`delete from public.debts where id = $1`, [tmp])
      expect(await q(`select 1 from public.debt_payments where debt_id = $1`, [tmp])).toEqual([])
    })
  })
})

describe('RLS', () => {
  it('başka kullanıcı ödemeleri göremez, silemez, değiştiremez', async () => {
    expect(await as(B, () => q(`select * from public.debt_payments`))).toEqual([])
    await as(B, () => q(`delete from public.debt_payments`))
    await as(B, () => q(`update public.debt_payments set amount = 1`))
    expect(await as(A, () => totalPaid(kart))).toBe(200.1)
    expect(await as(A, () => balanceOf(kart))).toBe(800)
  })

  it('başka kullanıcının borcuna ödeme eklenemez (bakiyesi değişmez)', async () => {
    expect(await as(A, () => errorOf(pay(bDebt, 10)))).not.toBeNull()
    expect(await as(B, () => balanceOf(bDebt))).toBe(500)
    // user_id'yi başkası olarak yazmak da reddedilir (A, B'nin borcunu göremez; RLS de izin vermez)
    expect(
      await as(A, () => errorOf(q(`insert into public.debt_payments (user_id, debt_id, date, amount) values ($1, $2, '2026-09-20', 1)`, [B, bDebt]))),
    ).toMatch(/Borç bulunamadı|row-level security/)
    // Kendi borcuna başkasının user_id'siyle yazmak RLS'e takılır
    expect(
      await as(A, () => errorOf(q(`insert into public.debt_payments (user_id, debt_id, date, amount) values ($1, $2, '2026-09-20', 1)`, [B, kart]))),
    ).not.toBeNull()
    expect(await as(A, () => balanceOf(kart))).toBe(800)
    expect(await as(B, () => balanceOf(bDebt))).toBe(500)
  })

  it('anon erişemez', async () => {
    await db.exec('set role anon')
    try {
      expect(await errorOf(q(`select * from public.debt_payments`))).toMatch(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})
