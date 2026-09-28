/**
 * chat-expense Edge Function çağrıları. Başarısızlıkta hata fırlatır; çağıran
 * taraf kural tabanlı yedeğe (fallbackParser) düşer.
 */
import type {
  ChatContext,
  ChatResult,
  ComparisonPayload,
  SavedExpense,
} from '../../supabase/functions/chat-expense/handler'
import type { Comparison } from './compare'
import { supabase } from './supabase'

export type { ChatContext, ChatResult, ParsedExpense } from '../../supabase/functions/chat-expense/handler'

const TIMEOUT_MS = 15_000

async function invokeChat(body: Record<string, unknown>): Promise<ChatResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline')
  const { data, error } = await supabase.functions.invoke<ChatResult>('chat-expense', { body, timeout: TIMEOUT_MS })
  if (error) throw error
  if (!data || !Array.isArray(data.expenses) || typeof data.reply !== 'string') throw new Error('Beklenmeyen cevap')
  return data
}

/** 1. çağrı: yalnızca yapılandırma (kıyas rakamı gönderilmez). */
export function parseWithAI(message: string, context: ChatContext): Promise<ChatResult> {
  return invokeChat({ mode: 'parse', message, context })
}

/** Kodla hesaplanmış kıyası Edge Function'ın beklediği biçime çevirir. */
export function toComparisonPayload(c: Comparison | null): ComparisonPayload | null {
  if (!c) return null
  return {
    cycleDay: c.cycleDay,
    dortluBuAy: c.dortluBuAy,
    dortluBazAy: c.dortluBazAy,
    fark: c.fark,
    kategoriBuAy: c.kategori?.buAy ?? null,
    kategoriBazAyTumAy: c.kategori?.bazAyTumAy ?? null,
  }
}

/** 2. çağrı: hazır rakamlarla motive edici cevap. */
export async function replyWithAI(
  message: string,
  context: ChatContext,
  comparison: Comparison | null,
  saved: SavedExpense[],
): Promise<string> {
  const result = await invokeChat({
    mode: 'reply',
    message,
    context: { ...context, comparison: toComparisonPayload(comparison), saved },
  })
  if (!result.reply.trim()) throw new Error('Boş cevap')
  return result.reply.trim()
}
