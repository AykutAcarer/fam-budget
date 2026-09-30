/**
 * Bağlantı durumu. Çevrimdışıyken ekranlar son görülen veriyi salt okunur
 * gösterir; bağlantı gelince `epoch` artar ve ekranlar veriyi yeniden yükler.
 */
import { createContext, use, useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

/** navigator.onLine — tarayıcı yalnız "kesin çevrimdışı"yı güvenilir bildirir. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine !== false, () => true)
}

/** Salt okunur mod (çevrimdışı): düzenleme kontrolleri kapalı, sohbet kuyruğu çalışır. */
export const ReadOnlyContext = createContext(false)

export function useReadOnly(): boolean {
  return use(ReadOnlyContext)
}
