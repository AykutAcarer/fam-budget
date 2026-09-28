-- =============================================================================
-- Bütçem — ilk şema
-- Tablolar, Row Level Security ve yeni kullanıcıya varsayılan kategoriler.
--
-- Kural: her tabloda user_id vardır ve RLS ile kullanıcı yalnızca kendi
-- satırlarını okur/yazar. user_id varsayılan olarak auth.uid() ile dolar,
-- istemcinin göndermesine gerek yoktur.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key         text not null check (length(btrim(key)) > 0),
  label       text not null check (length(btrim(label)) > 0),
  type        text not null check (type in ('zorunlu', 'kisilabilir', 'yari', 'borc')),
  color       text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, key)
);

-- -----------------------------------------------------------------------------
-- cycles — maaş gününe (15'i) bağlı döngüler, ör. 15 Eyl – 14 Eki.
-- key: insan-okunur, kullanıcı içinde tekil kimlik (ör. '2026-09'); JSON
-- içe aktarmada "aynı id'li döngü varsa üzerine yaz" bunun üzerinden yapılır.
-- -----------------------------------------------------------------------------
create table public.cycles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key          text not null check (length(btrim(key)) > 0),
  label        text not null,
  start_date   date not null,
  end_date     date not null,
  is_baseline  boolean not null default false,
  created_at   timestamptz not null default now(),
  check (end_date >= start_date),
  unique (user_id, key),
  -- Alt tabloların bileşik FK'sı için: satır ile döngü aynı kullanıcıya ait olmalı.
  unique (id, user_id)
);

-- Kullanıcı başına en fazla bir baz ay.
create unique index cycles_one_baseline_per_user
  on public.cycles (user_id) where is_baseline;

-- -----------------------------------------------------------------------------
-- income
-- -----------------------------------------------------------------------------
create table public.income (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_id    uuid not null,
  date        date not null,
  source      text not null,
  amount      numeric(12, 2) not null check (amount >= 0),
  received    boolean not null default false,
  note        text,
  created_at  timestamptz not null default now(),
  foreign key (cycle_id, user_id) references public.cycles (id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- fixed_expenses — sabit giderler / ödeme takvimi
-- -----------------------------------------------------------------------------
create table public.fixed_expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_id    uuid not null,
  date        date not null,
  item        text not null,
  amount      numeric(12, 2) not null check (amount >= 0),
  paid        boolean not null default false,
  source      text,
  note        text,
  created_at  timestamptz not null default now(),
  foreign key (cycle_id, user_id) references public.cycles (id, user_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- variable_expenses — sohbetten girilen değişken harcamalar
-- category, kullanıcının kendi kategorilerinden birinin key'i olmalı.
-- -----------------------------------------------------------------------------
create table public.variable_expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  cycle_id     uuid not null,
  date         date not null,
  category     text not null,
  description  text not null default '',
  amount       numeric(12, 2) not null check (amount >= 0),
  created_at   timestamptz not null default now(),
  foreign key (cycle_id, user_id) references public.cycles (id, user_id) on delete cascade,
  -- Kategori key'i değişirse harcamalar da güncellenir; kullanılan kategori silinemez.
  foreign key (user_id, category) references public.categories (user_id, key) on update cascade
);

-- -----------------------------------------------------------------------------
-- debts
-- interest serbest metin (ör. '~%17,5/yil'); due_date 'YYYY-MM' veya 'YYYY-MM-DD'.
-- -----------------------------------------------------------------------------
create table public.debts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (length(btrim(name)) > 0),
  balance       numeric(12, 2) not null check (balance >= 0),
  interest      text,
  has_interest  boolean not null default false,
  due_date      text check (due_date ~ '^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$'),
  priority      integer not null default 100,
  note          text,
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- İndeksler
-- -----------------------------------------------------------------------------
create index categories_user_idx         on public.categories (user_id, sort_order);
create index cycles_user_start_idx       on public.cycles (user_id, start_date);
create index income_cycle_idx            on public.income (cycle_id, date);
create index income_user_idx             on public.income (user_id);
create index fixed_expenses_cycle_idx    on public.fixed_expenses (cycle_id, date);
create index fixed_expenses_user_idx     on public.fixed_expenses (user_id);
create index variable_expenses_cycle_idx on public.variable_expenses (cycle_id, date);
create index variable_expenses_cat_idx   on public.variable_expenses (user_id, category);
create index debts_user_idx              on public.debts (user_id, priority);

-- -----------------------------------------------------------------------------
-- Row Level Security — kullanıcı yalnızca kendi satırlarını görür/yazar.
-- anon rolü hiçbir tabloya erişemez.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['categories', 'cycles', 'income', 'fixed_expenses', 'variable_expenses', 'debts']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)',
      t || '_own_rows', t
    );
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- Varsayılan 10 kategori
-- -----------------------------------------------------------------------------
create function public.seed_default_categories(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.categories (user_id, key, label, type, color, sort_order) values
    (p_user_id, 'mutfak',      'Mutfak / Market',            'zorunlu',     '#C6EFCE', 1),
    (p_user_id, 'yakit',       'Yakıt',                      'zorunlu',     '#FFD966', 2),
    (p_user_id, 'mensemax',    'MensaMax (okul yemeği)',     'zorunlu',     '#FF99CC', 3),
    (p_user_id, 'kahvalti',    'Kahvaltı',                   'kisilabilir', '#FFF2CC', 4),
    (p_user_id, 'is',          'İş / öğlen / atıştırmalık',  'kisilabilir', '#F4B183', 5),
    (p_user_id, 'halisaha',    'Halı saha',                  'kisilabilir', '#9DC3E6', 6),
    (p_user_id, 'sosyal',      'Sosyal / diğer',             'kisilabilir', '#D9D2E9', 7),
    (p_user_id, 'temizlik',    'Temizlik / Rossmann',        'yari',        '#CC99FF', 8),
    (p_user_id, 'hanim',       'Hanıma verilen',             'yari',        '#99E6E6', 9),
    (p_user_id, 'kredi karti', 'Kredi kartı ödemesi',        'borc',        '#BFBFBF', 10)
  on conflict (user_id, key) do nothing;
$$;

revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;

-- Yeni kayıt olan her kullanıcıya varsayılan kategorileri ekle.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.seed_default_categories(new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Baz ayı tek işlemde değiştir (eskiyi kaldır, yeniyi işaretle).
-- security invoker: RLS geçerli, kullanıcı sadece kendi döngüsünü seçebilir.
-- -----------------------------------------------------------------------------
create function public.set_baseline_cycle(p_cycle_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.cycles where id = p_cycle_id) then
    raise exception 'Döngü bulunamadı' using errcode = 'P0002';
  end if;

  update public.cycles set is_baseline = false
   where user_id = (select auth.uid()) and is_baseline and id <> p_cycle_id;
  update public.cycles set is_baseline = true where id = p_cycle_id;
end;
$$;

revoke execute on function public.set_baseline_cycle(uuid) from public, anon;
grant execute on function public.set_baseline_cycle(uuid) to authenticated;
