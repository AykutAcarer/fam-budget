-- =============================================================================
-- Kısılabilir kategoriler kullanıcı tarafından seçilebilir
--
-- categories.is_cuttable: kategori baz ay kıyasına ("kısılabilir harcamalar") ve
-- tekrar hatırlatmasına dahil mi? Önceden kodda sabit dört kategoriydi
-- (kahvalti, is, halisaha, sosyal); backfill ile mevcut kullanıcılarda aynı dört
-- kategori işaretlenir — kullanıcı hiçbir şeye dokunmadan davranış aynı kalır.
-- Yeni eklenen kategoriler varsayılan olarak kısılabilir değildir.
-- RLS değişmez: alan kullanıcının kendi kategori satırındadır.
-- =============================================================================

alter table public.categories
  add column if not exists is_cuttable boolean not null default false;

update public.categories
   set is_cuttable = true
 where key in ('kahvalti', 'is', 'halisaha', 'sosyal');

-- Seed — _shared/categories.ts'in aynası (supabase/tests/category-colors.test.ts)
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, key, label, type, color, sort_order, keywords, is_cuttable) values
    (p_user_id, 'mutfak',      'Mutfak / Market',            'zorunlu',     '#22A06B', 1,
      array['market', 'mutfak', 'et', 'eti', 'etten', 'manav', 'bakkal', 'kasap'], false),
    (p_user_id, 'yakit',       'Yakıt',                      'zorunlu',     '#E47007', 2,
      array['benzin', 'mazot', 'dizel', 'depo', 'yakıt'], false),
    (p_user_id, 'mensemax',    'MensaMax (okul yemeği)',     'zorunlu',     '#C026D3', 3,
      array['mensemax', 'mensamax', 'mensa', 'okul yemeği'], false),
    (p_user_id, 'kahvalti',    'Kahvaltı',                   'kisilabilir', '#B78C11', 4,
      array['kahvaltı', 'poğaça', 'simit', 'börek'], true),
    (p_user_id, 'is',          'İş / öğlen / atıştırmalık',  'kisilabilir', '#E23B3B', 5,
      array['iş', 'işte', 'iş yeri', 'işyeri', 'öğle', 'atıştırmalık', 'kahve', 'mola'], true),
    (p_user_id, 'halisaha',    'Halı saha',                  'kisilabilir', '#3E89DE', 6,
      array['halı saha', 'halısaha', 'maç', 'maça', 'maçta', 'saha kira'], true),
    (p_user_id, 'sosyal',      'Sosyal / diğer',             'kisilabilir', '#7C4DFF', 7,
      array['döner', 'dondurma', 'sinema', 'oyuncak', 'giyim', 'gezme', 'yemek', 'restoran', 'pizza', 'kafe'], true),
    (p_user_id, 'temizlik',    'Temizlik / Rossmann',        'yari',        '#17A2B8', 8,
      array['rossmann', 'dm', 'deterjan', 'temizlik', 'kişisel bakım'], false),
    (p_user_id, 'hanim',       'Hanıma verilen',             'yari',        '#A1592B', 9,
      array['eşime', 'eşim', 'hanım', 'hanıma', 'hanımım', 'harçlık'], false),
    (p_user_id, 'kredi karti', 'Kredi kartı ödemesi',        'borc',        '#6B7280', 10,
      array['kredi kart', 'kk'], false)
  on conflict (user_id, key) do nothing;
$$;

revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;
