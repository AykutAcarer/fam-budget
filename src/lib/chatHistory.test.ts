import { describe, expect, it } from 'vitest'
import {
  changedMessages,
  chatQueueKey,
  enqueueMessages,
  fromRow,
  legacyChatKey,
  mergeMessages,
  migrateLegacyHistory,
  nextAt,
  readChatQueue,
  splitRecent,
  syncChatQueue,
  toRow,
  type BotMessage,
  type ChatMessage,
  type ChatMessageInsert,
  type KeyValueStore,
} from './chatHistory'

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}
const U = 'user-1'
const user = (id: string, at: number, text = id): ChatMessage => ({ id, role: 'user', text, at })
const bot = (id: string, at: number, extra: Partial<BotMessage> = {}): BotMessage => ({ id, role: 'bot', text: `cevap ${id}`, at, ...extra })

describe('satır ↔ mesaj', () => {
  it('kullanıcı mesajı gidiş-dönüş', () => {
    const m = user('a', Date.parse('2026-09-28T10:00:00.000Z'), '8,25 halısaha')
    const row = toRow(m)
    expect(row).toEqual({ id: 'a', role: 'user', content: '8,25 halısaha', meta: {}, related_expense_id: null, created_at: '2026-09-28T10:00:00.000Z' })
    expect(fromRow(row)).toEqual(m)
  })

  it('asistan mesajı: ekler meta\'da, ilk harcama related_expense_id', () => {
    const expenses = [
      { id: 'e1', amount: 8.25, category: 'halisaha', date: '2026-09-28', description: 'halısaha' },
      { id: 'e2', amount: 2, category: 'is', date: '2026-09-28', description: 'kahve', undone: true },
    ]
    const m = bot('b', Date.parse('2026-09-28T10:00:01.000Z'), { expenses, author: 'ai', queued: true, tone: 'info' })
    const row = toRow(m)
    expect(row.role).toBe('assistant')
    expect(row.related_expense_id).toBe('e1')
    expect(row.meta).toEqual({ tone: 'info', expenses, queued: true, author: 'ai' })
    expect(fromRow(row)).toEqual(m)
  })

  it('bilinmeyen meta alanları yok sayılır', () => {
    expect(fromRow({ id: 'x', role: 'assistant', content: 'c', meta: { tone: 'kırmızı', author: 'x', queued: 'evet' }, created_at: '2026-09-28T10:00:00Z' })).toEqual({
      id: 'x', role: 'bot', text: 'c', at: Date.parse('2026-09-28T10:00:00Z'),
    })
  })
})

describe('sıralama ve birleştirme', () => {
  it('zamana, eşitse id\'ye göre; aynı id tek mesaj ve sonraki liste kazanır', () => {
    const server = [user('b', 2), bot('c', 3)]
    const local = [bot('c', 3, { queued: false, text: 'yeni' }), user('a', 2), user('d', 1)]
    const merged = mergeMessages(server, local)
    expect(merged.map((m) => m.id)).toEqual(['d', 'a', 'b', 'c'])
    expect(merged.find((m) => m.id === 'c')?.text).toBe('yeni')
  })

  it('nextAt sırayı korur', () => {
    expect(nextAt([user('a', 1000)], 999)).toBe(1001)
    expect(nextAt([user('a', 1000)], 5000)).toBe(5000)
    expect(nextAt([], 7)).toBe(7)
  })

  it('changedMessages yalnız yeni / değişenleri döner', () => {
    const a = user('a', 1)
    const b = bot('b', 2)
    const b2 = { ...b, text: 'değişti' }
    expect(changedMessages([a, b], [a, b2, user('c', 3)]).map((m) => m.id)).toEqual(['b', 'c'])
    expect(changedMessages([a, b], [a, b])).toEqual([])
  })
})

describe('çevrimdışı kuyruk', () => {
  it('kullanıcıya özel anahtar; aynı id güncellenir, kopyalanmaz', () => {
    const store = memStore()
    enqueueMessages(store, U, [user('a', 1)])
    enqueueMessages(store, U, [user('a', 1, 'düzeltildi'), bot('b', 2)])
    expect(readChatQueue(store, U).map((m) => [m.id, m.text])).toEqual([['a', 'düzeltildi'], ['b', 'cevap b']])
    expect(readChatQueue(store, 'başka')).toEqual([])
    expect([...store.data.keys()]).toEqual([chatQueueKey(U)])
  })

  it('bağlantı yoksa kuyruk kalır; gelince gönderilir ve boşalır', async () => {
    const store = memStore()
    enqueueMessages(store, U, [user('a', 1), bot('b', 2)])
    const offline = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(syncChatQueue(store, U, offline)).rejects.toThrow()
    expect(readChatQueue(store, U)).toHaveLength(2)

    const sent: ChatMessageInsert[][] = []
    expect(await syncChatQueue(store, U, async (rows) => void sent.push(rows))).toBe(2)
    expect(sent[0].map((r) => r.id)).toEqual(['a', 'b'])
    expect(readChatQueue(store, U)).toEqual([])
    expect(store.data.has(chatQueueKey(U))).toBe(false)
  })

  it('tekrar gönderim kopya üretmez (upsert id ile)', async () => {
    const store = memStore()
    const server = new Map<string, ChatMessageInsert>()
    const upsert = async (rows: ChatMessageInsert[]) => rows.forEach((r) => server.set(r.id, r))
    enqueueMessages(store, U, [user('a', 1)])
    // Yanıt kaybolmuş gibi: sunucuya yazıldı ama kuyruk temizlenmeden hata
    await expect(
      syncChatQueue(store, U, async (rows) => {
        await upsert(rows)
        throw new Error('bağlantı koptu')
      }),
    ).rejects.toThrow()
    await syncChatQueue(store, U, upsert)
    expect([...server.keys()]).toEqual(['a'])
  })

  it('gönderim sırasında değişen mesaj kuyrukta kalır', async () => {
    const store = memStore()
    const b = bot('b', 2, { queued: true })
    enqueueMessages(store, U, [user('a', 1), b])
    await syncChatQueue(store, U, async () => {
      enqueueMessages(store, U, [{ ...b, queued: false }])
    })
    expect(readChatQueue(store, U)).toEqual([{ ...b, queued: false }])
  })

  it('eski cihaz geçmişi bir kez kuyruğa aktarılır', () => {
    const store = memStore()
    store.setItem(legacyChatKey(U), JSON.stringify([user('a', 1), bot('b', 2)]))
    expect(migrateLegacyHistory(store, U)).toBe(2)
    expect(store.data.has(legacyChatKey(U))).toBe(false)
    expect(readChatQueue(store, U).map((m) => m.id)).toEqual(['a', 'b'])
    expect(migrateLegacyHistory(store, U)).toBe(0)
    expect(readChatQueue(store, U)).toHaveLength(2)
  })

  it('bozuk depo içeriği boş sayılır', () => {
    const store = memStore()
    store.setItem(chatQueueKey(U), '{bozuk')
    expect(readChatQueue(store, U)).toEqual([])
  })
})

describe('katlanmış görünüm (son alışveriş)', () => {
  const ids = (list: readonly ChatMessage[]) => list.map((m) => m.id)

  it('boş ve tek çift: gizlenecek eski mesaj yok', () => {
    expect(splitRecent([])).toEqual({ older: [], recent: [] })
    const one = [user('u1', 1), bot('b1', 2)]
    expect(ids(splitRecent(one).older)).toEqual([])
    expect(ids(splitRecent(one).recent)).toEqual(['u1', 'b1'])
  })

  it('son kullanıcı mesajı ve cevapları görünür, öncekiler gizli', () => {
    const list = [user('u1', 1), bot('b1', 2), user('u2', 3), bot('b2', 4), user('u3', 5), bot('b3', 6)]
    const { older, recent } = splitRecent(list)
    expect(ids(older)).toEqual(['u1', 'b1', 'u2', 'b2'])
    expect(ids(recent)).toEqual(['u3', 'b3'])
  })

  it('son mesaja birden çok cevap geldiyse hepsi görünür', () => {
    const { older, recent } = splitRecent([user('u1', 1), bot('b1', 2), user('u2', 3), bot('b2', 4), bot('b3', 5)])
    expect(ids(older)).toEqual(['u1', 'b1'])
    expect(ids(recent)).toEqual(['u2', 'b2', 'b3'])
  })

  it('yeni gönderilen, henüz cevapsız mesaj tek başına son alışveriştir', () => {
    const { older, recent } = splitRecent([user('u1', 1), bot('b1', 2), user('u2', 3)])
    expect(ids(older)).toEqual(['u1', 'b1'])
    expect(ids(recent)).toEqual(['u2'])
  })

  it('kullanıcı mesajı yoksa yalnız son mesaj görünür', () => {
    const { older, recent } = splitRecent([bot('b1', 1), bot('b2', 2)])
    expect(ids(older)).toEqual(['b1'])
    expect(ids(recent)).toEqual(['b2'])
  })
})
