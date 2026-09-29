/**
 * Sohbetle harcama girişi akışı — React'ten bağımsız, bağımlılıkları dışarıdan
 * verilir (test edilebilir). Bkz. codex_prompt.md §5.2:
 *
 *  1. interpret: metin → chat-expense (parse). Ulaşılamazsa kural tabanlı yedek.
 *     Kategori belirsizse (clarify / needsConfirm) onay adımı döner.
 *  2. saveAndRespond: kaydet (bağlantı yoksa cihazda kuyruğa) → kıyası KODLA
 *     hesapla → chat-expense (reply) hazır rakamlarla motive edici cevap yazar.
 *     Cevapta verilmeyen bir rakam varsa ya da çağrı başarısızsa kodla üretilen
 *     sade özet kullanılır.
 */
import type { ChatContext, ChatResult } from '../../supabase/functions/chat-expense/handler'
import { buildComparison, buildRepeat, type BudgetData } from './budget'
import type { Comparison } from './compare'
import { replyIsGrounded, summaryText, type SavedItem } from './chatText'
import { fallbackParse, rulesFor } from './fallbackParser'
import type { NewExpense } from './outbox'
import type { RepeatInfo } from './repeat'

export type ItemSource = 'ai' | 'fallback'

export interface ConfirmItem extends NewExpense {
  needsConfirm: boolean
}

export interface PendingConfirm {
  text: string
  question: string
  expenses: ConfirmItem[]
  source: ItemSource
}

export type InterpretResult =
  | { kind: 'message'; text: string }
  | { kind: 'confirm'; pending: PendingConfirm }
  | { kind: 'save'; items: NewExpense[]; source: ItemSource; unmatched: boolean }

export interface BotReply {
  text: string
  author: 'ai' | 'kod'
  queued: boolean
  items: NewExpense[]
}

export interface FlowEnv {
  today: string
  context: ChatContext
  labels: ReadonlyMap<string, string>
  data: BudgetData | null
}

export interface FlowDeps {
  parseWithAI: (text: string, context: ChatContext) => Promise<ChatResult>
  replyWithAI: (
    text: string,
    context: ChatContext,
    comparison: Comparison | null,
    saved: SavedItem[],
    repeat: RepeatInfo | null,
  ) => Promise<string>
  saveExpenses: (items: NewExpense[]) => Promise<{ queued: boolean }>
  /** Kayıttan sonra güncel veri (hata olursa null). */
  reload: () => Promise<BudgetData | null>
  /** Cihazda bekleyen (henüz gönderilmemiş) kalemler. */
  pendingOutbox: () => NewExpense[]
  newId: () => string
}

const toItem = ({ id, amount, category, date, description }: NewExpense): NewExpense => ({ id, amount, category, date, description })

export async function interpret(text: string, env: FlowEnv, deps: FlowDeps): Promise<InterpretResult> {
  let result: ChatResult
  let source: ItemSource = 'ai'
  let unmatched = false
  try {
    result = await deps.parseWithAI(text, env.context)
  } catch {
    // Yapay zekaya ulaşılamadı (çevrimdışı, zaman aşımı, sunucu hatası): yedek parser.
    source = 'fallback'
    const fb = fallbackParse(text, env.today, rulesFor(env.context.categories))
    if (!fb) return { kind: 'message', text: 'Tutarı anlayamadım 🤔 Şöyle yazabilirsin: “8,25 halısaha”.' }
    unmatched = !fb.matched
    result = {
      expenses: [{ ...fb, description: fb.description || (env.labels.get(fb.category) ?? fb.category), needsConfirm: false }],
      reply: '',
      clarify: null,
    }
  }

  if (!result.expenses.length) {
    return { kind: 'message', text: result.reply || 'Bir harcama bulamadım. Tutarla birlikte yazar mısın? ör. “8,25 halısaha”' }
  }

  const items: ConfirmItem[] = result.expenses.map((e) => ({
    id: deps.newId(),
    amount: e.amount,
    category: e.category,
    date: e.date,
    description: e.description,
    needsConfirm: e.needsConfirm,
  }))
  if (result.clarify || items.some((i) => i.needsConfirm)) {
    return {
      kind: 'confirm',
      pending: { text, question: result.clarify ?? 'Kategoriden emin olamadım. Doğru mu?', expenses: items, source },
    }
  }
  return { kind: 'save', items: items.map(toItem), source, unmatched }
}

export async function saveAndRespond(
  text: string,
  rawItems: NewExpense[],
  source: ItemSource,
  unmatched: boolean,
  env: FlowEnv,
  deps: FlowDeps,
): Promise<BotReply> {
  const items = rawItems.map(toItem)
  const { queued } = await deps.saveExpenses(items)

  const fresh = queued ? env.data : ((await deps.reload()) ?? env.data)
  const comparison = fresh
    ? buildComparison(fresh, env.today, { pending: deps.pendingOutbox(), category: items[0]?.category })
    : null
  // Tekrar bilgisi ve hatırlatma kararı kodda; yapay zeka yalnız cümleyi yazar.
  const repeat = fresh && items[0] ? buildRepeat(fresh, env.today, items[0].category, deps.pendingOutbox()) : null

  const saved: SavedItem[] = items.map(({ amount, category, date, description }) => ({ amount, category, date, description }))
  let reply: string | null = null
  if (source === 'ai' && !queued) {
    try {
      const candidate = await deps.replyWithAI(text, env.context, comparison, saved, repeat)
      // Yapay zeka matematik yapmaz: verilmeyen bir rakam yazdıysa cevabı kullanma.
      if (replyIsGrounded(candidate, saved, comparison, repeat)) reply = candidate
    } catch {
      // Motive edici cümle yazılamadı; sade özet yeterli.
    }
  }

  return {
    text: reply ?? summaryText(saved, comparison, { today: env.today, labels: env.labels, queued, unmatched }),
    author: reply ? 'ai' : 'kod',
    queued,
    items,
  }
}
