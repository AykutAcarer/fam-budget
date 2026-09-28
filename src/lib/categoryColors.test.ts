/**
 * Kategori paleti gerileme testleri — dataviz doğrulayıcısının garantileri:
 * iki temada kontrast, donut komşularında renk körlüğü (Machado 2009, şiddet 1.0)
 * ve normal görüş ayrımı, rozet metni kontrastı.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CATEGORIES,
  DONUT_ORDER,
  NEUTRAL_CATEGORY_COLOR,
} from '../../supabase/functions/_shared/categories'
import { badgeTones, contrastRatio, createColorLookup, sortForDonut, toOklch } from './categoryColors'

const LIGHT_SURFACE = '#ffffff' // kart zemini (açık)
const DARK_SURFACE = '#0f172a' // kart zemini (koyu, slate-900)
const color = (key: string) => DEFAULT_CATEGORIES.find((c) => c.key === key)!.color

// --- ΔE (OKLab ×100), normal ve simüle renk körlüğü ---------------------------
const s2lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lin = (hex: string) => [0, 2, 4].map((i) => s2lin(parseInt(hex.slice(1 + i, 3 + i), 16) / 255))
function oklab([r, g, b]: number[]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
const MACHADO = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
}
const simulate = (hex: string, M: number[][]) => {
  const c = lin(hex)
  return M.map((row) => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])))
}
const dist = (a: number[], b: number[]) => 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const deltaE = (a: string, b: string) => dist(oklab(lin(a)), oklab(lin(b)))
const cvdDeltaE = (a: string, b: string) =>
  Math.min(...Object.values(MACHADO).map((M) => dist(oklab(simulate(a, M)), oklab(simulate(b, M)))))

describe('varsayılan palet', () => {
  it.each(DEFAULT_CATEGORIES.map((c) => [c.key, c.color]))('%s (%s) iki temada da ≥ 3:1', (_, hex) => {
    expect(contrastRatio(hex, LIGHT_SURFACE)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(hex, DARK_SURFACE)).toBeGreaterThanOrEqual(3)
  })

  it('Halı saha (mavi) ile Sosyal (mor) net ayrılır', () => {
    const [a, b] = [color('halisaha'), color('sosyal')]
    expect(deltaE(a, b)).toBeGreaterThanOrEqual(15)
    expect(cvdDeltaE(a, b)).toBeGreaterThanOrEqual(8)
    // Kimlik korunur: biri mavi, diğeri mor tonunda.
    const hue = (h: string) => ((toOklch(h)[2] * 180) / Math.PI + 360) % 360
    expect(hue(a)).toBeGreaterThan(230)
    expect(hue(a)).toBeLessThan(270)
    expect(hue(b)).toBeGreaterThan(270)
    expect(hue(b)).toBeLessThan(310)
  })

  it('donut halkasında komşu dilimler: renk körlüğünde ΔE ≥ 8, normal görüşte ΔE ≥ 15', () => {
    expect([...DONUT_ORDER].sort()).toEqual(DEFAULT_CATEGORIES.map((c) => c.key).sort())
    for (let i = 0; i < DONUT_ORDER.length; i++) {
      const a = color(DONUT_ORDER[i])
      const b = color(DONUT_ORDER[(i + 1) % DONUT_ORDER.length])
      expect(cvdDeltaE(a, b), `${DONUT_ORDER[i]}↔${DONUT_ORDER[(i + 1) % DONUT_ORDER.length]}`).toBeGreaterThanOrEqual(8)
      expect(deltaE(a, b), `${DONUT_ORDER[i]}↔${DONUT_ORDER[(i + 1) % DONUT_ORDER.length]}`).toBeGreaterThanOrEqual(15)
    }
  })

  it('kredi kartı dışındaki renkler gri okunmaz (OKLCH C ≥ 0.10)', () => {
    for (const c of DEFAULT_CATEGORIES.filter((c) => c.key !== 'kredi karti')) expect(toOklch(c.color)[1], c.key).toBeGreaterThanOrEqual(0.1)
  })
})

describe('badgeTones', () => {
  it.each(DEFAULT_CATEGORIES.map((c) => [c.key, c.color]))('%s: metin kendi zemininde ≥ 4.5:1 (iki tema)', (_, hex) => {
    const t = badgeTones(hex)
    expect(contrastRatio(t.light.fg, t.light.bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(t.dark.fg, t.dark.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(DEFAULT_CATEGORIES.filter((c) => c.key !== 'kredi karti').map((c) => [c.key, c.color]))(
    '%s: metin aynı rengin koyu/açık tonu (düz siyah/gri değil)',
    (_, hex) => {
      const [L, , H] = toOklch(hex)
      const t = badgeTones(hex)
      for (const [fg, darker] of [[t.light.fg, true], [t.dark.fg, false]] as const) {
        const [Lf, Cf, Hf] = toOklch(fg)
        expect(Cf).toBeGreaterThan(0.04) // renkli
        const dh = Math.abs(((((Hf - H) * 180) / Math.PI + 540) % 360) - 180)
        expect(dh).toBeLessThan(20) // aynı ton ailesi
        if (darker) expect(Lf).toBeLessThan(L)
        else expect(Lf).toBeGreaterThan(L)
      }
    },
  )

  it('deterministik ve önbellekli', () => {
    expect(badgeTones('#3E89DE')).toBe(badgeTones('#3E89DE'))
  })
})

describe('createColorLookup', () => {
  it('önce kullanıcının rengi, sonra varsayılan palet, sonra nötr', () => {
    const colorOf = createColorLookup([{ key: 'sosyal', color: '#123456' }, { key: 'spor', color: '#654321' }])
    expect(colorOf('sosyal')).toBe('#123456')
    expect(colorOf('spor')).toBe('#654321')
    expect(colorOf('mutfak')).toBe(color('mutfak'))
    expect(colorOf('bilinmeyen')).toBe(NEUTRAL_CATEGORY_COLOR)
  })
})

describe('sortForDonut', () => {
  it('sabit halka sırası; bilinmeyenler sona, kendi sıralarıyla', () => {
    const items = ['spor', 'sosyal', 'mutfak', 'hobi', 'halisaha'].map((key) => ({ key }))
    expect(sortForDonut(items).map((i) => i.key)).toEqual(['mutfak', 'halisaha', 'sosyal', 'spor', 'hobi'])
  })
})
