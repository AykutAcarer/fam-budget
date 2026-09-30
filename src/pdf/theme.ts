/**
 * PDF renkleri — uygulama paletiyle aynı (Tailwind slate / emerald / rose
 * tonları; vurgu ve zemin PWA temasından). Kategori renkleri buraya girmez:
 * rapor verisindeki her kategori rengi createColorLookup'tan (tek kaynak) gelir.
 */
import { APP_BACKGROUND, APP_THEME } from '../../pwa.config'

export const PDF_COLORS = {
  accent: APP_THEME, // emerald-600
  surface: APP_BACKGROUND, // slate-50
  text: '#0F172A', // slate-900
  muted: '#64748B', // slate-500
  subtle: '#94A3B8', // slate-400
  border: '#E2E8F0', // slate-200
  white: '#FFFFFF',
  good: '#047857', // emerald-700
  goodBg: '#ECFDF5', // emerald-50
  bad: '#BE123C', // rose-700
  badBg: '#FFF1F2', // rose-50
  track: '#F1F5F9', // slate-100
} as const
