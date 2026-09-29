/**
 * Sohbet geçmişi — mesaj modeli, veritabanı satırına çeviri, birleştirme ve
 * çevrimdışı gönderim kuyruğu (saf; depolama dışarıdan verilir, testli).
 *
 * Kaynak veritabanıdır (chat_messages). Cihazda yalnızca henüz gönderilmemiş
 * (yeni ya da değişmiş) mesajlar kuyrukta durur; gönderim id üzerinden upsert
 * olduğundan tekrar denemek kopya üretmez.
 */
import type { ChatMessageRow } from './database.types'
import type { SavedItem } from './chatText'

export interface BotExpense extends SavedItem {
  id: string
  undone?: boolean
}

export type ChatMessage =
  | { id: string; role: 'user'; text: string; at: number }
  | {
      id: string
      role: 'bot'
      text: string
      at: number
      tone?: 'info' | 'error'
      expenses?: BotExpense[]
      /** Cihazda bekliyor (henüz sunucuda değil). */
      queued?: boolean
      /** Cevabı kim yazdı: yapay zeka mı, kod mu? */
      author?: 'ai' | 'kod'
    }

export type BotMessage = Extract<ChatMessage, { role: 'bot' }>

export const PAGE_SIZE = 50

// ---------------------------------------------------------------------------
// Satır ↔ mesaj
// ---------------------------------------------------------------------------

export type ChatMessageInsert = Pick<ChatMessageRow, 'id' | 'role' | 'content' | 'meta' | 'related_expense_id' | 'created_at'>

export function toRow(m: ChatMessage): ChatMessageInsert {
  const base = { id: m.id, content: m.text.slice(0, 4000), created_at: new Date(m.at).toISOString() }
  if (m.role === 'user') return { ...base, role: 'user', meta: {}, related_expense_id: null }
  const meta: Record<string, unknown> = {}
  if (m.tone) meta.tone = m.tone
  if (m.expenses?.length) meta.expenses = m.expenses
  if (m.queued) meta.queued = true
  if (m.author) meta.author = m.author
  return { ...base, role: 'assistant', meta, related_expense_id: m.expenses?.[0]?.id ?? null }
}

export function fromRow(row: Pick<ChatMessageRow, 'id' | 'role' | 'content' | 'meta' | 'created_at'>): ChatMessage {
  const at = Date.parse(row.created_at)
  if (row.role === 'user') return { id: row.id, role: 'user', text: row.content, at }
  const meta = (row.meta ?? {}) as Record<string, unknown>
  const msg: BotMessage = { id: row.id, role: 'bot', text: row.content, at }
  if (meta.tone === 'info' || meta.tone === 'error') msg.tone = meta.tone
  if (Array.isArray(meta.expenses)) msg.expenses = meta.expenses as BotExpense[]
  if (meta.queued === true) msg.queued = true
  if (meta.author === 'ai' || meta.author === 'kod') msg.author = meta.author
  return msg
}

/** Zaman, eşitse id sırası (veritabanıyla aynı: created_at, id). */
export function compareMessages(a: ChatMessage, b: ChatMessage): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Sunucudan gelenlerle cihazdakileri birleştirir: aynı id tek mesaj olur;
 * cihazdaki (henüz gönderilmemiş) sürüm daha yenidir, o kazanır.
 */
export function mergeMessages(...lists: readonly (readonly ChatMessage[])[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const list of lists) for (const m of list) byId.set(m.id, m)
  return [...byId.values()].sort(compareMessages)
}

/** Sıra bozulmasın diye zaman damgası öncekinden büyük olur. */
export function nextAt(previous: readonly ChatMessage[], now: number): number {
  const last = previous.length ? previous[previous.length - 1].at : 0
  return Math.max(now, last + 1)
}

/** Güncellemeden sonra değişen mesajlar (referans karşılaştırması). */
export function changedMessages(before: readonly ChatMessage[], after: readonly ChatMessage[]): ChatMessage[] {
  const old = new Map(before.map((m) => [m.id, m]))
  return after.filter((m) => old.get(m.id) !== m)
}

// ---------------------------------------------------------------------------
// Gönderim kuyruğu (kullanıcıya özel)
// ---------------------------------------------------------------------------

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const chatQueueKey = (userId: string) => `butcem:chat-queue:${userId}`
/** Eski sürümün cihaza özel geçmişi — bir kez kuyruğa aktarılıp silinir. */
export const legacyChatKey = (userId: string) => `butcem:chat:${userId}`

function readList(store: KeyValueStore, key: string): ChatMessage[] {
  try {
    const raw = store.getItem(key)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as ChatMessage[]).filter((m) => m && typeof m.id === 'string') : []
  } catch {
    return []
  }
}

export function readChatQueue(store: KeyValueStore, userId: string): ChatMessage[] {
  return readList(store, chatQueueKey(userId))
}

function writeQueue(store: KeyValueStore, userId: string, list: readonly ChatMessage[]) {
  try {
    if (list.length) store.setItem(chatQueueKey(userId), JSON.stringify(list))
    else store.removeItem(chatQueueKey(userId))
  } catch {
    // Depolama kapalıysa kuyruk yalnızca bellekte; bu oturumda yine gönderilir.
  }
}

/** Mesajları kuyruğa koyar (aynı id'nin eski sürümünü değiştirir). */
export function enqueueMessages(store: KeyValueStore, userId: string, messages: readonly ChatMessage[]): void {
  if (!messages.length) return
  writeQueue(store, userId, mergeMessages(readChatQueue(store, userId), messages))
}

/** Eski (yalnız bu cihazdaki) geçmişi bir kez kuyruğa aktarır; aktarılan sayıyı döner. */
export function migrateLegacyHistory(store: KeyValueStore, userId: string): number {
  const legacy = readList(store, legacyChatKey(userId))
  try {
    store.removeItem(legacyChatKey(userId))
  } catch {
    // yoksay
  }
  enqueueMessages(store, userId, legacy)
  return legacy.length
}

/**
 * Kuyruğu gönderir. Gönderim sırasında değişen mesaj (ör. geri alındı) kuyrukta
 * kalır ve bir sonraki turda gönderilir. Gönderilen mesaj sayısını döner;
 * bağlantı yoksa hata fırlatır ve kuyruk olduğu gibi kalır.
 */
export async function syncChatQueue(
  store: KeyValueStore,
  userId: string,
  upsert: (rows: ChatMessageInsert[]) => Promise<void>,
): Promise<number> {
  const queue = readChatQueue(store, userId)
  if (!queue.length) return 0
  await upsert(queue.map(toRow))
  const sent = new Map(queue.map((m) => [m.id, JSON.stringify(m)]))
  writeQueue(
    store,
    userId,
    readChatQueue(store, userId).filter((m) => sent.get(m.id) !== JSON.stringify(m)),
  )
  return queue.length
}
