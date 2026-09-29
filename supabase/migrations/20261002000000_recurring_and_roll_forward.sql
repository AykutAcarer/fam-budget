-- =============================================================================
-- Tekrar eden kalemler + döngü devri (roll_forward_cycle — dosyanın sonunda)
--
-- 1) fixed_expenses.recurring / income.recurring (varsayılan true): tek seferlik
--    kalemler false işaretlenir; döngü devrinde yalnız recurring = true taşınır.
-- 2) import_data: dosyadaki isteğe bağlı fixed[].recurring / income[].recurring
--    yazılır (yoksa true) — JSON yedeği bu bilgiyi kaybetmez. Fonksiyonun geri
--    kalanı 20261001000000_fixed_expense_installments.sql ile aynıdır.
-- =============================================================================

alter table public.fixed_expenses add column recurring boolean not null default true;
alter table public.income         add column recurring boolean not null default true;

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

  -- Kategoriler: yalnızca eksik olanları ekle.
  insert into public.categories (key, label, type, color, sort_order)
  select x->>'key', x->>'label', x->>'type', x->>'color', i::integer
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

-- =============================================================================
-- Döngü devri: roll_forward_cycle(kaynak) → sonraki döngü (id)
--
-- - Yeni döngü: başlangıç = kaynak.bitiş + 1 gün, bitiş = 1 ay sonrası − 1 gün
--   (15 Eyl – 14 Eki → 15 Eki – 14 Kas). is_baseline = false (baz ay değişmez).
-- - Sabit giderler (yalnız recurring): paid = false; installments_left NULL ise
--   aynen, doluysa − 1; 1 ise (son taksit kaynak döngüdeydi) TAŞINMAZ. Kalem,
--   tutar, kaynak (kart vb.) ve ayın günü korunur (ayda o gün yoksa ay sonu).
-- - Gelir (yalnız recurring): received = false; kaynak, tutar, gün korunur.
-- - Notlar taşınmaz (o aya özgüdür). Değişken harcamalar taşınmaz.
-- - İdempotent: yeni başlangıç tarihini kapsayan döngü zaten varsa (önceden
--   devredilmiş ya da içe aktarılmış) hiçbir şey kopyalanmaz, onun id'si döner.
-- security invoker: RLS geçerli; kullanıcı yalnız kendi döngüsünü devredebilir.
-- Eşleri: src/lib/fixed.ts (dateForDayInCycle), src/lib/cycle.ts (cycleLabel) —
-- supabase/tests/roll-forward.test.ts ikisinin aynı sonucu verdiğini doğrular.
-- =============================================================================

-- Ayın gününü döngü içindeki tarihe yerleştirir (ayda yoksa ay sonuna çeker).
create function public.day_in_cycle(p_start date, p_end date, p_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select d
    from (
      select least(m + (p_day - 1), (m + interval '1 month' - interval '1 day')::date) as d, ord
        from (values (date_trunc('month', p_start)::date, 1),
                     ((date_trunc('month', p_start) + interval '1 month')::date, 2)) as t(m, ord)
    ) c
   where d between p_start and p_end
   order by ord
   limit 1
$$;

-- "15 Eki – 14 Kas 2026" / "15 Ara 2026 – 14 Oca 2027"
create function public.cycle_label(p_start date, p_end date)
returns text
language sql
immutable
set search_path = ''
as $$
  select extract(day from p_start)::int || ' '
         || (array['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'])[extract(month from p_start)::int]
         || case when extract(year from p_start) = extract(year from p_end) then '' else ' ' || extract(year from p_start)::int end
         || ' – '
         || extract(day from p_end)::int || ' '
         || (array['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'])[extract(month from p_end)::int]
         || ' ' || extract(year from p_end)::int
$$;

create function public.roll_forward_cycle(p_cycle_id uuid)
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

  insert into public.cycles (key, label, start_date, end_date)
  values (v_key, public.cycle_label(v_start, v_end), v_start, v_end)
  on conflict (user_id, key) do nothing
  returning id into v_new;

  -- Aynı anda başka bir çağrı oluşturduysa kopyalama yapmadan onu döndür.
  if v_new is null then
    select id into v_new from public.cycles where key = v_key;
    return v_new;
  end if;

  insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, installments_left, recurring)
  select v_new,
         coalesce(public.day_in_cycle(v_start, v_end, extract(day from f.date)::int), v_start),
         f.item, f.amount, false, f.source,
         case when f.installments_left is null then null else f.installments_left - 1 end,
         true
    from public.fixed_expenses f
   where f.cycle_id = p_cycle_id
     and f.recurring
     and (f.installments_left is null or f.installments_left > 1);

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
