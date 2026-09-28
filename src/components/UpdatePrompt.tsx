/**
 * Service worker kaydı + güncelleme bildirimi (registerType: 'prompt').
 * Yeni sürüm hazır olunca kullanıcıya sorulur; sessizce yenilenmez.
 */
import { useRegisterSW } from 'virtual:pwa-register/react'

/** Uzun süre açık kalan uygulama da yeni sürümü görsün. */
const UPDATE_CHECK_MS = 60 * 60 * 1000

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS)
    },
  })

  if (!needRefresh && !offlineReady) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]"
    >
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-white/10 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-900/10">
        <p className="flex-1">
          {needRefresh ? 'Yeni sürüm var.' : 'Uygulama çevrimdışı kullanıma hazır.'}
        </p>
        {needRefresh && (
          <button
            type="button"
            onClick={() => void updateServiceWorker(true)}
            className="min-h-10 rounded-xl bg-emerald-500 px-4 font-semibold text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
          >
            Yenile
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setNeedRefresh(false)
            setOfflineReady(false)
          }}
          className="min-h-10 rounded-xl px-3 font-semibold text-slate-300 hover:text-white dark:text-slate-600 dark:hover:text-slate-900"
        >
          {needRefresh ? 'Sonra' : 'Tamam'}
        </button>
      </div>
    </div>
  )
}
