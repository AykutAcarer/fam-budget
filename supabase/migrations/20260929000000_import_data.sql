-- =============================================================================
-- JSON içe aktarma — tek işlem (atomik), idempotent.
--
-- Girdi: codex_prompt.md bölüm 8 biçimi (istemci önce doğrular/normalleştirir:
-- tarihler geçerli, tutarlar sayı). security invoker: RLS geçerli, her şey
-- çağıran kullanıcının hesabına yazılır.
--
-- Kurallar:
--  * categories: kullanıcıda olmayan key'ler eklenir; mevcut kategoriler
--    (kullanıcının etiket/renk tercihleri) korunur.
--  * debts: ada göre (büyük/küçük harf duyarsız) eşlenir → güncellenir, yoksa eklenir.
--  * cycles: key'e göre upsert; o döngünün gelir/sabit/değişken kayıtları
--    silinip dosyadakilerle değiştirilir ("üzerine yaz").
--  * isBaseline olan döngü baz ay yapılır (en fazla bir tane).
-- =============================================================================

create function public.import_data(p_data jsonb)
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

    insert into public.income (cycle_id, date, source, amount, received, note)
    select v_cycle_id, (x->>'date')::date, x->>'source', (x->>'amount')::numeric,
           coalesce((x->>'received')::boolean, false), x->>'note'
      from jsonb_array_elements(coalesce(v_cycle->'income', '[]'::jsonb)) as t(x);
    get diagnostics v_rows = row_count;
    n_income := n_income + v_rows;

    insert into public.fixed_expenses (cycle_id, date, item, amount, paid, source, note)
    select v_cycle_id, (x->>'date')::date, x->>'item', (x->>'amount')::numeric,
           coalesce((x->>'paid')::boolean, false), x->>'source', x->>'note'
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
