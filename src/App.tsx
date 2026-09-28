import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthProvider'
import { AppLayout } from './components/AppLayout'
import { Spinner } from './components/ui'
import { supabaseConfigError } from './lib/supabase'
import { AuthPage } from './pages/AuthPage'
import { Dashboard } from './pages/Dashboard'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { SettingsPage } from './pages/SettingsPage'

/** Oturum yoksa giriş ekranına yönlendirir. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/giris" replace />
  return children
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <Spinner />
  if (session) return <Navigate to="/" replace />
  return children
}

export default function App() {
  if (supabaseConfigError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-bold">Kurulum eksik</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{supabaseConfigError}</p>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/giris" element={<GuestOnly><AuthPage /></GuestOnly>} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="dongu" element={<PlaceholderPage title="Döngü Detay" />} />
        <Route path="sabit" element={<PlaceholderPage title="Sabit Giderler" />} />
        <Route path="borclar" element={<PlaceholderPage title="Borçlar" />} />
        <Route path="ayarlar" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
