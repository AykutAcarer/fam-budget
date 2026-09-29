/**
 * Sohbet durumu (mesajlar, onay bekleyen kalemler, çevrimdışı kuyruk).
 * Akışın kendisi src/lib/chatFlow.ts'te (React'ten bağımsız, testli).
 *
 * Geçmiş veritabanında (chat_messages) — cihazlar arası. Her yeni ya da değişen
 * mesaj önce cihazdaki gönderim kuyruğuna yazılır, sonra upsert edilir; bağlantı
 * yoksa kuyrukta bekler ve bağlantı gelince (kopya olmadan) gönderilir.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CATEGORIES } from '../../../supabase/functions/_shared/categories'
import type { BudgetData } from '../../lib/budget'
import { parseWithAI, replyWithAI } from '../../lib/chatApi'
import { interpret, saveAndRespond, type FlowDeps, type FlowEnv, type ItemSource, type PendingConfirm } from '../../lib/chatFlow'
import {
  changedMessages,
  enqueueMessages,
  mergeMessages,
  migrateLegacyHistory,
  nextAt,
  readChatQueue,
  syncChatQueue,
  type BotMessage,
  type ChatMessage,
  type KeyValueStore,
} from '../../lib/chatHistory'
import { loadMessages, upsertMessages } from '../../lib/chatHistoryApi'
import { deleteExpenses, flushOutbox, isNetworkError, saveExpenses } from '../../lib/expensesApi'
import { readOutbox, type NewExpense } from '../../lib/outbox'

export type { PendingConfirm }
export type { BotExpense, ChatMessage } from '../../lib/chatHistory'

type BotFields = Omit<BotMessage, 'id' | 'at' | 'role'>

/** localStorage erişimi bazı ortamlarda hata fırlatır; o durumda bellek içi depo. */
function browserStore(): KeyValueStore {
  try {
    const ls = window.localStorage
    ls.getItem('butcem:probe')
    return ls
  } catch {
    const mem = new Map<string, string>()
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }
  }
}

const newId = () => crypto.randomUUID()
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)

export function useChat(params: {
  userId: string
  today: string
  data: BudgetData | null
  reload: () => Promise<BudgetData | null>
}) {
  const { userId, today, data, reload } = params
  const store = useMemo(browserStore, [])
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    migrateLegacyHistory(store, userId)
    return readChatQueue(store, userId)
  })
  const messagesRef = useRef(messages)
  const [history, setHistory] = useState({ loading: true, hasMore: false, error: false })
  /** Gönderilemeyen (son denemesi başarısız) mesaj sayısı; gönderim sürerken 0 kalır. */
  const [chatQueue, setChatQueue] = useState(0)
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [outbox, setOutbox] = useState<NewExpense[]>(() => readOutbox(userId))

  // Kuyruktaki mesajları gönder (aynı anda tek gönderim; arada gelen değişiklik bir tur daha).
  const syncState = useRef({ running: false, again: false })
  const syncChat = useCallback(async () => {
    const st = syncState.current
    if (st.running) {
      st.again = true
      return
    }
    st.running = true
    let failed = false
    try {
      do {
        st.again = false
        try {
          await syncChatQueue(store, userId, upsertMessages)
        } catch {
          // Bağlantı yok; bağlantı gelince tekrar denenir.
          failed = true
          break
        }
      } while (st.again)
    } finally {
      st.running = false
      setChatQueue(failed ? readChatQueue(store, userId).length : 0)
    }
  }, [store, userId])

  /** Mesaj listesini günceller; yeni / değişen mesajlar kuyruğa girer ve gönderilir. */
  const apply = useCallback(
    (update: (list: ChatMessage[]) => ChatMessage[]) => {
      const before = messagesRef.current
      const after = update(before)
      messagesRef.current = after
      setMessages(after)
      const changed = changedMessages(before, after)
      if (changed.length) {
        enqueueMessages(store, userId, changed)
        void syncChat()
      }
    },
    [store, userId, syncChat],
  )

  // Açılışta: son mesajlar sunucudan (kuyruktakilerle birleşik) + bekleyenleri gönder.
  useEffect(() => {
    let alive = true
    void syncChat()
    loadMessages()
      .then(({ messages: server, hasMore }) => {
        if (!alive) return
        const merged = mergeMessages(server, messagesRef.current, readChatQueue(store, userId))
        messagesRef.current = merged
        setMessages(merged)
        setHistory({ loading: false, hasMore, error: false })
      })
      .catch(() => alive && setHistory({ loading: false, hasMore: false, error: true }))
    window.addEventListener('online', syncChat)
    return () => {
      alive = false
      window.removeEventListener('online', syncChat)
    }
  }, [store, userId, syncChat])

  /** Daha eski mesajları yükler. */
  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0]
    if (!oldest) return
    setHistory((h) => ({ ...h, loading: true }))
    try {
      const { messages: older, hasMore } = await loadMessages(oldest)
      const merged = mergeMessages(older, messagesRef.current)
      messagesRef.current = merged
      setMessages(merged)
      setHistory({ loading: false, hasMore, error: false })
    } catch {
      setHistory((h) => ({ ...h, loading: false, error: true }))
    }
  }, [])

  const categories = useMemo(
    () =>
      data?.categories.length
        ? data.categories.map((c) => ({ key: c.key, label: c.label, keywords: c.keywords ?? [] }))
        : DEFAULT_CATEGORIES.map(({ key, label, keywords }) => ({ key, label, keywords: [...keywords] })),
    [data],
  )
  const labels = useMemo(() => new Map(categories.map((c) => [c.key, c.label])), [categories])

  const dataRef = useRef(data)
  dataRef.current = data

  const push = useCallback(
    (fields: BotFields) => apply((m) => [...m, { id: newId(), at: nextAt(m, Date.now()), role: 'bot', ...fields }]),
    [apply],
  )

  const env = useCallback(
    (): FlowEnv => ({
      today,
      context: { today, cycle: dataRef.current?.active.window, categories },
      labels,
      data: dataRef.current,
    }),
    [today, categories, labels],
  )

  const deps = useMemo(
    (): FlowDeps => ({
      parseWithAI,
      replyWithAI,
      saveExpenses: async (items) => {
        const res = await saveExpenses(userId, items)
        setOutbox(readOutbox(userId))
        return res
      },
      reload,
      pendingOutbox: () => readOutbox(userId),
      newId,
    }),
    [userId, reload],
  )

  // Kuyruktaki harcamaları açılışta ve bağlantı gelince gönder.
  const flush = useCallback(async () => {
    if (!readOutbox(userId).length) return
    try {
      const sent = await flushOutbox(userId)
      setOutbox(readOutbox(userId))
      if (sent) {
        apply((m) => m.map((x) => (x.role === 'bot' && x.queued ? { ...x, queued: false } : x)))
        await reload()
      }
    } catch {
      // Hâlâ çevrimdışı; bir sonraki fırsatta tekrar denenecek.
    }
  }, [userId, reload, apply])

  useEffect(() => {
    void flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [flush])

  const commit = useCallback(
    async (text: string, items: NewExpense[], source: ItemSource, unmatched: boolean) => {
      try {
        const reply = await saveAndRespond(text, items, source, unmatched, env(), deps)
        push({ text: reply.text, author: reply.author, queued: reply.queued, expenses: reply.items })
      } catch (e) {
        push({ text: `Kaydedemedim: ${errorText(e)}. Tekrar dener misin?`, tone: 'error' })
      }
    },
    [env, deps, push],
  )

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busy || pending) return
      apply((m) => [...m, { id: newId(), at: nextAt(m, Date.now()), role: 'user', text }])
      setBusy(true)
      try {
        const step = await interpret(text, env(), deps)
        if (step.kind === 'message') push({ text: step.text, tone: 'info' })
        else if (step.kind === 'confirm') setPending(step.pending)
        else await commit(text, step.items, step.source, step.unmatched)
      } finally {
        setBusy(false)
      }
    },
    [busy, pending, env, deps, push, commit, apply],
  )

  /** Kullanıcı kategori(ler)i onayladı. */
  const confirm = useCallback(
    async (categoriesById: Record<string, string>) => {
      if (!pending) return
      const items = pending.expenses.map((e) => ({ ...e, category: categoriesById[e.id] ?? e.category }))
      setPending(null)
      setBusy(true)
      try {
        await commit(pending.text, items, pending.source, false)
      } finally {
        setBusy(false)
      }
    },
    [pending, commit],
  )

  const cancel = useCallback(() => {
    setPending(null)
    push({ text: 'Tamam, kaydetmedim.', tone: 'info' })
  }, [push])

  /** Bir cevaptaki kaydedilmiş kalemleri geri al (sil). */
  const undo = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId)
      if (!msg || msg.role !== 'bot' || !msg.expenses?.length) return
      const ids = msg.expenses.filter((e) => !e.undone).map((e) => e.id)
      if (!ids.length) return
      try {
        await deleteExpenses(userId, ids)
      } catch (e) {
        // Kalemler yalnızca kuyruktaysa silme zaten yerelde tamamlandı.
        if (!(msg.queued && isNetworkError(e))) {
          push({ text: `Geri alınamadı: ${errorText(e)}`, tone: 'error' })
          return
        }
      }
      setOutbox(readOutbox(userId))
      apply((m) =>
        m.map((x) =>
          x.id === messageId && x.role === 'bot' ? { ...x, expenses: x.expenses?.map((e) => ({ ...e, undone: true })) } : x,
        ),
      )
      await reload()
    },
    [messages, userId, push, reload, apply],
  )

  return { messages, history, chatQueue, loadOlder, pending, busy, outbox, categories, labels, send, confirm, cancel, undo }
}
