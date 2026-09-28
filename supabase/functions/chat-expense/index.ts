/**
 * chat-expense — Supabase Edge Function giriş noktası (Deno).
 *
 * Secret'lar (Supabase Dashboard > Edge Functions > Secrets veya `supabase secrets set`):
 *   ANTHROPIC_API_KEY  — Anthropic API anahtarı (yalnızca burada; istemciye ASLA gitmez)
 *   ANTHROPIC_MODEL    — hızlı bir Haiku sınıfı model, ör. claude-haiku-4-5
 *   ALLOWED_ORIGINS    — CORS izinli origin'ler, virgülle: https://butcem.vercel.app,http://localhost:5173
 *                        (alt alan jokeri: https://fam-budget-*.vercel.app; boşsa yalnız localhost)
 * SUPABASE_URL ve SUPABASE_ANON_KEY platform tarafından otomatik verilir.
 *
 * Asıl mantık handler.ts'te (platformdan bağımsız, testli).
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleRequest } from './handler.ts'
import { SYSTEM_PROMPT } from './system_prompt.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!

/**
 * İsteği yapan kişinin giriş yapmış bir kullanıcı olduğunu doğrular.
 * getClaims JWT imzasını doğrular (asimetrik anahtarlarda JWKS ile, eski
 * HS256 anahtarlarda Auth sunucusuna sorarak). anon rolündeki token'lar reddedilir.
 */
async function verifyUser(req: Request): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  // İstemcinin gönderdiği apikey (publishable/anon) yalnızca Auth API çağrısı için kullanılır.
  const apiKey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const supabase = createClient(SUPABASE_URL, apiKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await supabase.auth.getClaims(token)
  if (error || !data) return null
  const { sub, role } = data.claims
  return role === 'authenticated' && typeof sub === 'string' ? sub : null
}

Deno.serve((req) =>
  handleRequest(req, {
    env: (name) => Deno.env.get(name),
    fetch,
    verifyUser,
    systemPrompt: SYSTEM_PROMPT,
  }),
)
