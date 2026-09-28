# Bütçem (fam-budget)

Ailenin gelir, sabit gider, değişken harcama ve borçlarını takip eden mobil öncelikli web uygulaması.
Harcamalar serbest Türkçe metinle bir sohbet kutusundan girilir; para matematiği her zaman kodla yapılır.

Spec: [`codex_prompt.md`](codex_prompt.md) · Sohbet AI system mesajı: [`app_system_prompt.md`](app_system_prompt.md) · Örnek içe aktarma verisi (sentetik): [`ornek_veri.json`](ornek_veri.json)

**Yığın:** Vite + React + TypeScript · Tailwind CSS v4 · Supabase (Auth + Postgres + RLS + Edge Functions) · Claude API · Recharts · react-router · dayjs

## Durum

- [x] **1. katman:** iskelet, Supabase auth (kayıt/giriş/çıkış), tablolar + RLS, boş dashboard, tema
- [x] **2. katman:** JSON içe/dışa aktarma, kıyas motoru, sohbetle harcama girişi (Edge Function `chat-expense` + Claude + kural tabanlı yedek + çevrimdışı kuyruk), gerçek veriye bağlı dashboard (kıyas kartı, KPI'lar, kategori donut'u)
- [x] **Sabit giderler / ödeme takvimi:** ödendi işaretleme, yaklaşan/geciken şeridi, ekle/düzenle/sil, taksit ve kart bilgisi
- [x] **Borçlar:** toplam / faizli / faizsiz özet, faizliler önce sıralama, "önce bunu öde", vade uyarısı, ekle/düzenle/sil
- [x] **Döngü detay:** döngü seçici, gün gün kümülatif grafik (bu döngü vs baz ay), kategori özeti, harcama düzenle/sil
- [ ] Ayarlar: baz ay seçimi, kategori yönetimi
- [ ] PWA

## Kurulum

### 1. Supabase projesi

1. [supabase.com](https://supabase.com) üzerinde bir proje oluştur.
2. Şemayı kur — `supabase/migrations/` altındaki dosyaları **sırayla**:
   - **SQL Editor:** her dosyanın içeriğini bu sırayla yapıştırıp çalıştır:

     | Dosya | Ne yapar |
     |---|---|
     | `20260928000000_init.sql` | Tablolar, RLS, varsayılan kategoriler |
     | `20260929000000_import_data.sql` | JSON içe aktarma fonksiyonu |
     | `20260930000000_accessible_category_colors.sql` | Erişilebilir kategori renkleri + eski pastel renkleri taşıma |
     | `20261001000000_fixed_expense_installments.sql` | Sabit giderlere `installments_left` (kalan taksit) + içe aktarmanın bunu taşıması |

   - **CLI:** `npx supabase init` (mevcut `supabase/` dosyaları korunur) → `npx supabase link --project-ref <ref>` → `npx supabase db push`
3. *Authentication > Providers > Email* açık olsun. E-posta doğrulaması açıksa kayıttan sonra gelen bağlantıya tıklamak gerekir
   (geliştirirken *Confirm email* kapatılabilir). *Authentication > URL Configuration > Site URL* alanına uygulamanın adresini yaz
   (yerelde `http://localhost:5173`).

### 2. Ortam değişkenleri (istemci)

```bash
cp .env.example .env.local
```

| Değişken | Nereden |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings > API > Project URL |
| `VITE_SUPABASE_ANON_KEY` | Project Settings > API > anon / publishable key |

Tarayıcıya yalnızca bu iki genel değer gider; veri güvenliği RLS ile sağlanır.
`ANTHROPIC_API_KEY` **yalnızca** Edge Function secret'ında tutulur; `.env` dosyalarına veya koda yazılmaz.

### 3. Sohbet AI — Edge Function `chat-expense`

Fonksiyon kodu: [`supabase/functions/chat-expense/`](supabase/functions/chat-expense/)
(`index.ts` Deno giriş noktası, `handler.ts` asıl mantık, `system_prompt.ts` → `app_system_prompt.md`'den üretilir).

**Secret'lar** — *Supabase Dashboard > Edge Functions > Secrets* ekranından girilmesi önerilir (anahtar kabuk geçmişine düşmez):

| Secret | Değer |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Console'dan API anahtarı |
| `ANTHROPIC_MODEL` | Hızlı bir Haiku sınıfı model: `claude-haiku-4-5` |

CLI ile: `npx supabase secrets set ANTHROPIC_MODEL=claude-haiku-4-5` (anahtar için de aynı komut kullanılabilir).
`SUPABASE_URL` / `SUPABASE_ANON_KEY` platform tarafından otomatik verilir.

> Model notu: fonksiyon yapılandırılmış çıktı için zorunlu tool kullanımı (`tool_choice: {type: "tool"}`) ve `strict: true`
> kullanır. Bu Haiku 4.5 ve Sonnet modellerinde çalışır; Claude Opus 5.5 / Fable 5.1 zorunlu tool kullanımını desteklemez (400).

**Deploy:**

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase functions deploy chat-expense --no-verify-jwt
```

`--no-verify-jwt`: kimlik doğrulamayı fonksiyonun kendisi yapar (`auth.getClaims` ile JWT imzası doğrulanır, yalnızca
`authenticated` rolü kabul edilir; anon key ile çağrı 401 alır). Bu yöntem yeni asimetrik JWT anahtarlarıyla da çalışır.

`app_system_prompt.md` değişirse: `npm run sync:prompt`, sonra yeniden deploy. (Bir test, üretilen dosyanın md ile aynı
olduğunu kontrol eder.)

**Yerelde test:**

| Komut | Ne yapar | Gereken |
|---|---|---|
| `npm test` | İstek sözleşmesi, 10 örnek cümle, çıktı temizleme, hata yolları (Anthropic mock'lanır) | — |
| `npm run test:ai` | Aynı 10 cümleyi **gerçek** Claude API ile çalıştırır (~1 sent) | Kabukta `ANTHROPIC_API_KEY` |
| `npx supabase functions serve chat-expense --no-verify-jwt --env-file supabase/functions/.env.local` | Fonksiyonu yerel Supabase'de çalıştırır | Docker + `npx supabase start` |

`test:ai` için anahtarı dosyaya yazmadan yalnızca o komuta ver:

```powershell
$env:ANTHROPIC_API_KEY="sk-ant-..."; $env:ANTHROPIC_MODEL="claude-haiku-4-5"; npm run test:ai
```

(`supabase/functions/.env.local` kullanırsan `.gitignore` onu zaten dışarıda tutar.)

### 4. Çalıştır

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # birim + veritabanı/RLS + Edge Function testleri
npm run build      # tip kontrolü + üretim derlemesi
```

İlk kullanımda *Ayarlar > Veriyi içe aktar* ile `ornek_veri.json` yüklenirse baz ay, aktif döngü, sabit giderler ve borçlar dolar.

## Sohbetle harcama girişi — nasıl çalışır

```
metin ──► chat-expense (parse) ──► kategori belirsiz mi? ──► kullanıcıya sor
   │         Claude + tool use            │ hayır
   │ (hata/çevrimdışı)                    ▼
   └──► fallbackParser (kural tabanlı) ──► variable_expenses'e kaydet ──(bağlantı yok)──► cihazda kuyruk
                                                  │
                                                  ▼
                                   kıyas KODLA hesaplanır (compare.ts)
                                                  │
                                                  ▼
                           chat-expense (reply): hazır rakamlarla motive edici cümle
                           (cevapta verilmeyen bir rakam varsa → kodla yazılmış sade özet)
```

- **Altın kural:** para matematiği (kümülatif toplam, baz ay kıyası, fark) her zaman kodla yapılır; toplamlar sent cinsinden
  tam sayılarla hesaplanır. Yapay zeka yalnızca metni yapılandırır ve verilen rakamları cümleye döker. İstemci, AI cevabındaki
  her sayının kodun verdiği rakamlardan biri olduğunu doğrular ([`chatText.ts`](src/lib/chatText.ts)).
- **Harcama kaybolmaz:** Edge Function'a ulaşılamazsa kural tabanlı parser devreye girer; veritabanına ulaşılamazsa kalem
  cihazda kuyruğa alınır ve bağlantı gelince (istemcide üretilmiş id ile, kopya oluşmadan) gönderilir.
- Her cevaptaki **Geri al** kaydı siler.

## Veritabanı

| Tablo | Açıklama |
|---|---|
| `categories` | Kullanıcının kategorileri (`key`, `label`, `type`, `color`). Yeni kullanıcıya 10 varsayılan kategori trigger ile eklenir (bkz. *Kategori renkleri*). |
| `cycles` | Maaş gününe (15'i) bağlı döngüler. `key` (ör. `2026-09`) içe aktarmada idempotent upsert için kullanılır. Kullanıcı başına en fazla bir `is_baseline`. |
| `income`, `fixed_expenses`, `variable_expenses` | Döngüye bağlı kayıtlar; döngü silinince silinir. `fixed_expenses.installments_left`: kalan taksit (taksit değilse NULL). |
| `debts` | Borçlar. `due_date` `YYYY-MM` veya `YYYY-MM-DD`. |

| RPC | Açıklama |
|---|---|
| `set_baseline_cycle(uuid)` | Baz ayı tek işlemde değiştirir. |
| `import_data(jsonb)` | JSON içe aktarma — tek işlem (atomik), idempotent. Döngüler `key`'e göre upsert edilip kayıtları dosyadakilerle değiştirilir; borçlar ada göre eşlenir; kullanıcının mevcut kategorileri korunur. |

**Güvenlik:**
- Her tabloda RLS açık. `authenticated` yalnızca `user_id = auth.uid()` olan satırları okur/yazar. `anon` erişemez.
- `user_id` varsayılan olarak `auth.uid()` ile dolar. RPC'ler `security invoker`'dır (RLS geçerli).
- Alt tablolar döngüye `(cycle_id, user_id)` bileşik FK ile bağlıdır. Böylece başkasının döngüsüne satır eklenemez.
- Harcama kategorisi kullanıcının kendi kategorilerinden biri olmalıdır (FK).

`supabase/tests/rls.test.ts`, migration'ları gömülü Postgres'te (PGlite) çalıştırır: kullanıcı izolasyonu, anon erişimi,
baz ay kuralı ve `ornek_veri.json`'ın içe aktarılması (idempotentlik, atomiklik). Docker gerekmez.

**Kişisel veri:** gerçek bütçe verisi repoya girmez (`butce_verisi.json` `.gitignore`'da). Testler ve örnekler yalnızca
tamamen sentetik `ornek_veri.json`'ı kullanır.

## Kategori renkleri

Tek kaynak: [`supabase/functions/_shared/categories.ts`](supabase/functions/_shared/categories.ts) — varsayılan
kategoriler, renkler ve donut dilim sırası. İstemci (donut, tablo noktaları, rozetler) ve Edge Function buradan okur;
veritabanı seed'i (`seed_default_categories`) bunun aynasıdır ve `supabase/tests/category-colors.test.ts` ikisinin
aynı olduğunu doğrular. Renkler [`src/lib/categoryColors.ts`](src/lib/categoryColors.ts) üzerinden kullanılır; rozet metni
rengin koyu (açık tema) / açık (koyu tema) tonundan hesaplanır ve kendi zemininde ≥ 4.5:1 kontrast sağlar.

Palet açık (#ffffff) ve koyu (#0f172a) zeminde ≥ 3:1 kontrastlıdır; donut'ta komşu dilimler renk körlüğü simülasyonunda
ΔE ≥ 8, normal görüşte ΔE ≥ 15 ayrışır (`src/lib/categoryColors.test.ts`). Renk değiştirmek için: tek kaynağı güncelle,
yeni seed + eski renkleri taşıyan bir migration ekle (örnek: `20260930000000_accessible_category_colors.sql`).

## Döngü detay

*Döngü* sekmesi: döngü seçici (en yeniden eskiye; aktif ve baz ay rozetli), gün gün kümülatif kısılabilir dörtlü grafiği,
kategori özeti ve değişken harcama listesi. Hesaplar [`compare.ts`](src/lib/compare.ts)'te (`cycleOptions`,
`categoryBreakdown`, `dailyCumulativeSeries`) — dashboard kıyas kartıyla aynı döngü günü ve dörtlü tanımı; bir test,
grafiğin bugünkü noktasının kıyas kartındaki "bu ay / baz ay" ile aynı olduğunu doğrular.

- **Grafik:** "Bu döngü" düz yeşil, "Baz ay" kesikli gri (yalnız renkle ayrılmaz). Aktif döngüde çizgi bugünde biter.
  Baz ay yoksa tek çizgi + "baz ay seçili değil" ipucu.
- **Kategori özeti:** kısılabilir dörtlü ayrı grup + ara toplam; her satırda bu döngü, baz ayın tamamı ve fark (▲/▼ + işaret).
- **Harcamalar:** en yeni üstte; kategori, tutar, tarih (döngü içinde) ve açıklama düzenlenir, iki adımlı onayla silinir.
  Yeni harcama buradan girilmez (sohbetten girilir).

## Sabit giderler / ödeme takvimi

*Sabit* sekmesi aktif döngünün sabit giderlerini ödeme gününe göre listeler. Toplamlar (toplam / ödenen / kalan) ve
durumlar [`src/lib/fixed.ts`](src/lib/fixed.ts)'ten gelir; dashboard'daki sabit gider KPI'ı da aynı fonksiyonu kullanır.

| Durum | Kural (ödenmemişse) |
|---|---|
| Gecikti | tarih < bugün |
| Bugün | tarih = bugün |
| Yaklaşıyor | bugün < tarih ≤ bugün + 3 gün |
| İleri | tarih > bugün + 3 gün |
| Ödendi | `paid = true` |

Gün girildiğinde döngü içindeki tarihe yerleşir (15 Eyl – 14 Eki döngüsünde 22 → 22 Eyl, 7 → 7 Eki). Yaklaşan uyarısı
şimdilik yalnızca uygulama içi şerittir; telefon bildirimi PWA katmanında gelecek. Kalan taksit sayısı elle düzenlenir.

## Borçlar

*Borçlar* sekmesi toplamları ve sıralamayı [`src/lib/debts.ts`](src/lib/debts.ts)'ten alır (dashboard'daki "Toplam borç"
kartı da aynı fonksiyonu kullanır). Şema değişikliği yoktur.

- **Sıralama:** faizliler önce, faiz metninden okunan orana göre yüksekten düşüğe ("~%17,5/yıl" → 17,5; okunamazsa sona);
  sonra faizsizler öncelik numarasına göre. Eşitlikte öncelik, sonra yüksek bakiye, sonra ad.
- **"Önce bunu öde":** listede en üstteki (en pahalı) kapanmamış faizli borç. Tüm faizliler kırmızı vurgulanır.
- **Vade:** `YYYY-MM-DD` ya da yalnız ay (`YYYY-MM`, hesapta ayın ilk günü sayılır). Bugünden 0–30 gün içindeyse
  "vade yaklaşıyor", geçmişse "vadesi geçti".
- Bakiye Türkçe biçimde girilir ("6.026,31"); kısmi ödemeden sonra düzenle ile yeni bakiye yazılır. Ödeme geçmişi ve
  ödeme planı bu sürümde yok.

## Döngü mantığı

Döngü takvim ayı değildir: her ayın **15'inde** başlar, ertesi ayın **14'ünde** biter. Döngü günü 1 = 15'i.
Kıyaslar döngü günü indeksine göre yapılır: bu döngünün 14. günü, baz ayın 14. günüyle karşılaştırılır.
"Kısılabilir dörtlü" = kahvaltı + iş + halı saha + sosyal. Bkz. [`cycle.ts`](src/lib/cycle.ts), [`compare.ts`](src/lib/compare.ts).

## Proje yapısı

```
src/
  auth/AuthProvider.tsx       oturum bağlamı + Türkçe hata mesajları
  components/
    chat/                     ChatPanel (sohbet arayüzü), useChat (sohbet durumu)
    dashboard/                kıyas kartı, KPI'lar, kategori donut'u + tablosu
    DataTransferCard.tsx      Ayarlar > içe/dışa aktarma
  lib/
    compare.ts                kıyas motoru + döngü detay serileri (saf, testli)
    expenseEdit.ts            harcama düzenleme doğrulaması (saf, testli)
    budget.ts                 dashboard verisi → kıyas, KPI'lar, kategori dağılımı (saf, testli)
    chatFlow.ts               sohbet akışı: parse → onay → kaydet → kıyas → cevap (testli)
    chatText.ts               kodla üretilen özet + AI cevabı rakam doğrulaması
    fallbackParser.ts         kural tabanlı yedek parser
    expensesApi.ts, outbox.ts harcama kaydı + çevrimdışı kuyruk
    transfer.ts               içe aktarma doğrulama / dışa aktarma (saf)
    fixed.ts, fixedApi.ts     sabit giderler: sıralama, toplamlar, durum (saf, testli) + Supabase
    debts.ts, debtsApi.ts     borçlar: toplamlar, sıralama, vade durumu (saf, testli) + Supabase
    cycle.ts, date.ts, money.ts
  pages/                      AuthPage, Dashboard, SettingsPage, ...
supabase/
  functions/chat-expense/     Edge Function (Claude API)
  migrations/                 şema + RLS + import_data
  tests/                      veritabanı ve Edge Function testleri
scripts/sync-system-prompt.mjs
```
