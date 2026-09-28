-- =============================================================================
-- Erişilebilir kategori renk paleti
--
-- Tek kaynak: supabase/functions/_shared/categories.ts (DEFAULT_CATEGORIES,
-- LEGACY_PASTEL_COLORS). Bu dosya onun aynasıdır;
-- supabase/tests/category-colors.test.ts ikisinin eşleştiğini doğrular.
--
-- 1) Yeni kullanıcılar için varsayılan kategori seed'i yeni renklerle.
-- 2) Mevcut kullanıcılar: rengi hâlâ ESKİ pastel varsayılan olan kategoriler
--    yeni renge taşınır. Kullanıcının kendi seçtiği renklere dokunulmaz.
-- =============================================================================

create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, key, label, type, color, sort_order) values
    (p_user_id, 'mutfak',      'Mutfak / Market',            'zorunlu',     '#22A06B', 1),
    (p_user_id, 'yakit',       'Yakıt',                      'zorunlu',     '#E47007', 2),
    (p_user_id, 'mensemax',    'MensaMax (okul yemeği)',     'zorunlu',     '#C026D3', 3),
    (p_user_id, 'kahvalti',    'Kahvaltı',                   'kisilabilir', '#B78C11', 4),
    (p_user_id, 'is',          'İş / öğlen / atıştırmalık',  'kisilabilir', '#E23B3B', 5),
    (p_user_id, 'halisaha',    'Halı saha',                  'kisilabilir', '#3E89DE', 6),
    (p_user_id, 'sosyal',      'Sosyal / diğer',             'kisilabilir', '#7C4DFF', 7),
    (p_user_id, 'temizlik',    'Temizlik / Rossmann',        'yari',        '#17A2B8', 8),
    (p_user_id, 'hanim',       'Hanıma verilen',             'yari',        '#A1592B', 9),
    (p_user_id, 'kredi karti', 'Kredi kartı ödemesi',        'borc',        '#6B7280', 10)
  on conflict (user_id, key) do nothing;
$$;

revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

update public.categories as c
   set color = v.new_color
  from (values
    ('mutfak',      '#C6EFCE', '#22A06B'),
    ('yakit',       '#FFD966', '#E47007'),
    ('mensemax',    '#FF99CC', '#C026D3'),
    ('kahvalti',    '#FFF2CC', '#B78C11'),
    ('is',          '#F4B183', '#E23B3B'),
    ('halisaha',    '#9DC3E6', '#3E89DE'),
    ('sosyal',      '#D9D2E9', '#7C4DFF'),
    ('temizlik',    '#CC99FF', '#17A2B8'),
    ('hanim',       '#99E6E6', '#A1592B'),
    ('kredi karti', '#BFBFBF', '#6B7280')
  ) as v(key, old_color, new_color)
 where c.key = v.key
   and upper(c.color) = v.old_color;
