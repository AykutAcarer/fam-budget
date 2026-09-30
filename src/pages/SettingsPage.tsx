/**
 * Ayarlar: baz ay, kategoriler, tema, veri içe/dışa aktarma, çıkış.
 */
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { BaselineCard } from '../components/BaselineCard'
import { DataTransferCard } from '../components/DataTransferCard'
import { CategoriesCard } from '../components/settings/CategoriesCard'
import { Card, CardTitle, PageHeader } from '../components/ui'
import { supabase } from '../lib/supabase'
import { useTheme, type ThemePref } from '../lib/theme'
import { useReadOnly } from '../lib/useOnline'

const THEMES: [ThemePref, string][] = [
  ['light', 'Açık'],
  ['dark', 'Koyu'],
  ['system', 'Sistem'],
]

export function SettingsPage() {
  const { session } = useAuth()
  const [theme, setTheme] = useTheme()
  const [signingOut, setSigningOut] = useState(false)
  const readOnly = useReadOnly()

  async function signOut() {
    setSigningOut(true)
    await supabase.auth.signOut()
    // AuthProvider oturumun kapandığını yakalar ve giriş ekranına yönlendirir.
  }

  return (
    <>
      <PageHeader title="Ayarlar" subtitle={session?.user.email} />

      <div className="space-y-4">
        <fieldset disabled={readOnly} className="m-0 min-w-0 space-y-4 border-0 p-0">
          <BaselineCard />
          <CategoriesCard />
        </fieldset>

        <Card>
          <CardTitle>Tema</CardTitle>
          <div role="radiogroup" aria-label="Tema" className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {THEMES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={theme === value}
                onClick={() => setTheme(value)}
                className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                  theme === value
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Card>

        <fieldset disabled={readOnly} className="m-0 min-w-0 border-0 p-0">
          <DataTransferCard />
        </fieldset>

        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="w-full rounded-2xl bg-white py-3.5 text-base font-semibold text-red-600 shadow-sm ring-1 ring-slate-900/5 transition-colors hover:bg-red-50 disabled:opacity-60 dark:bg-slate-900 dark:text-red-400 dark:ring-white/10 dark:hover:bg-red-950/40"
        >
          {signingOut ? 'Çıkış yapılıyor…' : 'Çıkış yap'}
        </button>
      </div>
    </>
  )
}
