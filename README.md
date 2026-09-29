# Bütçem (fam-budget)

Ailenin gelir, sabit gider, değişken harcama ve borçlarını takip eden mobil öncelikli web uygulaması.
Harcamalar serbest Türkçe metinle bir sohbet kutusundan girilir; para matematiği her zaman kodla yapılır.

Spec: [`codex_prompt.md`](codex_prompt.md) · Sohbet AI system mesajı: [`app_system_prompt.md`](app_system_prompt.md) · Örnek içe aktarma verisi (sentetik): [`ornek_veri.json`](ornek_veri.json)

**Yığın:** Vite + React + TypeScript · Tailwind CSS v4 · Supabase (Auth + Postgres + RLS + Edge Functions) · Claude API · Recharts · vite-plugin-pwa · react-router · dayjs

## Durum

- [x] **1. katman:** iskelet, Supabase auth (kayıt/giriş/çıkış), tablolar + RLS, boş dashboard, tema
- [x] **2. katman:** JSON içe/dışa aktarma, kıyas motoru, sohbetle harcama girişi (Edge Function `chat-expense` + Claude + kural tabanlı yedek + çevrimdışı kuyruk), gerçek veriye bağlı dashboard (kıyas kartı, KPI'lar, kategori donut'u)
- [x] **Sabit giderler / ödeme takvimi:** ödendi işaretleme, yaklaşan/geciken şeridi, ekle/düzenle/sil, taksit ve kart bilgisi
- [x] **Gelir girişi:** Sabit sekmesinde "Gelir" bölümü — toplam / alınan / beklenen, alındı anahtarı, ekle/düzenle/sil, tek seferlik işareti
- [x] **Döngü devri:** her ayın 15'inde yeni döngü tekrar eden gelir ve sabit giderlerle otomatik başlar; taksitler bir azalır
- [x] **Borçlar:** toplam / faizli / faizsiz özet, faizliler önce sıralama, "önce bunu öde", vade uyarısı, ekle/düzenle/sil
- [x] **Borç ödeme geçmişi:** ödeme ekle (tarih, tutar, not) → bakiye aynı işlemde düşer; geçmiş + toplam ödenen; düzenle/sil bakiyeyi düzeltir
- [x] **Döngü detay:** döngü seçici, gün gün kümülatif grafik (bu döngü vs baz ay), kategori özeti, harcama düzenle/sil
- [x] **Ayarlar > Baz ay seçimi:** döngü listesi, tek dokunuşla baz ay (`set_baseline_cycle`), hata olursa eski seçime dönüş
- [x] **Ayarlar > Kategoriler:** ekle / düzenle (ad, tür, erişilebilir renk, anahtar kelimeler), harcamaları taşıyıp silme; yedek parser kullanıcının anahtar kelimelerini kullanır
- [x] **Sohbet geçmişi cihazlar arası:** mesajlar veritabanında (son 50 + "Daha eski mesajlar"); çevrimdışı yazılanlar cihazda bekler, bağlantı gelince kopyasız gönderilir
- [x] **PWA:** ana ekrana eklenebilir, çevrimdışı açılan kabuk, "Yeni sürüm var — Yenile" bildirimi

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
     | `20261002000000_recurring_and_roll_forward.sql` | Gelir ve sabit giderlere `recurring` (her ay tekrar eder), içe aktarmanın bunu taşıması ve döngü devri fonksiyonu `roll_forward_cycle` |
     | `20261003000000_category_management.sql` | Kategorilere `keywords` (yedek parser anahtar kelimeleri; mevcut varsayılan kategorilere de yazılır), taşı-sil fonksiyonu `delete_category`, içe aktarmada `keywords` |
     | `20261004000000_debt_payments.sql` | Borç ödeme geçmişi tablosu `debt_payments` (RLS) + bakiyeyi aynı işlemde güncelleyen tetikleyici |
     | `20261005000000_chat_messages.sql` | Sohbet geçmişi tablosu `chat_messages` (RLS) — cihazlar arası sohbet |

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
| `ALLOWED_ORIGINS` | Fonksiyonu tarayıcıdan çağırabilecek origin'ler, virgülle: `https://<alan-adın>,http://localhost:5173`. Boşsa yalnız localhost (5173/4173). Bkz. *Üretime alma*. |

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

**`app_system_prompt.md` değişirse fonksiyonu yeniden deploy et** — Edge Function bu metni system mesajı olarak kullanır;
değişiklik ancak deploy'dan sonra canlıya geçer: `npm run sync:prompt` → `npx supabase functions deploy chat-expense --no-verify-jwt`.
(Bir test, üretilen `system_prompt.ts` dosyasının md ile aynı olduğunu kontrol eder.)

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

### 5. Üretime alma (Vercel)

1. **Vercel projesi:** repoyu içe aktar (Framework: Vite; build `npm run build`, çıktı `dist`). *Environment Variables*:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (yerel `.env.local` ile aynı değerler). `vercel.json` SPA yönlendirmesini
   (`/sabit` gibi adresler yenilenince 404 olmaz) ve `sw.js`'in önbelleklenmemesini ayarlar.
2. **Supabase Auth:** *Authentication > URL Configuration* → *Site URL* = üretim adresi (ör. `https://butcem.vercel.app`);
   *Redirect URLs*'e aynı adresi (ve yerelde çalışmaya devam edeceksen `http://localhost:5173`) ekle. Aksi halde e-posta
   doğrulama bağlantıları yanlış adrese gider.
3. **Edge Function CORS:** `ALLOWED_ORIGINS` secret'ını üretim adresiyle ayarla ve fonksiyonu yeniden deploy et:

   ```bash
   npx supabase secrets set ALLOWED_ORIGINS="https://butcem.vercel.app,http://localhost:5173"
   npx supabase functions deploy chat-expense --no-verify-jwt
   ```

   Vercel önizleme adresleri için joker kullanılabilir: `https://fam-budget-*.vercel.app`. Listede olmayan bir origin'den
   gelen tarayıcı isteği 403 alır (Anthropic çağrılmaz). CORS yetkilendirme değildir; her istek ayrıca JWT ile doğrulanır.

## PWA (ana ekrana ekle + çevrimdışı)

Ayarlar [`pwa.config.ts`](pwa.config.ts)'te (vite-plugin-pwa / Workbox); güvenlik kararları `src/lib/pwaConfig.test.ts` ile kilitli.

- **Manifest:** "Bütçem", `standalone`, `portrait`, `tr`; ikonlar `public/` altında (192, 512, maskable 512, iOS için
  `apple-touch-icon.png` 180). İkonlar yer tutucudur; aynı adlarla değiştirilebilir.
- **Service worker:** yalnızca build çıktısını (JS/CSS/HTML kabuğu, ikonlar) önbelleğe alır; navigasyonlarda `index.html`'e
  düşer. **Kullanıcı verisi hiç önbelleğe alınmaz:** runtime cache yok; Supabase (Auth, REST, Edge Function) başka origin'de
  olduğu için SW bu isteklere dokunmaz, her zaman ağdan gider. Çevrimdışıyken uygulama açılır, veri ekranları "çevrimdışı"
  mesajı gösterir; sohbetten girilen harcamalar cihazdaki kuyrukta bekler ve bağlantı gelince gönderilir.
- **Oturum:** açılışta oturum yerelden okunur (çevrimdışı açılabilsin), çevrimiçiyse Auth sunucusunda doğrulanır; sunucu
  geçersiz sayarsa (401/403) yerel oturum kapatılır.
- **Güncelleme:** `registerType: 'prompt'` — yeni sürüm yüklenince üstte "Yeni sürüm var — Yenile" çıkar; sessiz güncelleme
  yok. Açık kalan uygulama saatte bir yeni sürüm kontrol eder.
- **iOS:** `apple-mobile-web-app-*` etiketleri, `viewport-fit=cover`; alt tab bar ve sohbet kutusu
  `env(safe-area-inset-bottom)` ile güvenli alana oturur. Durum çubuğu rengi (`theme-color`) seçili temanın zeminine eşitlenir.
- **Yerelde deneme:** `npm run build && npx vite preview` → http://localhost:4173 (SW yalnızca üretim derlemesinde çalışır).
  Chrome DevTools > Application: Manifest ve Service Worker; Network > Offline ile çevrimdışı açılış.

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
- **Geçmiş cihazlar arası:** mesajlar `chat_messages` tablosunda; açılışta son 50 mesaj yüklenir, üstteki
  "Daha eski mesajlar" ile 50'şer geriye gidilir. Her yeni ya da değişen mesaj (geri alındı, kuyruktan gönderildi) önce
  cihazdaki gönderim kuyruğuna (`butcem:chat-queue:<kullanıcı>`) yazılır, sonra `id` ile upsert edilir; bağlantı yoksa
  kuyrukta bekler ve `online` olayında gönderilir — tekrar denemek kopya üretmez. Önceki sürümün yalnız bu cihazda tutulan
  geçmişi ilk açılışta bir kez veritabanına aktarılır. Mantık [`chatHistory.ts`](src/lib/chatHistory.ts) (testli);
  veritabanı testleri `supabase/tests/chat-messages.test.ts`.
- **Tekrar hatırlatması:** kaydedilen kategoride son 7 günde (bugün dahil, döngü içinde) kaç farklı günde harcama
  yapıldığını ve kategorinin döngü toplamını KOD hesaplar ([`repeat.ts`](src/lib/repeat.ts)); hatırlatma kararını da kod
  verir: yalnızca kısılabilir kategoride ve ≥ 4 günde `hatirlat: true`. Bu bilgi cevap çağrısına `context.repeat` olarak
  gider; yapay zeka yalnızca verilen sayılarla tek cümlelik nazik bir hatırlatma yazar (rakam doğrulaması bu sayıları da
  kapsar). Yedek parser yolunda hatırlatma yoktur.

## Veritabanı

| Tablo | Açıklama |
|---|---|
| `categories` | Kullanıcının kategorileri (`key`, `label`, `type`, `color`, `keywords`). Yeni kullanıcıya 10 varsayılan kategori trigger ile eklenir (bkz. *Kategori renkleri*, *Kategori yönetimi*). |
| `cycles` | Maaş gününe (15'i) bağlı döngüler. `key` (ör. `2026-09`) içe aktarmada idempotent upsert için kullanılır. Kullanıcı başına en fazla bir `is_baseline`. |
| `income`, `fixed_expenses`, `variable_expenses` | Döngüye bağlı kayıtlar; döngü silinince silinir. `fixed_expenses.installments_left`: kalan taksit (taksit değilse NULL). |
| `debts` | Borçlar. `due_date` `YYYY-MM` veya `YYYY-MM-DD`. |
| `chat_messages` | Sohbet mesajları (`role` `user`/`assistant`, `content`, `meta` — kaydedilen kalemler, geri alındı, cevabı kim yazdı; `related_expense_id`). `id` ve `created_at` istemciden gelir: çevrimdışı kuyruktan upsert kopya üretmez, geç gönderilen mesaj kendi zamanında sıralanır. |
| `debt_payments` | Borç ödemeleri (`debt_id`, `date`, `amount`, `note`). Borca `(debt_id, user_id)` bileşik FK ile bağlı; borç silinince silinir. Ekle / sil / tutar düzenle, tetikleyiciyle borcun `balance`'ını aynı işlemde günceller; kalan bakiyeden büyük ödeme reddedilir. |

| RPC | Açıklama |
|---|---|
| `set_baseline_cycle(uuid)` | Baz ayı tek işlemde değiştirir. |
| `roll_forward_cycle(uuid)` | Döngü devri — kaynak döngüden sonraki döngüyü tek işlemde üretir (bkz. *Döngü devri*). İdempotent. |
| `delete_category(text, text)` | Kategoriyi siler; harcaması varsa ikinci parametredeki kategoriye taşıyıp siler (tek işlem). Hedefsiz çağrı, harcaması olan kategoride hata verir; son kategori silinemez. |
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

## Kategori yönetimi (Ayarlar > Kategoriler)

- **Ekle / düzenle:** ad, tür (zorunlu / kısılabilir / yarı zorunlu / borç ödemesi), renk ve isteğe bağlı anahtar kelimeler
  (virgülle). `key` addan üretilir ve kullanıcı içinde tekildir (`spor`, çakışırsa `spor-2` …); ad sonradan değişse de
  `key` sabit kalır (harcamalar ona bağlı). Aynı ad (Türkçe harf / büyük-küçük duyarsız) reddedilir.
- **Renk erişilebilirliği:** renk açık (#ffffff) ve koyu (#0f172a) zeminde ≥ 3:1 kontrast sağlamalı; sağlamazsa kaydedilmez,
  hangi temada sorun olduğu söylenir ve aynı tonda geçen bir renk önerilir ("Okunur tonu kullan").
- **Sil:** harcaması yoksa iki adımlı onay. Varsa önce hedef kategori seçilir; `delete_category` harcamaları taşır ve
  kategoriyi tek işlemde siler.
- **Yedek parser:** internet / yapay zeka yokken kategori, kullanıcının kategorilerindeki anahtar kelimelerle bulunur
  (kategori sırasıyla; 4+ harfli kelime kelime başında eşleşir — "market" → "marketten"; kısa kelimeler tam kelime).
  Hiçbiri tutmazsa "sosyal", o yoksa ilk kategori. Varsayılan kelimeler tek kaynaktadır (`_shared/categories.ts`).
- **Yapay zeka:** kategori enum'u kullanıcının gerçek key'lerinden üretilir; ad ve anahtar kelimeler `context.categories`
  içinde gider (sistem promptu buna göre güncellendi).
- Saf mantık [`src/lib/categories.ts`](src/lib/categories.ts) (testli); veritabanı testleri `supabase/tests/category-management.test.ts`.

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

## Gelir ve sabit giderler / ödeme takvimi

*Sabit* sekmesinde iki bölüm vardır: üstte **Gelir** (toplam / alınan / beklenen özeti, gün sıralı liste, alındı anahtarı,
ekle / düzenle / sil; kaynak için Maaş · Kinderzuschlag · Wohngeld hızlı seçimi ya da serbest metin), altında **Sabit
giderler**. Gelir toplamları [`src/lib/income.ts`](src/lib/income.ts)'ten gelir; dashboard'daki "Toplam gelir" kartı da aynı
fonksiyonu kullanır. Gelir ve sabit gider kalemleri "Her ay tekrar eder" (`recurring`) işaretini taşır; kaldırılırsa kalem
"tek seferlik" rozetiyle gösterilir ve döngü devrinde taşınmaz. Kalan taksit sayısı bu döngününkini de içerir (1 = son taksit).

Sabit gider listesi aktif döngünün sabit giderlerini ödeme gününe göre gösterir. Toplamlar (toplam / ödenen / kalan) ve
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
kartı da aynı fonksiyonu kullanır).

- **Sıralama:** faizliler önce, faiz metninden okunan orana göre yüksekten düşüğe ("~%17,5/yıl" → 17,5; okunamazsa sona);
  sonra faizsizler öncelik numarasına göre. Eşitlikte öncelik, sonra yüksek bakiye, sonra ad.
- **"Önce bunu öde":** listede en üstteki (en pahalı) kapanmamış faizli borç. Tüm faizliler kırmızı vurgulanır.
- **Vade:** `YYYY-MM-DD` ya da yalnız ay (`YYYY-MM`, hesapta ayın ilk günü sayılır). Bugünden 0–30 gün içindeyse
  "vade yaklaşıyor", geçmişse "vadesi geçti".
- Bakiye Türkçe biçimde girilir ("6.026,31").
- **Ödeme geçmişi:** kartın altındaki "Ödeme ekle · geçmiş" → tarih (gelecek olamaz), tutar, not. Kayıt ve bakiye düşüşü
  veritabanında tek işlemdir (`debt_payments` tetikleyicisi); ödeme kalan bakiyeden büyük olamaz, formda "ödeme sonrası
  kalan" önizlemesi gösterilir. Geçmiş en yeni önce listelenir, toplam ödenen gösterilir. Ödemeyi silmek tutarı bakiyeye
  geri ekler; tutarı düzenlemek farkı yansıtır. Tutarlar sent cinsinden hesaplanır
  ([`debtPayments.ts`](src/lib/debtPayments.ts)); testler `supabase/tests/debt-payments.test.ts`.
  Borç formunda bakiyeyi elle değiştirmek hâlâ mümkündür (düzeltme için). Ödeme geçmişi JSON dışa aktarmaya dahil değildir.

## Döngü devri (otomatik yeni döngü)

Her ayın 15'inde uygulama JSON içe aktarmaya gerek kalmadan yeni döngüye geçer:

- **Ne zaman:** uygulama açılışında (ekranlar veriyi yüklemeden önce), bugünü kapsayan döngü yoksa ve bugün en yeni döngünün
  bitişinden sonraysa. Sohbetten harcama girilirken ya da çevrimdışı kuyruk gönderilirken döngü yoksa da aynı devir
  kullanılır; boş döngü yalnızca hiç döngüsü olmayan yeni kullanıcı için oluşturulur. Uzun süre girilmediyse aradaki
  döngüler sırayla üretilir (taksitler her döngüde bir azalır). Çevrimdışıyken beklenmez; ilk bağlantıda yapılır.
- **Ne taşınır** (`roll_forward_cycle`, tek işlem): yalnızca "Her ay tekrar eder" işaretli gelir ve sabit giderler —
  "alınmadı / ödenmedi" olarak; kalem, tutar, kaynak (kart vb.) ve ayın günü korunur (ayda o gün yoksa ay sonu: 31 → 30 Kas).
  Kalan taksit bir azalır; 1 ise (son taksit önceki döngüdeydi) kalem taşınmaz. Notlar (o aya özgü) ve değişken harcamalar
  taşınmaz. Baz ay değişmez.
- **İdempotent:** yeni döngünün başlangıç tarihini kapsayan döngü zaten varsa (önceden devredilmiş ya da içe aktarılmış)
  hiçbir şey kopyalanmaz.
- Karar fonksiyonları [`src/lib/rollForward.ts`](src/lib/rollForward.ts); kopyalama kuralları SQL'de; testler
  `supabase/tests/roll-forward.test.ts` (SQL ↔ TypeScript eşleri dahil).

**15'ini beklemeden deneme:** yeni bir test hesabı aç → *Ayarlar > Veriyi içe aktar* ile
[`ornek_devir_testi.json`](ornek_devir_testi.json) (yalnız Ağustos döngüsü; "Araç sigortası" tek seferlik) → sayfayı yenile.
Eylül döngüsü (15 Eyl – 14 Eki) kendiliğinden oluşmalı: tekrar eden kalemler ödenmedi / alınmadı, Araç sigortası yok,
Beyaz eşya taksiti "6 taksit kaldı".

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
    settings/                 Ayarlar > Kategoriler (liste + form)
  lib/
    compare.ts                kıyas motoru + döngü detay serileri (saf, testli)
    expenseEdit.ts            harcama düzenleme doğrulaması (saf, testli)
    budget.ts                 dashboard verisi → kıyas, KPI'lar, kategori dağılımı (saf, testli)
    chatFlow.ts               sohbet akışı: parse → onay → kaydet → kıyas → cevap (testli)
    chatText.ts               kodla üretilen özet + AI cevabı rakam doğrulaması
    chatHistory.ts, chatHistoryApi.ts  sohbet geçmişi: satır ↔ mesaj, birleştirme, gönderim kuyruğu (saf, testli) + Supabase
    fallbackParser.ts         kural tabanlı yedek parser (kullanıcının anahtar kelimeleriyle)
    categories.ts, categoriesApi.ts  kategori key/renk/anahtar kelime doğrulaması (saf, testli) + Supabase
    expensesApi.ts, outbox.ts harcama kaydı + çevrimdışı kuyruk
    transfer.ts               içe aktarma doğrulama / dışa aktarma (saf)
    fixed.ts, fixedApi.ts     sabit giderler: sıralama, toplamlar, durum (saf, testli) + Supabase
    income.ts, incomeApi.ts   gelir: toplamlar (alınan/beklenen), form (saf, testli) + Supabase
    rollForward.ts            döngü devri kararı (saf, testli); useCycleRollover açılışta çalıştırır
    debts.ts, debtsApi.ts     borçlar: toplamlar, sıralama, vade durumu (saf, testli) + Supabase
    debtPayments.ts, debtPaymentsApi.ts  borç ödemeleri: toplam, sınır, form (saf, testli) + Supabase
    cycle.ts, date.ts, money.ts
  pages/                      AuthPage, Dashboard, SettingsPage, ...
pwa.config.ts               PWA manifest + service worker ayarları
vercel.json                 SPA yönlendirmesi + önbellek başlıkları
supabase/
  functions/chat-expense/     Edge Function (Claude API, CORS izin listesi)
  migrations/                 şema + RLS + import_data
  tests/                      veritabanı ve Edge Function testleri
scripts/sync-system-prompt.mjs
```
