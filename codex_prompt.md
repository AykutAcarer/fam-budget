# Bütçe & Borç Takip Uygulaması — Yapım İstemi (Codex)

Aşağıdaki spesifikasyona göre eksiksiz, çalışan bir web uygulaması kur. Kod
temiz, modüler ve yorumlu olsun. Türkçe arayüz. Tüm para birimi EUR (€).

## 0) Teknoloji yığını (bunu kullan)
- **Vite + React + TypeScript**
- **Tailwind CSS** (mobile-first, responsive, dark mode destekli)
- **Supabase** (Auth + Postgres + Row Level Security + Edge Functions)
- **Recharts** (grafikler)
- **vite-plugin-pwa** (PWA / "Ana ekrana ekle" / offline)
- **react-router-dom** (yönlendirme), **dayjs** (tarih)

## 1) Uygulamanın amacı
Bir ailenin gelir, sabit gider, değişken harcama ve borçlarını takip etmesini
sağlayan uygulama. En önemli özellik: kullanıcı harcamalarını bir **sohbet (chat)
kutusundan serbest Türkçe metinle** girer (örn. "8,25 halısaha", "işte öğlen
atıştırmalık 3,72"). Uygulama bunu bir **yapay zeka** ile anlar, tutar+kategoriye
ayırır, kaydeder ve "baz ay" ile bu ayı kıyaslayıp **motive edici** bir cevap verir.

## 2) Döngü (cycle) mantığı — ÇOK ÖNEMLİ
- Döngü takvim ayı DEĞİL. **Her ayın 15'inde (maaş günü) başlar**, ertesi ayın
  14'ünde biter (payday-anchored). Örn: 15 Eylül–14 Ekim.
- Kullanıcı bir döngüyü **"baz ay" (baseline)** olarak işaretleyebilir.
- Kıyaslar hep **döngü günü** indeksine göre: 1. gün = 15'i, 2. gün = 16'sı ...

## 3) Kimlik doğrulama (Supabase Auth)
- E-posta + şifre ile Kayıt Ol / Giriş / Çıkış.
- Her kullanıcı yalnızca kendi verisini görür — **RLS zorunlu**.
- Yeni kullanıcı boş başlar (varsayılan kategorilerle).

## 4) Veritabanı şeması (Supabase / Postgres)
Tüm tablolarda `user_id uuid` (auth.users referansı) ve RLS: kullanıcı sadece
kendi satırlarını okur/yazar.
- **categories**: id, user_id, key, label, type ('zorunlu'|'kisilabilir'|'yari'
  |'borc'), color. Yeni kullanıcıya varsayılan 10 kategori eklenir (aşağıda).
- **cycles**: id, user_id, label, start_date, end_date, is_baseline.
- **income**: id, user_id, cycle_id, date, source, amount, received, note.
- **fixed_expenses**: id, user_id, cycle_id, date, item, amount, paid, source, note.
- **variable_expenses**: id, user_id, cycle_id, date, category, description,
  amount, created_at.
- **debts**: id, user_id, name, balance, interest, has_interest, due_date,
  priority, note.

### Varsayılan 10 kategori
| key | label | type | color |
|---|---|---|---|
| mutfak | Mutfak / Market | zorunlu | #22A06B |
| yakit | Yakıt | zorunlu | #E47007 |
| mensemax | MensaMax (okul yemeği) | zorunlu | #C026D3 |
| kahvalti | Kahvaltı | kisilabilir | #B78C11 |
| is | İş / öğlen / atıştırmalık | kisilabilir | #E23B3B |
| halisaha | Halı saha | kisilabilir | #3E89DE |
| sosyal | Sosyal / diğer | kisilabilir | #7C4DFF |
| temizlik | Temizlik / Rossmann | yari | #17A2B8 |
| hanim | Hanıma verilen | yari | #A1592B |
| kredi karti | Kredi kartı ödemesi | borc | #6B7280 |

Renkler erişilebilirlik doğrulamasından geçmiş paletten gelir: açık (#ffffff) ve koyu (#0f172a) zeminde
≥ 3:1 kontrast; donut'ta komşu dilimler renk körlüğünde ΔE ≥ 8, normal görüşte ΔE ≥ 15 ayrışır. Tek kaynak:
`supabase/functions/_shared/categories.ts` (veritabanı seed'i bunun aynasıdır; renk değişikliği orada yapılır).

## 5) Yapay zeka destekli sohbet girişi — MİMARİ
### 5.1 ALTIN KURAL: yapay zeka dili anlar, MATEMATİĞİ UYGULAMA yapar
Para hesabını (kümülatif toplam, baz ay kıyası, fark) ASLA yapay zekaya
yaptırma — dil modelleri sessizce yanlış toplayabilir. Tüm rakamlar uygulama
tarafından deterministik (kod ile) hesaplanır. Yapay zeka yalnızca (a) serbest
metni yapılandırır, (b) uygulamanın verdiği hazır rakamlarla motive edici cümle
yazar.

### 5.2 Akış (bir sohbet mesajı girildiğinde)
1. Uygulama, kullanıcının metnini + bağlamı (bugünün tarihi, aktif döngü,
   kategori listesi) bir **Supabase Edge Function**'a gönderir (`chat-expense`).
2. Edge Function, yapay zeka API'sini (sunucuda gizli anahtarla) çağırır ve
   `app_system_prompt.md` içeriğini **system** mesajı olarak verir. Yapay zeka
   `{expenses:[...], reply, clarify}` JSON döndürür (bkz. app_system_prompt.md).
   NOT: Bu ilk çağrıda uygulama henüz kıyas rakamlarını vermez; sadece PARSE için.
3. `clarify` doluysa (kategori belirsiz), uygulama kullanıcıya sorar, onay alır.
4. Uygulama `expenses` kalemlerini `variable_expenses`'e kaydeder (aktif döngüye).
5. Uygulama, **kesin kıyas rakamlarını kod ile hesaplar** (bu ay dörtlü kümülatif,
   baz ay aynı-gün kümülatif, fark, ilgili kategori durumu).
6. Uygulama ikinci kez Edge Function'ı çağırır; bu sefer `context.comparison`
   içine bu hazır rakamları koyar. Yapay zeka yalnızca motive edici Türkçe cevabı
   yazar (`reply`). Bu cevap sohbet balonu olarak gösterilir.
   (Alternatif optimizasyon: 4. adımdan sonra rakamları hesaplayıp tek bir
   "yaz" çağrısı yeterli; ama parse ve yazma ayrı tutulmalı.)

### 5.3 Offline / hata yedeği (kural tabanlı parser)
İnternet yoksa veya Edge Function/AI başarısız olursa harcama KAYBOLMAMALI.
Basit bir kural tabanlı yedek parser bulunsun:
- Tutar: metindeki ilk sayı (Türkçe virgül ondalık: "8,25"=8.25).
- Kategori: anahtar-kelime haritası (app_system_prompt.md'deki kategori
  tanımlarının aynısı); hiçbiri tutmazsa "sosyal".
- Bu durumda kayıt yapılır, kıyas kartı yine kod ile hesaplanıp gösterilir,
  sadece "motive edici cümle" yerine sade bir özet gösterilir.

### 5.4 Yapay zeka sağlayıcı — ANTHROPIC CLAUDE API
Sohbet zekası **Anthropic Claude API** ile çalışır (bkz. EK: Claude API
Entegrasyonu). Küçük, hızlı bir model kullan (ör. Claude Haiku sınıfı), model
adı bir ortam değişkeninde tutulsun. API anahtarı (`ANTHROPIC_API_KEY`) yalnızca
Supabase Edge Function'ın secret'ında durur; istemci (tarayıcı) koduna ASLA
konmaz. Yapılandırılmış çıktı için Claude'un **tool use** özelliğini kullan
(aşağıdaki EK bölümü).

## 6) Ekranlar
Mobil için altta sabit tab bar: Ana Ekran · Döngü · Sabit · Borçlar · Ayarlar.

### A) Ana Ekran (Dashboard) — en önemli ekran
- Üstte: aktif döngü etiketi + bugün döngünün kaçıncı günü.
- **Kısılabilir dörtlü kıyas kartı** (baz ay vs bu ay, aynı güne kadar kümülatif):
  dörtlü = kahvalti+is+halisaha+sosyal. "Bu ay X € · Baz ay Y € · Fark −Z €".
  Öndeyse yeşil + 🎯, gerideyse kırmızı + nazik uyarı. (Rakamları kod hesaplar.)
- **Sohbet kutusu** (altta sabit): harcama buraya yazılır; girişler ve AI cevapları
  sohbet akışı gibi listelenir (bkz. bölüm 5).
- **Kategori dağılımı**: bu döngü değişken harcamaların donut grafiği (kategori
  renkleriyle).
- **KPI kartları**: toplam gelir, sabit gider (ödenen/kalan), toplam değişken,
  bu döngü kredi kartı ödemesi.

### B) Döngü Detay
- Döngü seçici (geçmiş döngüler dahil).
- **Kategori özet tablosu**: her kategori bu döngü vs baz ay (renkli, tip rozetli).
- **Gün gün kümülatif çizgi grafiği**: bu döngü vs baz ay (kısılabilir dörtlü),
  x = döngü günü.
- Tarih sıralı, renklendirilmiş değişken harcama listesi (düzenle/sil).

### C) Sabit Giderler / Ödeme Takvimi
- Ödeme gününe göre sıralı; her kalemde ödendi/ödenecek toggle.
- Toplam ödenen/kalan; yaklaşan (3 gün) ödemeleri üstte vurgula.

### D) Borçlar
- Ad, bakiye, faiz, vade, öncelik; toplam borç.
- Faizli (kredi kartı) kırmızı vurgu + "önce bunu öde"; faizsizler öncelik sırası.

### E) Ayarlar
- **Veriyi içe aktar (JSON)** / **dışa aktar (JSON)** (yedek). Format bölüm 8.
- **Baz ay seç**; **kategori yönetimi** (ekle/düzenle/renk); **tema** (açık/koyu/
  sistem); **yapay zeka modeli** seçimi (opsiyonel); Çıkış.

## 7) Tasarım
Modern, temiz, kart bazlı (rounded-2xl, ince gölge, ferah boşluk). Kategori
renkleri her yerde tutarlı. Koyu mod ilk sınıf; her renk iki modda okunur. Büyük
dokunma hedefleri, alt tab bar sabit. Sohbet kutusu WhatsApp benzeri hissettirsin.
Sıcak, motive edici Türkçe mikro-metinler.

## 8) İçe aktarma (seed) formatı
Kullanıcı Ayarlar > İçe Aktar'dan şu yapıda JSON yükler; ilgili tablolara
kullanıcının hesabına yaz (aynı id'li döngü varsa üzerine yaz — idempotent):
```
{
  "meta": {...},
  "categories": [ {key,label,type,color}, ... ],
  "debts": [ {name,balance,interest,hasInterest,dueDate,priority,note}, ... ],
  "cycles": [
    { "id","label","start","end","isBaseline",
      "income":[{date,source,amount,received,note?}],
      "fixed":[{date,item,amount,paid,source?,note?}],
      "variable":[{date,category,description,amount}] }, ...
  ]
}
```

## 9) PWA
manifest.json (ad "Bütçem", tema rengi, 192/512 ikon), service worker (offline
kabuk + son veriyi cache), "Ana ekrana ekle" (iOS Safari + Android Chrome),
standalone görünüm.

## 10) Kabul kriterleri
- Kayıt → giriş → boş dashboard.
- Ayarlar'dan örnek JSON içe aktar → döngüler, kıyas grafiği, sabit giderler,
  borçlar dolu gelir.
- Sohbete "8,25 halısaha" → AI "halısaha / 8,25 €" olarak anlar → kaydedilir →
  kıyas kartı kod ile güncellenir → AI motive edici cevap verir.
- "işte öğlen atıştırmalık 3,72" → kategori "is".
- "20 döner" → "sosyal".
- İnternet kapalıyken bile harcama kural tabanlı yedekle kaydedilir.
- Para matematiği her zaman koddan; AI sadece dil + motivasyon.
- Bir kullanıcı diğerinin verisini ASLA göremez (RLS test edilmiş).
- Telefonda responsive, ana ekrana eklenebilir, çevrimdışı açılır.

README: kurulum, Supabase env değişkenleri (URL + anon key), Edge Function
secret'ı (`ANTHROPIC_API_KEY` + model adı), tabloları + RLS politikalarını kuran
SQL, ve Edge Function `chat-expense` kodu (Claude API çağrısı).


---
## EK: Claude API Entegrasyonu (Edge Function içinde)
Sohbet zekası Anthropic Claude Messages API ile çalışır. Edge Function
(Deno/TypeScript) şu şekilde çağırır:

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`
- **Header'lar:**
  - `x-api-key: <ANTHROPIC_API_KEY>` (secret'tan)
  - `anthropic-version: 2023-06-01`
  - `content-type: application/json`
- **Gövde:**
  - `model`: env'den (ör. hızlı bir Haiku modeli). Güncel model adını
    Anthropic dokümanından doğrula; kod adı sabit yazma, env kullan.
  - `max_tokens`: ~500
  - `system`: `app_system_prompt.md` içeriğinin TAMAMI
  - `messages`: `[{ "role": "user", "content": <kullanıcının chat metni +
    JSON context> }]`

### Güvenilir yapılandırılmış çıktı için TOOL USE kullan
Serbest JSON yerine, Claude'a bir "tool" (fonksiyon) tanımla ve
`tool_choice` ile o tool'u kullanmaya zorla. Böylece çıktı şemaya uyar:

- **tools**: tek bir tool, adı `harcama_kaydet`, `input_schema` şu alanlarla:
  - `expenses`: array of { amount:number, category:string(enum: 10 key),
    date:string, description:string, needsConfirm:boolean }
  - `reply`: string
  - `clarify`: string | null
- **tool_choice**: `{ "type": "tool", "name": "harcama_kaydet" }`

Claude cevabında `content` içindeki `type:"tool_use"` bloğunun `input` alanı
tam olarak istediğin JSON'dur; Edge Function bunu doğrudan kullanır. (Böylece
metin ayrıştırma/`JSON.parse` riskine gerek kalmaz.)

### İki aşama (bölüm 5.2'deki akış)
1. **Parse çağrısı:** context = { today, aktif döngü, kategori listesi }.
   Claude sadece `expenses` + varsa `clarify` üretir (henüz kıyas yok).
2. Uygulama kaydeder ve kıyas rakamlarını KOD ile hesaplar.
3. **Yazma çağrısı:** context = { comparison: {cycleDay, dortluBuAy,
   dortluBazAy, fark, kategoriBuAy, kategoriBazAyTumAy} }. Claude yalnızca
   `reply` (motive edici Türkçe cümle) üretir. Bu rakamları DEĞİŞTİRMEDEN kullanır.

Not (maliyet): her chat mesajı ~1-2 küçük Claude çağrısı; Haiku sınıfı model ile
çok düşük maliyet. Offline/hata durumunda bölüm 5.3'teki kural tabanlı yedek devreye girer.

---
EK DOSYA: Sohbet AI'ının davranışı ve çıktı sözleşmesi için `app_system_prompt.md`
dosyasını kullan; Edge Function bu metni system mesajı olarak yapay zekaya verir.
