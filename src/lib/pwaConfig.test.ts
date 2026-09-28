/**
 * PWA ayarlarının güvenlik ve kurulabilirlik gereksinimlerini kilitler.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ManifestOptions } from 'vite-plugin-pwa'
import { describe, expect, it } from 'vitest'
import { pwaOptions } from '../../pwa.config'

const ROOT = join(import.meta.dirname, '..', '..')
const manifest = pwaOptions.manifest as Partial<ManifestOptions>

/** PNG başlığından genişlik × yükseklik. */
function pngSize(file: string): string {
  const b = readFileSync(join(ROOT, 'public', file))
  expect(b.subarray(1, 4).toString()).toBe('PNG')
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`
}

describe('service worker', () => {
  it('güncelleme kullanıcıya sorulur (sessiz güncelleme yok)', () => {
    expect(pwaOptions.registerType).toBe('prompt')
  })

  it('kullanıcı verisi önbelleğe alınmaz: runtimeCaching yok, yalnız build çıktısı precache', () => {
    expect(pwaOptions.workbox?.runtimeCaching).toBeUndefined()
    expect(pwaOptions.workbox?.globPatterns).toEqual(['**/*.{js,css,html,svg,png,webmanifest}'])
  })

  it('SPA: navigasyon isteklerinde index.html', () => {
    expect(pwaOptions.workbox?.navigateFallback).toBe('index.html')
  })
})

describe('manifest', () => {
  it('kurulabilirlik alanları', () => {
    expect(manifest).toMatchObject({
      name: 'Bütçem',
      short_name: 'Bütçem',
      lang: 'tr',
      dir: 'ltr',
      display: 'standalone',
      orientation: 'portrait',
      start_url: '/',
      scope: '/',
      description: 'Aile bütçesi ve harcama takibi',
    })
    expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i)
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i)
  })

  it('ikonlar: 192, 512 ve maskable 512 — dosyalar var ve boyutları doğru', () => {
    const icons = manifest.icons ?? []
    expect(icons.map((i) => [i.sizes, i.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ])
    for (const icon of icons) expect(pngSize(icon.src)).toBe(icon.sizes)
  })

  it('iOS ana ekran ikonu 180x180', () => {
    expect(pngSize('apple-touch-icon.png')).toBe('180x180')
  })
})

describe('index.html (iOS Safari)', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  it.each([
    '<meta name="apple-mobile-web-app-capable" content="yes" />',
    '<meta name="apple-mobile-web-app-status-bar-style" content="default" />',
    '<meta name="apple-mobile-web-app-title" content="Bütçem" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />',
    'viewport-fit=cover',
  ])('%s', (snippet) => {
    expect(html).toContain(snippet)
  })
})
