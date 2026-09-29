-- =============================================================================
-- Kategori yönetimi (Ayarlar > Kategoriler)
--
-- 1) categories.keywords: yedek (çevrimdışı) parser'ın anahtar kelimeleri.
--    Varsayılan kategorilere _shared/categories.ts'teki kelimeler yazılır
--    (mevcut kullanıcılar dahil; yalnız boş olanlara).
-- 2) seed_default_categories: yeni kullanıcılar keywords ile başlar.
-- 3) delete_category(key, move_to): harcaması olan kategori, harcamaları başka
--    kategoriye taşınarak TEK İŞLEMDE silinir.
-- 4) import_data: dosyadaki isteğe bağlı categories[].keywords yazılır. Geri
--    kalanı 20261002000000_recurring_and_roll_forward.sql ile aynıdır.
-- =============================================================================

alter table public.categories
  add column keywords text[] not null default '{}'
  check (cardinality(keywords) <= 50);

-- -----------------------------------------------------------------------------
-- 1) Mevcut varsayılan kategorilere anahtar kelimeler
-- -----------------------------------------------------------------------------
update public.categories as c
   set keywords = v.keywords
  from (values
    ('mutfak',      array['market', 'mutfak', 'et', 'eti', 'etten', 'manav', 'bakkal', 'kasap']),
    ('yakit',       array['benzin', 'mazot', 'dizel', 'depo', 'yakıt']),
    ('mensemax',    array['mensemax', 'mensamax', 'mensa', 'okul yemeği']),
    ('kahvalti',    array['kahvaltı', 'poğaça', 'simit', 'börek']),
    ('is',          array['iş', 'işte', 'iş yeri', 'işyeri', 'öğle', 'atıştırmalık', 'kahve', 'mola']),
    ('halisaha',    array['halı saha', 'halısaha', 'maç', 'maça', 'maçta', 'saha kira']),
    ('sosyal',      array['döner', 'dondurma', 'sinema', 'oyuncak', 'giyim', 'gezme', 'yemek', 'restoran', 'pizza', 'kafe']),
    ('temizlik',    array['rossmann', 'dm', 'deterjan', 'temizlik', 'kişisel bakım']),
    ('hanim',       array['eşime', 'eşim', 'hanım', 'hanıma', 'hanımım', 'harçlık']),
    ('kredi karti', array['kredi kart', 'kk'])
  ) as v(key, keywords)
 where c.key = v.key
   and c.keywords = '{}';

-- -----------------------------------------------------------------------------
-- 2) Seed — _shared/categories.ts'in aynası (supabase/tests/category-colors.test.ts)
-- -----------------------------------------------------------------------------
create or replace function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, key, label, type, color, sort_order, keywords) values
    (p_user_id, 'mutfak',      'Mutfak / Market',            'zorunlu',     '#22A06B', 1,
      array['market', 'mutfak', 'et', 'eti', 'etten', 'manav', 'bakkal', 'kasap']),
    (p_user_id, 'yakit',       'Yakıt',                      'zorunlu',     '#E47007', 2,
      array['benzin', 'mazot', 'dizel', 'depo', 'yakıt']),
    (p_user_id, 'mensemax',    'MensaMax (okul yemeği)',     'zorunlu',     '#C026D3', 3,
      array['mensemax', 'mensamax', 'mensa', 'okul yemeği']),
    (p_user_id, 'kahvalti',    'Kahvaltı',                   'kisilabilir', '#B78C11', 4,
      array['kahvaltı', 'poğaça', 'simit', 'börek']),
    (p_user_id, 'is',          'İş / öğlen / atıştırmalık',  'kisilabilir', '#E23B3B', 5,
      array['iş', 'işte', 'iş yeri', 'işyeri', 'öğle', 'atıştırmalık', 'kahve', 'mola']),
    (p_user_id, 'halisaha',    'Halı saha',                  'kisilabilir', '#3E89DE', 6,
      array['halı saha', 'halısaha', 'maç', 'maça', 'maçta', 'saha kira']),
    (p_user_id, 'sosyal',      'Sosyal / diğer',             'kisilabilir', '#7C4DFF', 7,
      array['döner', 'dondurma', 'sinema', 'oyuncak', 'giyim', 'gezme', 'yemek', 'restoran', 'pizza', 'kafe']),
    (p_user_id, 'temizlik',    'Temizlik / Rossmann',        'yari',        '#17A2B8', 8,
      array['rossmann', 'dm', 'deterjan', 'temizlik', 'kişisel bakım']),
    (p_user_id, 'hanim',       'Hanıma verilen',             'yari',        '#A1592B', 9,
      array['eşime', 'eşim', 'hanım', 'hanıma', 'hanımım', 'harçlık']),
    (p_user_id, 'kredi karti', 'Kredi kartı ödemesi',        'borc',        '#6B7280', 10,
      array['kredi kart', 'kk'])
  on conflict (user_id, key) do nothing;
$$;

revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3) delete_category — taşı ve sil (tek işlem)
--
-- Harcaması yoksa doğrudan siler. Varsa p_move_to zorunludur: tüm harcamalar
-- oraya taşınır, sonra kategori silinir. Taşınan harcama sayısını döner.
-- security invoker: RLS geçerli, yalnız kendi kategorilerin görünür.
-- -----------------------------------------------------------------------------
create function public.delete_category(p_key text, p_move_to text default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_count integer;
  v_moved integer := 0;
begin
  if v_uid is null then
    raise exception 'Oturum gerekli' using errcode = '42501';
  end if;

  perform 1 from public.categories where user_id = v_uid and key = p_key for update;
  if not found then
    raise exception 'Kategori bulunamadı' using errcode = 'P0002';
  end if;

  if (select count(*) from public.categories where user_id = v_uid) <= 1 then
    raise exception 'En az bir kategori kalmalı' using errcode = '22023';
  end if;

  select count(*) into v_count from public.variable_expenses where user_id = v_uid and category = p_key;

  if v_count > 0 then
    if p_move_to is null then
      raise exception 'Bu kategoride % harcama var; önce başka bir kategoriye taşı', v_count using errcode = '23503';
    end if;
    if p_move_to = p_key then
      raise exception 'Harcamalar silinen kategoriye taşınamaz' using errcode = '22023';
    end if;
    perform 1 from public.categories where user_id = v_uid and key = p_move_to;
    if not found then
      raise exception 'Hedef kategori bulunamadı' using errcode = 'P0002';
    end if;

    update public.variable_expenses set category = p_move_to where user_id = v_uid and category = p_key;
    get diagnostics v_moved = row_count;
  end if;

  delete from public.categories where user_id = v_uid and key = p_key;
  return v_moved;
end;
$$;

revoke execute on function public.delete_category(text, text) from public, anon;
grant execute on function public.delete_category(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4) import_data — categories[].keywords
-- -----------------------------------------------------------------------------
create or replace function public.import_data(p_data jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_cycle       jsonb;
  v_cycle_id    uuid;
  v_baseline_id uuid;
  v_debt        jsonb;
  v_rows        integer;
  n_categories  integer := 0;
  n_debts       integer := 0;
  n_cycles      integer := 0;
  n_income      integer := 0;
  n_fixed       integer := 0;
  n_variable    integer := 0;
begin
  if v_uid is null then
    raise exception 'Oturum gerekli' using errcode = '42501';
  end if;

  -- Kategoriler: yalnızca eksik olanları ekle (mevcut kategorinin ayarları korunur).
  insert into public.categories (key, label, type, color, sort_order, keywords)
  select x->>'key', x->>'label', x->>'type', x->>'color', i::integer,
         case when jsonb_typeof(x->'keywords') = 'array'
              then array(select jsonb_array_elements_text(x->'keywords'))
              else '{}'::text[] end
    from jsonb_array_elements(coalesce(p_data->'categories', '[]'::jsonb)) with ordinality as t(x, i)
  on conflict (user_id, key) do nothing;
  get diagnostics n_categories = row_count;

  -- Borçlar: ada göre güncelle ya da ekle.
  for v_debt in select * from jsonb_array_elements(coalesce(p_data->'debts', '[]'::jsonb)) loop
    update public.debts set
        balance      = (v_debt->>'balance')::numeric,
        interest     = v_debt->>'interest',
        has_interest = coalesce((v_debt->>'hasInterest')::boolean, false),
        due_date     = v_debt->>'dueDate',
        priority     = coalesce((v_debt->>'priority')::integer, 100),
        note         = v_debt->>'note'
      where lower(btrim(name)) = lower(btrim(v_debt->>'name'));
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      insert into public.debts (name, balance, interest, has_interest, due_date, priority, note)
      values (
        btrim(v_debt->>'name'),
        (v_debt->>'balance')::numeric,
        v_debt->>'interest',
        coalesce((v_debt->>'hasInterest')::boolean, false),
        v_debt->>'dueDate',
        coalesce((v_debt->>'priority')::integer, 100),
        v_debt->>'note'
      );
    end if;
    n_debts := n_debts + 1;
  end loop;

  -- Döngüler ve kayıtları.
  for v_cycle in select * from jsonb_array_elements(coalesce(p_data->'cycles', '[]'::jsonb)) loop
    -- is_baseline burada yazılmaz; tek-baz-ay kuralı aşağıda set_baseline_cycle ile korunur.
    insert into public.cycles (key, label, start_date, end_date)
    values (v_cycle->>'id', v_cycle->>'label', (v_cycle->>'start')::date, (v_cycle->>'end')::date)
    on conflict (user_id, key) do update
      set label = excluded.label, start_date = excluded.start_date, end_date = excluded.end_date
    returning id into v_cycle_id;
    n_cycles := n_cycles + 1;

    delete from public.income            where cycle_id = v_cycle_id;
    delete from public.fixed_expenses    where cycle_id = v_cycle_id;
    delete from public.variable_expenses where cycle_id = v_cycle_id;

    insert into public.income (cycle_id, date, source, amount, received, note, recurring)
    select v_cycle_id, (x->>'date')::date, x->>'source', (x->>'amount')::numeric,
           coalesce((x->>'received')::boolean, false), x->>'note',
           coalesce((x->>'recurring')::boolean, true)
      from jsonb_array_elements(coalesce(v_cycle->'income', '[]'::jsonb)) as t(x);
    get diagnostics v_rows = row_count;
    n_income := n_income + v_rows;

    insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, note, installments_left, recurring)
    select v_cycle_id, (x->>'date')::date, x->>'item', (x->>'amount')::numeric,
           coalesce((x->>'paid')::boolean, false), x->>'source', x->>'note',
           (x->>'installmentsLeft')::integer, coalesce((x->>'recurring')::boolean, true)
      from jsonb_array_elements(coalesce(v_cycle->'fixed', '[]'::jsonb)) as t(x);
    get diagnostics v_rows = row_count;
    n_fixed := n_fixed + v_rows;

    insert into public.variable_expenses (cycle_id, date, category, description, amount)
    select v_cycle_id, (x->>'date')::date, x->>'category', coalesce(x->>'description', ''), (x->>'amount')::numeric
      from jsonb_array_elements(coalesce(v_cycle->'variable', '[]'::jsonb)) as t(x);
    get diagnostics v_rows = row_count;
    n_variable := n_variable + v_rows;

    if coalesce((v_cycle->>'isBaseline')::boolean, false) then
      v_baseline_id := v_cycle_id;
    end if;
  end loop;

  if v_baseline_id is not null then
    perform public.set_baseline_cycle(v_baseline_id);
  end if;

  return jsonb_build_object(
    'categories', n_categories,
    'debts',      n_debts,
    'cycles',     n_cycles,
    'income',     n_income,
    'fixed',      n_fixed,
    'variable',   n_variable
  );
end;
$$;

revoke execute on function public.import_data(jsonb) from public, anon;
grant execute on function public.import_data(jsonb) to authenticated;
