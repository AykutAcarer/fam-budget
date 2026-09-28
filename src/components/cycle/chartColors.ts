/**
 * Döngü grafiği renkleri (lejant ve grafik ortak kullanır). Her iki çizgi de kendi
 * zemininde ≥ 3:1 kontrastlı; ayrıca biri düz, biri kesikli.
 */
export const CHART_COLORS = {
  light: { current: '#059669', baseline: '#64748B', grid: '#E2E8F0', axis: '#64748B', surface: '#FFFFFF' },
  dark: { current: '#34D399', baseline: '#94A3B8', grid: '#1E293B', axis: '#94A3B8', surface: '#0F172A' },
} as const
