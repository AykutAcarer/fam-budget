/**
 * Oturum durumu. Supabase oturumunu dinler ve uygulamaya sağlar.
 */
import type { Session } from '@supabase/supabase-js'
import { createContext, use, useEffect, useState, type ReactNode } from 'react'
import { supabase, supabaseConfigError } from '../lib/supabase'

interface AuthState {
  session: Session | null
  /** İlk oturum kontrolü sürüyor mu? */
  loading: boolean
}

const AuthContext = createContext<AuthState>({ session: null, loading: true })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: !supabaseConfigError })

  useEffect(() => {
    if (supabaseConfigError) return
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, loading: false }))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setState({ session, loading: false }))
    return () => data.subscription.unsubscribe()
  }, [])

  return <AuthContext value={state}>{children}</AuthContext>
}

export function useAuth(): AuthState {
  return use(AuthContext)
}

/** Supabase auth hata mesajlarını Türkçeye çevirir. */
export function authErrorMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.'
  if (m.includes('user already registered')) return 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene.'
  if (m.includes('email not confirmed')) return 'E-posta adresin henüz doğrulanmadı. Gelen kutunu kontrol et.'
  if (m.includes('password should be at least')) return 'Şifre en az 6 karakter olmalı.'
  if (m.includes('unable to validate email') || m.includes('invalid email')) return 'Geçerli bir e-posta adresi gir.'
  if (m.includes('rate limit')) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'
  return message
}
