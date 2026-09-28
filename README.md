# Bütçem (fam-budget)

Ailenin gelir, sabit gider, değişken harcama ve borçlarını takip eden mobil öncelikli web uygulaması.
Harcamalar serbest Türkçe metinle bir sohbet kutusundan girilir; para matematiği her zaman kodla yapılır.

Spec: [`codex_prompt.md`](codex_prompt.md) · Sohbet AI system mesajı: [`app_system_prompt.md`](app_system_prompt.md) · Örnek içe aktarma verisi: [`butce_verisi.json`](butce_verisi.json)

**Yığın:** Vite + React + TypeScript · Tailwind CSS v4 · Supabase (Auth + Postgres + RLS) · react-router · dayjs

## Durum

- [x] **1. katman:** iskelet, Supabase auth (kayıt/giriş/çıkış), tablolar + RLS, boş dashboard, tema
- [ ] Sohbetle harcama girişi (Edge Function `chat-expense` + Claude API + kural tabanlı yedek)
- [ ] Kıyas hesapları, KPI'lar, grafikler (Recharts)
- [ ] Döngü detay, sabit giderler, borçlar ekranları
- [ ] Ayarlar: JSON içe/dışa aktarma, baz ay, kategori yönetimi
- [ ] PWA

## Kurulum

### 1. Supabase projesi

1. [supabase.com](https://supabase.com) üzerinde bir proje oluştur.
2. Şemayı kur. İki yol var:
   - **SQL Editor:** [`supabase/migrations/20260928000000_init.sql`](supabase/migrations/20260928000000_init.sql) içeriğini yapıştırıp çalıştır.
   - **CLI:** `npx supabase init` (mevcut `supabase/migrations` korunur) → `npx supabase link --project-ref <ref>` → `npx supabase db push`
3. *Authentication > Providers > Email* açık olsun. E-posta doğrulaması açıksa kayıttan sonra gelen bağlantıya tıklamak gerekir
   (geliştirirken *Confirm email* kapatılabilir). *Authentication > URL Configuration > Site URL* alanına uygulamanın adresini yaz
   (yerelde `http://localhost:5173`).

### 2. Ortam değişkenleri

```bash
cp .env.example .env.local
```

| Değişken | Nereden |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings > API > Project URL |
| `VITE_SUPABASE_ANON_KEY` | Project Settings > API > anon / publishable key |

Tarayıcıya yalnızca bu iki genel değer gider; veri güvenliği RLS ile sağlanır.
`ANTHROPIC_API_KEY` gibi gizli anahtarlar **yalnızca** Edge Function secret'ında tutulur (sohbet katmanında eklenecek).

### 3. Çalıştır

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # birim + veritabanı/RLS testleri
npm run build      # tip kontrolü + üretim derlemesi
```

## Veritabanı

| Tablo | Açıklama |
|---|---|
| `categories` | Kullanıcının kategorileri (`key`, `label`, `type`, `color`). Yeni kullanıcıya 10 varsayılan kategori trigger ile eklenir. |
| `cycles` | Maaş gününe (15'i) bağlı döngüler. `key` (ör. `2026-09`) içe aktarmada idempotent upsert için kullanılır. Kullanıcı başına en fazla bir `is_baseline`. |
| `income`, `fixed_expenses`, `variable_expenses` | Döngüye bağlı kayıtlar; döngü silinince silinir. |
| `debts` | Borçlar. `due_date` `YYYY-MM` veya `YYYY-MM-DD`. |

**Güvenlik:**
- Her tabloda RLS açık. `authenticated` yalnızca `user_id = auth.uid()` olan satırları okur/yazar. `anon` erişemez.
- `user_id` varsayılan olarak `auth.uid()` ile dolar.
- Alt tablolar döngüye `(cycle_id, user_id)` bileşik FK ile bağlıdır. Böylece başkasının döngüsüne satır eklenemez.
- Harcama kategorisi kullanıcının kendi kategorilerinden biri olmalıdır (FK).
- `set_baseline_cycle(uuid)` RPC'si baz ayı tek işlemde değiştirir.

`supabase/tests/rls.test.ts`, migration'ı gömülü Postgres'te (PGlite) çalıştırır. Kullanıcı izolasyonunu, anon erişimini,
baz ay kuralını test eder ve `butce_verisi.json`'ın şemaya eksiksiz yazılabildiğini doğrular. Docker gerekmez.

## Döngü mantığı

Döngü takvim ayı değildir: her ayın **15'inde** başlar, ertesi ayın **14'ünde** biter. Döngü günü 1 = 15'i.
Kıyaslar döngü günü indeksine göre yapılır. Bkz. [`src/lib/cycle.ts`](src/lib/cycle.ts).

## Proje yapısı

```
src/
  auth/AuthProvider.tsx     oturum bağlamı + Türkçe hata mesajları
  components/               AppLayout (alt tab bar), ikonlar, kart vb.
  lib/
    cycle.ts                döngü hesapları (saf fonksiyonlar, testli)
    date.ts                 tarih yardımcıları (clampIsoDate)
    database.types.ts       tablo tipleri
    supabase.ts             istemci
    theme.ts                açık / koyu / sistem tema
  pages/                    AuthPage, Dashboard, SettingsPage, ...
supabase/
  migrations/               şema + RLS
  tests/                    veritabanı testleri
```
