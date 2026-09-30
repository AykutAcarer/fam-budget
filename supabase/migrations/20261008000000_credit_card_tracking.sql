-- =============================================================================
-- Kredi kartı borç takibi (ana ekran) + kredi kartını Borçlar'dan çıkarma
--
-- cycles.cc_opening_balance: döngünün başındaki kredi kartı borcu (dönem başı).
--   Bu dönem ödenen = döngüdeki "kredi karti" harcamaları (istemcide kodla);
--   kalan = dönem başı − ödenen. Kullanıcı dönem başını elle düzeltebilir.
--   Devirde yeni döngünün dönem başı = önceki kalan (roll_forward_cycle, idempotent).
--
-- Veri taşıma: adı "kredi kart…" olan borç kaydının bakiyesi kullanıcının bugünkü
-- döngüsüne (yoksa bugünden önce başlayan en yeni, o da yoksa en yeni döngüye)
-- dönem başı borç olarak yazılır ve kayıt Borçlar'dan silinir (ödeme geçmişi de).
-- Döngüsü olmayan kullanıcıda kayıt yerinde bırakılır (taşınacak yer yok).
-- Kredi kartı kaydı olmayan kullanıcıda dönem başı 0 başlar; kullanıcı elle girer.
-- RLS değişmez (alan kullanıcının kendi döngü satırında).
-- =============================================================================

alter table public.cycles
  add column if not exists cc_opening_balance numeric(12, 2) not null default 0
    check (cc_opening_balance >= 0);

with cc as (
  select user_id, sum(balance) as balance
    from public.debts
   where name ~* 'kredi[[:space:]]*kart'
   group by user_id
),
target as (
  select distinct on (c.user_id) c.user_id, c.id
    from public.cycles c
    join cc on cc.user_id = c.user_id
   order by c.user_id,
            (c.start_date <= current_date and c.end_date >= current_date) desc,
            (c.start_date <= current_date) desc,
            c.start_date desc
)
update public.cycles as c
   set cc_opening_balance = cc.balance
  from target t
  join cc on cc.user_id = t.user_id
 where c.id = t.id;

delete from public.debts d
 where d.name ~* 'kredi[[:space:]]*kart'
   and exists (select 1 from public.cycles c where c.user_id = d.user_id);

-- -----------------------------------------------------------------------------
-- Döngü devri — kredi kartı borcu devreder
-- -----------------------------------------------------------------------------
create or replace function public.roll_forward_cycle(p_cycle_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_src   public.cycles%rowtype;
  v_start date;
  v_end   date;
  v_key   text;
  v_new   uuid;
begin
  select * into v_src from public.cycles where id = p_cycle_id;
  if not found then
    raise exception 'Döngü bulunamadı' using errcode = 'P0002';
  end if;

  v_start := v_src.end_date + 1;
  v_end   := (v_start + interval '1 month' - interval '1 day')::date;
  v_key   := to_char(v_start, 'YYYY-MM');

  -- İdempotent: bu tarihi kapsayan bir döngü zaten varsa dokunma.
  select id into v_new
    from public.cycles
   where start_date <= v_start and end_date >= v_start
   order by start_date desc
   limit 1;
  if found then
    return v_new;
  end if;

  -- Kredi kartı borcu devreder: yeni dönem başı = önceki dönem başı − önceki dönemde
  -- karta ödenen ("kredi karti" harcamaları); 0'ın altına inmez. Döngü zaten varsa
  -- yukarıda erken dönüldüğü için borç iki kez taşınmaz.
  insert into public.cycles (key, label, start_date, end_date, cc_opening_balance)
  values (
    v_key, public.cycle_label(v_start, v_end), v_start, v_end,
    greatest(0, v_src.cc_opening_balance - coalesce((
      select sum(e.amount) from public.variable_expenses e
       where e.cycle_id = p_cycle_id and e.category = 'kredi karti'
    ), 0))
  )
  on conflict (user_id, key) do nothing
  returning id into v_new;

  -- Aynı anda başka bir çağrı oluşturduysa kopyalama yapmadan onu döndür.
  if v_new is null then
    select id into v_new from public.cycles where key = v_key;
    return v_new;
  end if;

  -- duzenli: aynen kopyalanır. taksit: kalan bir azalır; kalan 1 ise (son taksit
  -- bu döngüdeydi) yeni döngüye taşınmaz.
  insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, installments_left, recurring, fixed_kind)
  select v_new,
         coalesce(public.day_in_cycle(v_start, v_end, extract(day from f.date)::int), v_start),
         f.item, f.amount, false, f.source,
         case when f.fixed_kind = 'taksit' then f.installments_left - 1 end,
         true,
         f.fixed_kind
    from public.fixed_expenses f
   where f.cycle_id = p_cycle_id
     and f.recurring
     and (f.fixed_kind = 'duzenli' or (f.fixed_kind = 'taksit' and f.installments_left > 1));

  insert into public.income (cycle_id, date, source, amount, received, recurring)
  select v_new,
         coalesce(public.day_in_cycle(v_start, v_end, extract(day from i.date)::int), v_start),
         i.source, i.amount, false, true
    from public.income i
   where i.cycle_id = p_cycle_id
     and i.recurring;

  return v_new;
end;
$$;

revoke execute on function public.roll_forward_cycle(uuid) from public, anon;
grant execute on function public.roll_forward_cycle(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- İçe aktarma — cycles[].ccOpeningBalance (isteğe bağlı)
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
  v_cc          numeric;
  v_latest      jsonb;
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
  -- Kredi kartı artık borç değil (ana ekran takibi): eski yedeklerdeki kredi kartı kaydı
  -- Borçlar'a yazılmaz, aşağıda dönem başı borca aktarılır.
  for v_debt in select * from jsonb_array_elements(coalesce(p_data->'debts', '[]'::jsonb)) as t(x)
                 where not coalesce(x->>'name' ~* 'kredi[[:space:]]*kart', false) loop
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
    -- ccOpeningBalance isteğe bağlı: yoksa yeni döngüde 0, mevcut döngüde değer korunur.
    insert into public.cycles (key, label, start_date, end_date, cc_opening_balance)
    values (v_cycle->>'id', v_cycle->>'label', (v_cycle->>'start')::date, (v_cycle->>'end')::date,
            coalesce((v_cycle->>'ccOpeningBalance')::numeric, 0))
    on conflict (user_id, key) do update
      set label = excluded.label, start_date = excluded.start_date, end_date = excluded.end_date,
          cc_opening_balance = case when v_cycle ? 'ccOpeningBalance' then excluded.cc_opening_balance
                                    else public.cycles.cc_opening_balance end
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

    -- Tip dosyadaki kalan taksitten türetilir (dosya biçimi değişmedi).
    insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, note, installments_left, recurring, fixed_kind)
    select v_cycle_id, (x->>'date')::date, x->>'item', (x->>'amount')::numeric,
           coalesce((x->>'paid')::boolean, false), x->>'source', x->>'note',
           (x->>'installmentsLeft')::integer, coalesce((x->>'recurring')::boolean, true),
           case when x->>'installmentsLeft' is null then 'duzenli' else 'taksit' end
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

  -- Eski yedekteki kredi kartı borcu → dosyadaki en yeni döngünün dönem başı borcu
  -- (dosya o döngü için ccOpeningBalance veriyorsa dokunulmaz). Dosyada döngü yoksa
  -- kullanıcının bugüne kadar başlamış en yeni döngüsü.
  select sum((x->>'balance')::numeric) into v_cc
    from jsonb_array_elements(coalesce(p_data->'debts', '[]'::jsonb)) as t(x)
   where x->>'name' ~* 'kredi[[:space:]]*kart';
  if v_cc is not null then
    select x into v_latest
      from jsonb_array_elements(coalesce(p_data->'cycles', '[]'::jsonb)) as t(x)
     order by (x->>'start')::date desc
     limit 1;
    if v_latest is null then
      update public.cycles set cc_opening_balance = v_cc
       where id = (select id from public.cycles order by (start_date <= current_date) desc, start_date desc limit 1);
    elsif not (v_latest ? 'ccOpeningBalance') then
      update public.cycles set cc_opening_balance = v_cc where key = v_latest->>'id';
    end if;
  end if;

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
