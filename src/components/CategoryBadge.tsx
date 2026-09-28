/**
 * Kategori rozeti ve noktası — renkler yalnızca src/lib/categoryColors.ts'ten.
 * Rozet metni aynı rengin koyu (açık tema) / açık (koyu tema) tonudur.
 */
import type { CSSProperties, ReactNode } from 'react'
import { badgeTones } from '../lib/categoryColors'

export function CategoryDot({ color, className = 'size-2.5' }: { color: string; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  )
}

/** Tema tonlarını CSS değişkeni olarak verir (dark: varyantı ile seçilir). */
export function badgeStyle(color: string): CSSProperties {
  const t = badgeTones(color)
  return {
    '--cat-bg': t.light.bg,
    '--cat-fg': t.light.fg,
    '--cat-bg-dark': t.dark.bg,
    '--cat-fg-dark': t.dark.fg,
  } as CSSProperties
}

export const BADGE_TONE_CLASSES = 'bg-(--cat-bg) text-(--cat-fg) dark:bg-(--cat-bg-dark) dark:text-(--cat-fg-dark)'

export function CategoryBadge({ color, children, className = '' }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE_TONE_CLASSES} ${className}`}
      style={badgeStyle(color)}
    >
      <CategoryDot color={color} className="size-2" />
      {children}
    </span>
  )
}
