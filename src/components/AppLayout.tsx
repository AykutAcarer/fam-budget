/**
 * Oturum açılmış ekranların iskeleti: içerik + altta sabit tab bar.
 * İçerik, açılıştaki döngü devri bittikten sonra gösterilir (useCycleRollover).
 * Çevrimdışıyken üstte "son görülen veri" afişi çıkar, ekranlar salt okunurdur;
 * bağlantı gelince ekranlar yeniden kurulur (veri tazelenir).
 */
import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { todayIso } from '../lib/cycle'
import { useCycleRollover } from '../lib/useCycleRollover'
import { ReadOnlyContext, useOnline } from '../lib/useOnline'
import { CalendarIcon, CardIcon, ChartIcon, HomeIcon, SettingsIcon } from './icons'
import { Spinner } from './ui'

const TABS = [
  { to: '/', label: 'Ana Ekran', Icon: HomeIcon, end: true },
  { to: '/dongu', label: 'Döngü', Icon: ChartIcon, end: false },
  { to: '/sabit', label: 'Sabit', Icon: CalendarIcon, end: false },
  { to: '/borclar', label: 'Borçlar', Icon: CardIcon, end: false },
  { to: '/ayarlar', label: 'Ayarlar', Icon: SettingsIcon, end: false },
]

export function AppLayout() {
  const { session } = useAuth()
  const [today] = useState(todayIso)
  const ready = useCycleRollover(session!.user.id, today)
  const online = useOnline()
  // Bağlantı geri gelince ekranları yeniden kur → veriler sunucudan tazelenir.
  const [epoch, setEpoch] = useState(0)
  const wasOnline = useRef(online)
  useEffect(() => {
    if (online && !wasOnline.current) setEpoch((n) => n + 1)
    wasOnline.current = online
  }, [online])

  return (
    <div className="min-h-dvh">
      {/* Alt boşluk: tab bar + güvenli alan (iPhone çentiği). */}
      <main className="mx-auto max-w-2xl px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {!online && (
          <p
            role="status"
            className="sticky top-2 z-30 mb-4 rounded-xl bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950 shadow-sm ring-1 ring-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800"
          >
            Çevrimdışısın — son görülen veri. Düzenleme bağlantı gelince açılır; sohbete yazdıkların cihazda bekler.
          </p>
        )}
        <ReadOnlyContext value={!online}>
          {ready ? <Outlet key={epoch} /> : <Spinner label="Döngü hazırlanıyor…" />}
        </ReadOnlyContext>
      </main>

      <nav
        aria-label="Ana gezinme"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90"
      >
        <ul className="mx-auto grid max-w-2xl grid-cols-5">
          {TABS.map(({ to, label, Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  }`
                }
              >
                <Icon className="size-6" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
