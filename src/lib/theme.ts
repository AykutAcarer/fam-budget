/**
 * Tema tercihi: açık / koyu / sistem. Cihaza özel bir tercih olduğu için
 * localStorage'da tutulur; ilk boyama index.html'deki satır içi betikle yapılır.
 */
import { useCallback, useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Depolama kapalıysa sistem temasına düş.
  }
  return 'system'
}

function applyPref(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function useTheme(): [ThemePref, (pref: ThemePref) => void] {
  const [pref, setPrefState] = useState<ThemePref>(readPref)

  // Sistem teması değişirse ("system" seçiliyken) canlı uygula.
  useEffect(() => {
    applyPref(pref)
    if (pref !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPref('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const setPref = useCallback((next: ThemePref) => {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Kaydedilemese de bu oturum için uygulanır.
    }
    setPrefState(next)
  }, [])

  return [pref, setPref]
}
