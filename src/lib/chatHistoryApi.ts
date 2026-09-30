/** Sohbet geçmişi — Supabase işlemleri (RLS: yalnız kullanıcının kendi mesajları). */
import { fromRow, PAGE_SIZE, type ChatMessage, type ChatMessageInsert } from './chatHistory'
import { cachedLoad } from './offlineCache'
import { supabase } from './supabase'

/**
 * Son mesajlar (eskiden yeniye). `before` verilirse o andan önceki sayfa.
 * hasMore: daha eski mesaj olabilir mi.
 */
export function loadMessages(before?: ChatMessage): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  // Son sayfa çevrimdışı gösterim için önbelleğe alınır; eski sayfalar yalnız çevrimiçi.
  return before ? fetchMessages(before) : cachedLoad('chat:latest', () => fetchMessages())
}

async function fetchMessages(before?: ChatMessage): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  let query = supabase
    .from('chat_messages')
    .select('id, role, content, meta, created_at')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(PAGE_SIZE)
  if (before) query = query.lte('created_at', new Date(before.at).toISOString()).neq('id', before.id)
  const { data, error } = await query
  if (error) throw error
  return { messages: data.map(fromRow).reverse(), hasMore: data.length === PAGE_SIZE }
}

/** Yeni ya da değişmiş mesajları yazar; aynı id tekrar gelirse günceller (kopya olmaz). */
export async function upsertMessages(rows: ChatMessageInsert[]): Promise<void> {
  const { error } = await supabase.from('chat_messages').upsert(rows, { onConflict: 'id' })
  if (error) throw error
}
