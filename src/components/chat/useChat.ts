/**
 * Sohbet durumu (mesajlar, onay bekleyen kalemler, çevrimdışı kuyruk).
 * Akışın kendisi src/lib/chatFlow.ts'te (React'ten bağımsız, testli).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_CATEGORIES } from '../../../supabase/functions/_shared/categories'
import type { BudgetData } from '../../lib/budget'
import { parseWithAI, replyWithAI } from '../../lib/chatApi'
import { interpret, saveAndRespond, type FlowDeps, type FlowEnv, type ItemSource, type PendingConfirm } from '../../lib/chatFlow'
import type { SavedItem } from '../../lib/chatText'
import { deleteExpenses, flushOutbox, isNetworkError, saveExpenses } from '../../lib/expensesApi'
import { readOutbox, type NewExpense } from '../../lib/outbox'

export type { PendingConfirm }

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

type BotFields = Omit<Extract<ChatMessage, { role: 'bot' }>, 'id' | 'at' | 'role'>

const MAX_STORED = 50
const storageKey = (userId: string) => `butcem:chat:${userId}`

function loadMessages(userId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as ChatMessage[]) : []
  } catch {
    return []
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
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(userId))
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const [busy, setBusy] = useState(false)
  const [outbox, setOutbox] = useState<NewExpense[]>(() => readOutbox(userId))

  // Kalıcı sohbet geçmişi (cihaza özel).
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(messages.slice(-MAX_STORED)))
    } catch {
      // Depolama kapalıysa geçmiş yalnızca bu oturumda kalır.
    }
  }, [messages, userId])

  const categories = useMemo(
    () =>
      data?.categories.length
        ? data.categories.map((c) => ({ key: c.key, label: c.label }))
        : DEFAULT_CATEGORIES.map(({ key, label }) => ({ key, label })),
    [data],
  )
  const labels = useMemo(() => new Map(categories.map((c) => [c.key, c.label])), [categories])

  const dataRef = useRef(data)
  dataRef.current = data

  const push = useCallback((fields: BotFields) => {
    setMessages((m) => [...m, { id: newId(), at: Date.now(), role: 'bot', ...fields }])
  }, [])

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
        setMessages((m) => m.map((x) => (x.role === 'bot' && x.queued ? { ...x, queued: false } : x)))
        await reload()
      }
    } catch {
      // Hâlâ çevrimdışı; bir sonraki fırsatta tekrar denenecek.
    }
  }, [userId, reload])

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
      setMessages((m) => [...m, { id: newId(), at: Date.now(), role: 'user', text }])
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
    [busy, pending, env, deps, push, commit],
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
      setMessages((m) =>
        m.map((x) =>
          x.id === messageId && x.role === 'bot' ? { ...x, expenses: x.expenses?.map((e) => ({ ...e, undone: true })) } : x,
        ),
      )
      await reload()
    },
    [messages, userId, push, reload],
  )

  return { messages, pending, busy, outbox, categories, labels, send, confirm, cancel, undo }
}
