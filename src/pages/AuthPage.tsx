/**
 * Giriş / Kayıt Ol ekranı (e-posta + şifre, Supabase Auth).
 */
import { useState, type FormEvent } from 'react'
import { authErrorMessage } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

type Mode = 'login' | 'register'

const inputClass =
  'mt-1 block w-full rounded-xl border-0 bg-slate-100 px-4 py-3 text-base text-slate-900 ring-1 ring-transparent placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900'

export function AuthPage() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setInfo(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) setError(authErrorMessage(error.message))
        // Başarılıysa AuthProvider oturumu yakalar ve yönlendirme otomatik olur.
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) setError(authErrorMessage(error.message))
        else if (!data.session) {
          // Projede e-posta doğrulaması açıksa oturum hemen açılmaz.
          setInfo('Hesabın oluşturuldu! E-postana gelen bağlantıyla adresini doğrula, sonra giriş yap.')
          setMode('login')
        }
      }
    } catch (err) {
      setError(authErrorMessage(err instanceof Error ? err.message : String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white shadow-sm">
            €
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Bütçem</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ailenin bütçesi, tek bir sohbette.</p>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-900/5 dark:bg-slate-900 dark:ring-white/10">
          <div role="tablist" className="mb-5 grid grid-cols-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(
              [
                ['login', 'Giriş'],
                ['register', 'Kayıt Ol'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                  mode === m
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block text-sm font-medium">
              E-posta
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="ornek@eposta.com"
              />
            </label>
            <label className="block text-sm font-medium">
              Şifre
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder={mode === 'register' ? 'En az 6 karakter' : '••••••'}
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-emerald-600 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? 'Bekle…' : mode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
