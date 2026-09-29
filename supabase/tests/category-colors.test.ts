/**
 * Kategori renk migration'ı ve seed ↔ tek kaynak senkronu.
 *
 * - Migration öncesi kayıt olmuş (pastel renkli) kullanıcının renkleri taşınır;
 *   kullanıcının kendi seçtiği renklere dokunulmaz.
 * - Yeni kullanıcının seed'i supabase/functions/_shared/categories.ts ile birebir aynıdır.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, LEGACY_PASTEL_COLORS } from '../functions/_shared/categories'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const COLOR_MIGRATION = '20260930000000_accessible_category_colors.sql'
const LEGACY_USER = '00000000-0000-0000-0000-0000000000a1'
const CUSTOM_USER = '00000000-0000-0000-0000-0000000000a2'
const NEW_USER = '00000000-0000-0000-0000-0000000000a3'

const AUTH_STUB = `
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
const colorsOf = async (userId: string) =>
  Object.fromEntries(
    (await db.query<{ key: string; color: string }>('select key, color from public.categories where user_id = $1', [userId])).rows.map(
      (r) => [r.key, r.color],
    ),
  )

beforeAll(async () => {
  db = new PGlite()
  await db.exec(AUTH_STUB)
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  expect(files).toContain(COLOR_MIGRATION)
  const run = (f: string) => db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))

  // Renk migration'ından önceki şema + eski (pastel) seed ile kayıt olan kullanıcılar.
  for (const f of files.filter((f) => f < COLOR_MIGRATION)) await run(f)
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [LEGACY_USER, CUSTOM_USER])
  // Biri rengini kendisi değiştirmiş; biri de pasteli küçük harfle kaydetmiş (içe aktarma).
  await db.query(`update public.categories set color = '#123456' where user_id = $1 and key = 'sosyal'`, [CUSTOM_USER])
  await db.query(`update public.categories set color = lower(color) where user_id = $1 and key = 'mutfak'`, [CUSTOM_USER])

  for (const f of files.filter((f) => f >= COLOR_MIGRATION)) await run(f)
  await db.query(`insert into auth.users (id) values ($1)`, [NEW_USER])
})

const NEW = Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.key, c.color]))

describe('renk migration\'ı', () => {
  it('eski kullanıcıların pastel renkleri yeni paletle değişir', async () => {
    expect(await colorsOf(LEGACY_USER)).toEqual(NEW)
  })

  it('kullanıcının kendi seçtiği renk korunur; büyük/küçük harf farkı taşımayı engellemez', async () => {
    expect(await colorsOf(CUSTOM_USER)).toEqual({ ...NEW, sosyal: '#123456' })
  })

  it('eski pastel listesi tek kaynaktakiyle aynı ve eksiksiz', () => {
    expect(Object.keys(LEGACY_PASTEL_COLORS).sort()).toEqual(Object.keys(NEW).sort())
  })
})

describe('seed ↔ tek kaynak', () => {
  it('yeni kullanıcının varsayılan kategorileri DEFAULT_CATEGORIES ile birebir aynıdır', async () => {
    const rows = await db.query<{ key: string; label: string; type: string; color: string; keywords: string[]; sort_order: number }>(
      'select key, label, type, color, keywords, sort_order from public.categories where user_id = $1 order by sort_order',
      [NEW_USER],
    )
    expect(rows.rows).toEqual(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, keywords: [...c.keywords], sort_order: i + 1 })))
  })

  it('migration öncesi kullanıcıların varsayılan kategorilerine de anahtar kelimeler yazılır', async () => {
    const rows = await db.query<{ key: string; keywords: string[] }>('select key, keywords from public.categories where user_id = $1', [LEGACY_USER])
    expect(Object.fromEntries(rows.rows.map((r) => [r.key, r.keywords]))).toEqual(
      Object.fromEntries(DEFAULT_CATEGORIES.map((c) => [c.key, [...c.keywords]])),
    )
  })
})
