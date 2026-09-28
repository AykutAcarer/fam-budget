/**
 * Supabase istemcisi (tarayıcı). Yalnızca URL + anon/publishable key kullanır;
 * veri güvenliği veritabanındaki RLS politikalarıyla sağlanır.
 * Gizli anahtarlar (ör. ANTHROPIC_API_KEY) buraya ASLA konmaz.
 */
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Env eksikse kullanıcıya gösterilecek kurulum mesajı; aksi halde null. */
export const supabaseConfigError: string | null =
  !url || !anonKey
    ? 'VITE_SUPABASE_URL ve VITE_SUPABASE_ANON_KEY tanımlı değil. .env.example dosyasını .env.local olarak kopyalayıp doldurun.'
    : null

// Env eksik olsa da modül yüklenebilsin diye yer tutucu değerler; bu durumda
// App yalnızca kurulum ekranını gösterir, istemci hiç kullanılmaz.
export const supabase = createClient<Database>(url ?? 'http://localhost:54321', anonKey ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})
