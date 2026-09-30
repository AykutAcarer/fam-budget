/**
 * Kısılabilir kategoriler (categories.is_cuttable) — backfill, yeni kategori
 * varsayılanı ve RLS; gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { cuttableKeys } from '../../src/lib/categories'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const CUTTABLE_MIGRATION = '20261006000000_cuttable_categories.sql'
const OLD = '00000000-0000-0000-0000-0000000000b1' // migration'dan önce kayıt olmuş
const CHANGED = '00000000-0000-0000-0000-0000000000b2' // önceden bir kategorinin tipini değiştirmiş
const NEW = '00000000-0000-0000-0000-0000000000b3' // migration'dan sonra kayıt

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
const flags = (user: string) =>
  as(user, () => q<{ key: string; is_cuttable: boolean }>(`select key, is_cuttable from public.categories order by sort_order, key`))
const cutOf = async (user: string) => (await flags(user)).filter((r) => r.is_cuttable).map((r) => r.key)

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
  expect(files).toContain(CUTTABLE_MIGRATION)
  const run = (f: string) => db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))

  for (const f of files.filter((f) => f < CUTTABLE_MIGRATION)) await run(f)
  await q(`insert into auth.users (id) values ($1), ($2)`, [OLD, CHANGED])
  await as(OLD, () => q(`insert into public.categories (key, label, type, color) values ('spor', 'Spor', 'kisilabilir', '#3E89DE')`))
  await as(CHANGED, () => q(`update public.categories set type = 'zorunlu' where key = 'sosyal'`))

  for (const f of files.filter((f) => f >= CUTTABLE_MIGRATION)) await run(f)
  await q(`insert into auth.users (id) values ($1)`, [NEW])
})

describe('backfill ve varsayılanlar', () => {
  it('mevcut kullanıcıda varsayılan dörtlü kısılabilir gelir (davranış değişmez)', async () => {
    expect(await cutOf(OLD)).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
    expect(await cutOf(CHANGED)).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
  })

  it('kullanıcının kendi eklediği kategori kısılabilir değil (tipi kisilabilir olsa da)', async () => {
    expect((await flags(OLD)).find((r) => r.key === 'spor')?.is_cuttable).toBe(false)
  })

  it('yeni kullanıcının seed\'i dörtlüyü kısılabilir getirir; sonradan eklenen kategori kısılabilir değil', async () => {
    expect(await cutOf(NEW)).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
    await as(NEW, () => q(`insert into public.categories (key, label, type, color, sort_order) values ('kitap', 'Kitap', 'yari', '#A1592B', 11)`))
    expect((await flags(NEW)).find((r) => r.key === 'kitap')?.is_cuttable).toBe(false)
  })

  it('istemci kısılabilir kümeyi bu satırlardan üretir', async () => {
    expect(cuttableKeys(await flags(NEW))).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
  })
})

describe('seçim değiştirme ve RLS', () => {
  it('kullanıcı kendi kategorisinin bayrağını değiştirebilir; küme buna göre değişir', async () => {
    await as(NEW, async () => {
      await q(`update public.categories set is_cuttable = false where key = 'sosyal'`)
      await q(`update public.categories set is_cuttable = true where key = 'mutfak'`)
    })
    expect(cuttableKeys(await flags(NEW))).toEqual(['mutfak', 'kahvalti', 'is', 'halisaha'])
  })

  it('hepsi kapatılabilir (küme boş)', async () => {
    await as(CHANGED, () => q(`update public.categories set is_cuttable = false`))
    expect(cuttableKeys(await flags(CHANGED))).toEqual([])
  })

  it('başka kullanıcının bayrağı değiştirilemez', async () => {
    await as(NEW, () => q(`update public.categories set is_cuttable = false where user_id = $1`, [OLD]))
    expect(await cutOf(OLD)).toEqual(['kahvalti', 'is', 'halisaha', 'sosyal'])
  })
})
