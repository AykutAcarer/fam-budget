/**
 * Sohbet geçmişi — chat_messages: yazma/okuma, sıralama, upsert (kopya yok) ve RLS,
 * gömülü Postgres'te (PGlite) gerçek migration'larla.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { fromRow, toRow, type ChatMessage } from '../../src/lib/chatHistory'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations')
const A = '00000000-0000-0000-0000-0000000000e1'
const B = '00000000-0000-0000-0000-0000000000e2'
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`

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

/** chatHistoryApi.upsertMessages ile aynı: id çakışırsa güncelle. */
const upsert = (m: ChatMessage) => {
  const r = toRow(m)
  return q(
    `insert into public.chat_messages (id, role, content, meta, related_expense_id, created_at) values ($1, $2, $3, $4, $5, $6)
     on conflict (id) do update set role = excluded.role, content = excluded.content, meta = excluded.meta,
       related_expense_id = excluded.related_expense_id, created_at = excluded.created_at`,
    [r.id, r.role, r.content, JSON.stringify(r.meta), r.related_expense_id, r.created_at],
  )
}
type Row = { id: string; role: 'user' | 'assistant'; content: string; meta: Record<string, unknown>; created_at: string }
/** chatHistoryApi.loadMessages ile aynı sorgu: en yeni N, eskiden yeniye çevrilir. */
const latest = async (limit = 50) =>
  (await q<Row>(`select id, role, content, meta, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
                 from public.chat_messages order by created_at desc, id desc limit $1`, [limit])).map(fromRow).reverse()

const T0 = Date.parse('2026-09-28T10:00:00.000Z')

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
})

describe('yazma / okuma', () => {
  const u1: ChatMessage = { id: uuid(1), role: 'user', text: '8,25 halısaha', at: T0 }
  const b1: ChatMessage = {
    id: uuid(2), role: 'bot', text: 'Kaydettim 🎯', at: T0 + 1500, author: 'ai',
    expenses: [{ id: uuid(900), amount: 8.25, category: 'halisaha', date: '2026-09-28', description: 'halısaha' }],
  }

  it('yazılan mesajlar aynen okunur (başka cihaz gibi)', async () => {
    await as(A, async () => {
      await upsert(u1)
      await upsert(b1)
    })
    expect(await as(A, () => latest())).toEqual([u1, b1])
    const [row] = await as(A, () => q<{ related_expense_id: string; user_id: string }>(`select related_expense_id, user_id from public.chat_messages where id = $1`, [b1.id]))
    expect(row).toEqual({ related_expense_id: uuid(900), user_id: A })
  })

  it('aynı mesaj tekrar gönderilirse kopya oluşmaz; değişiklik (geri al) aynı satırı günceller', async () => {
    const undone: ChatMessage = { ...b1, expenses: [{ ...(b1 as Extract<ChatMessage, { role: 'bot' }>).expenses![0], undone: true }] }
    await as(A, async () => {
      await upsert(u1)
      await upsert(undone)
      await upsert(undone)
    })
    const rows = await as(A, () => latest())
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual(undone)
  })

  it('sıralama: created_at, eşitse id; kuyruktan geç gelen mesaj kendi zamanında yer alır', async () => {
    await as(A, async () => {
      await upsert({ id: uuid(5), role: 'user', text: 'aynı an B', at: T0 + 5000 })
      await upsert({ id: uuid(4), role: 'user', text: 'aynı an A', at: T0 + 5000 })
      // Çevrimdışı yazılmış, sonradan gönderilmiş (daha eski zaman damgası)
      await upsert({ id: uuid(3), role: 'user', text: 'çevrimdışıyken', at: T0 + 1000 })
    })
    expect((await as(A, () => latest())).map((m) => m.text)).toEqual(['8,25 halısaha', 'çevrimdışıyken', 'Kaydettim 🎯', 'aynı an A', 'aynı an B'])
  })

  it('son N mesaj gelir (eskiler "daha eski" sayfasında)', async () => {
    expect((await as(A, () => latest(2))).map((m) => m.text)).toEqual(['aynı an A', 'aynı an B'])
  })

  it('geçersiz rol ve çok uzun içerik reddedilir', async () => {
    expect(await as(A, () => errorOf(q(`insert into public.chat_messages (role, content) values ('system', 'x')`)))).toMatch(/check/)
    expect(await as(A, () => errorOf(q(`insert into public.chat_messages (role, content) values ('user', $1)`, ['x'.repeat(4001)])))).toMatch(/check/)
  })
})

describe('RLS', () => {
  it('başka kullanıcı mesajları göremez', async () => {
    expect(await as(B, () => latest())).toEqual([])
  })

  it('başka kullanıcının mesaj id\'siyle upsert edemez, değiştiremez, silemez', async () => {
    expect(await as(B, () => errorOf(upsert({ id: uuid(1), role: 'user', text: 'ele geçir', at: T0 })))).toMatch(/row-level security|duplicate key/)
    await as(B, () => q(`update public.chat_messages set content = 'x'`))
    await as(B, () => q(`delete from public.chat_messages`))
    expect((await as(A, () => latest()))[0].text).toBe('8,25 halısaha')
    expect(await as(A, () => latest())).toHaveLength(5)
  })

  it('başkası adına mesaj yazılamaz', async () => {
    expect(await as(A, () => errorOf(q(`insert into public.chat_messages (user_id, role, content) values ($1, 'user', 'x')`, [B])))).toMatch(/row-level security/)
  })

  it('anon erişemez', async () => {
    await db.exec('set role anon')
    try {
      expect(await errorOf(q(`select * from public.chat_messages`))).toMatch(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})
