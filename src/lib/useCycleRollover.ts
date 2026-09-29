/**
 * Açılışta döngü devri: bugünü kapsayan döngü yoksa en yeni döngüden devredilir
 * (tekrar eden gelir ve sabit giderler taşınır). Ekranlar veriyi bu bittikten
 * sonra yükler. Oturum başına bir kez çalışır; çevrimdışıyken ya da hata olursa
 * uygulamayı bekletmez (bir sonraki açılışta ya da ilk kayıtta yeniden denenir).
 */
import { useEffect, useState } from 'react'
import { rollForwardUntil } from './cyclesApi'

const MAX_WAIT_MS = 8000
const runs = new Map<string, Promise<void>>()

function runOnce(userId: string, today: string): Promise<void> {
  const key = `${userId}:${today}`
  let run = runs.get(key)
  if (!run) {
    run = rollForwardUntil(today).then(
      () => undefined,
      (e: unknown) => {
        runs.delete(key) // bir sonraki açılışta tekrar denensin
        console.warn('Döngü devri yapılamadı:', e)
      },
    )
    runs.set(key, run)
  }
  return run
}

export function useCycleRollover(userId: string, today: string): boolean {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const [ready, setReady] = useState(offline)

  useEffect(() => {
    if (offline) return
    let alive = true
    const timer = setTimeout(() => alive && setReady(true), MAX_WAIT_MS)
    void runOnce(userId, today).finally(() => {
      clearTimeout(timer)
      if (alive) setReady(true)
    })
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [userId, today, offline])

  return ready
}
