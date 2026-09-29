/**
 * Kategori yönetimi — keywords sütunu, delete_category (taşı ve sil) ve RLS,
 * gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const A = '00000000-0000-0000-0000-0000000000c1'
const B = '00000000-0000-0000-0000-0000000000c2'

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
const deleteCategory = (key: string, moveTo: string | null = null) =>
  q<{ moved: number }>(`select public.delete_category($1, $2) as moved`, [key, moveTo]).then((r) => r[0].moved)
const keysOf = () => q<{ key: string }>(`select key from public.categories order by sort_order, key`).then((r) => r.map((x) => x.key))
const expensesByCategory = () =>
  q<{ category: string; n: number }>(`select category, count(*)::int as n from public.variable_expenses group by category order by category`)

let cycleA: string

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
    cycleA = (await q<{ id: string }>(`insert into public.cycles (key, label, start_date, end_date) values ('2026-09','Eyl','2026-09-15','2026-10-14') returning id`))[0].id
    await q(`insert into public.categories (key, label, type, color, sort_order, keywords) values ('spor', 'Spor', 'kisilabilir', '#3E89DE', 11, array['fitness','yüzme'])`)
    await q(`insert into public.categories (key, label, type, color, sort_order) values ('bos', 'Boş kategori', 'yari', '#17A2B8', 12)`)
    for (const [cat, amount] of [['spor', 10], ['spor', 20], ['halisaha', 8.25]] as const)
      await q(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-09-16', $2, $3)`, [cycleA, cat, amount])
  })
  await as(B, async () => {
    const c = (await q<{ id: string }>(`insert into public.cycles (key, label, start_date, end_date) values ('2026-09','Eyl','2026-09-15','2026-10-14') returning id`))[0].id
    await q(`insert into public.variable_expenses (cycle_id, date, category, amount) values ($1, '2026-09-16', 'halisaha', 5)`, [c])
  })
})

describe('keywords sütunu', () => {
  it('kullanıcı eklediği kategoriye anahtar kelime yazabilir; verilmezse boş liste', async () => {
    const rows = await as(A, () => q<{ key: string; keywords: string[] }>(`select key, keywords from public.categories where key in ('spor','bos') order by key`))
    expect(rows).toEqual([{ key: 'bos', keywords: [] }, { key: 'spor', keywords: ['fitness', 'yüzme'] }])
  })

  it('anahtar kelimeler güncellenebilir', async () => {
    await as(A, () => q(`update public.categories set keywords = array['fitness','yüzme','spor salonu'] where key = 'spor'`))
    const [row] = await as(A, () => q<{ keywords: string[] }>(`select keywords from public.categories where key = 'spor'`))
    expect(row.keywords).toEqual(['fitness', 'yüzme', 'spor salonu'])
  })

  it('içe aktarma dosyadaki keywords alanını yeni kategoriye yazar', async () => {
    await as(A, () =>
      q(`select public.import_data($1::jsonb)`, [
        JSON.stringify({ categories: [{ key: 'kitap', label: 'Kitap', type: 'yari', color: '#A1592B', keywords: ['kitap', 'kırtasiye'] }] }),
      ]),
    )
    const [row] = await as(A, () => q<{ keywords: string[] }>(`select keywords from public.categories where key = 'kitap'`))
    expect(row.keywords).toEqual(['kitap', 'kırtasiye'])
    await as(A, () => deleteCategory('kitap'))
  })
})

describe('delete_category', () => {
  it('harcaması olmayan kategori doğrudan silinir', async () => {
    expect(await as(A, () => deleteCategory('bos'))).toBe(0)
    expect(await as(A, keysOf)).not.toContain('bos')
  })

  it('harcaması olan kategori hedef verilmeden silinmez (kaç harcama olduğunu söyler)', async () => {
    expect(await as(A, () => errorOf(deleteCategory('spor')))).toMatch(/2 harcama var/)
    expect(await as(A, keysOf)).toContain('spor')
  })

  it('hedef kendisi ya da olmayan bir kategori olamaz', async () => {
    expect(await as(A, () => errorOf(deleteCategory('spor', 'spor')))).toMatch(/taşınamaz/)
    expect(await as(A, () => errorOf(deleteCategory('spor', 'yok')))).toMatch(/Hedef kategori bulunamadı/)
  })

  it('taşı ve sil: harcamalar hedefe taşınır, sonra kategori silinir', async () => {
    expect(await as(A, () => deleteCategory('spor', 'halisaha'))).toBe(2)
    expect(await as(A, keysOf)).not.toContain('spor')
    expect(await as(A, expensesByCategory)).toEqual([{ category: 'halisaha', n: 3 }])
  })

  it('başka kullanıcının harcamalarına ve kategorilerine dokunmaz', async () => {
    expect(await as(B, expensesByCategory)).toEqual([{ category: 'halisaha', n: 1 }])
    expect(await as(B, keysOf)).toContain('halisaha')
  })

  it('RLS: başka kullanıcının kategorisi "bulunamadı" olur; hedef olarak da kullanılamaz', async () => {
    await as(B, () => q(`insert into public.categories (key, label, type, color) values ('b-ozel', 'B özel', 'yari', '#17A2B8')`))
    expect(await as(A, () => errorOf(deleteCategory('b-ozel')))).toMatch(/Kategori bulunamadı/)
    expect(await as(A, () => errorOf(deleteCategory('halisaha', 'b-ozel')))).toMatch(/Hedef kategori bulunamadı/)
    expect(await as(B, keysOf)).toContain('b-ozel')
  })

  it('RLS: başka kullanıcının kategorileri okunamaz, güncellenemez', async () => {
    const seen = await as(A, () => q<{ key: string }>(`select key from public.categories where key = 'b-ozel'`))
    expect(seen).toEqual([])
    await as(A, () => q(`update public.categories set label = 'hack' where key = 'b-ozel'`))
    const [row] = await as(B, () => q<{ label: string }>(`select label from public.categories where key = 'b-ozel'`))
    expect(row.label).toBe('B özel')
  })

  it('son kategori silinemez', async () => {
    const keys = await as(B, keysOf)
    for (const k of keys.slice(1)) await as(B, () => deleteCategory(k, keys[0]))
    expect(await as(B, () => errorOf(deleteCategory(keys[0])))).toMatch(/En az bir kategori/)
  })

  it('oturumsuz (anon) çağrılamaz', async () => {
    await db.exec('set role anon')
    try {
      expect(await errorOf(deleteCategory('mutfak'))).toMatch(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})
