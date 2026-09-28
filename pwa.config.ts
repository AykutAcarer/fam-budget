/**
 * PWA ayarları (vite-plugin-pwa / Workbox). Ayrı dosyada, çünkü güvenlik kararları
 * testle kilitlenir (src/lib/pwaConfig.test.ts).
 *
 * GÜVENLİK: Service worker YALNIZCA build çıktısını (JS/CSS/HTML kabuğu, ikonlar)
 * önbelleğe alır. Kullanıcı verisi taşıyan hiçbir istek (Supabase Auth, REST,
 * Edge Function) SW'den geçmez: runtimeCaching tanımlı değil ve Supabase başka
 * bir origin'de olduğu için Workbox bu isteklere hiç dokunmaz → daima ağdan gider.
 * Böylece SW'de bir kullanıcının verisi saklanıp başka oturuma sunulamaz.
 */
import type { VitePWAOptions } from 'vite-plugin-pwa'

/** Açık tema zemini (slate-50) ve vurgu (emerald-600). */
export const APP_BACKGROUND = '#F8FAFC'
export const APP_THEME = '#059669'

export const pwaOptions: Partial<VitePWAOptions> = {
  // Yeni sürüm sessizce devreye girmez; kullanıcıya "Yenile" sorulur.
  registerType: 'prompt',
  // Kayıt src/components/UpdatePrompt.tsx'teki useRegisterSW ile yapılır.
  injectRegister: false,
  includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
  manifest: {
    name: 'Bütçem',
    short_name: 'Bütçem',
    description: 'Aile bütçesi ve harcama takibi',
    lang: 'tr',
    dir: 'ltr',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    scope: '/',
    theme_color: APP_THEME,
    background_color: APP_BACKGROUND,
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    // Precache: uygulama kabuğu (build çıktısı) — çevrimdışı açılış için.
    globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
    // SPA: navigasyon isteklerinde index.html (react-router istemci tarafında çözer).
    navigateFallback: 'index.html',
    cleanupOutdatedCaches: true,
    // Bilinçli olarak runtimeCaching YOK (bkz. dosya başı).
  },
  devOptions: { enabled: false },
}
