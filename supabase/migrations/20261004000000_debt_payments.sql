-- =============================================================================
-- Borç ödeme geçmişi
--
-- debt_payments: bir borca yapılan ödemeler (tarih, tutar, not).
-- Bakiye tetikleyiciyle AYNI İŞLEMDE güncellenir:
--   ekle   → borcun bakiyesi ödeme kadar azalır
--   sil    → bakiye geri gelir
--   düzenle → eski ödeme geri alınır, yenisi düşülür
-- Ödeme kalan bakiyeden büyükse işlem reddedilir (hiçbir şey yazılmaz).
-- Tutarlar numeric(12,2) — kuruş hassasiyetinde, yuvarlama hatası yok.
-- =============================================================================

-- Ödemenin borçla aynı kullanıcıya ait olmasını bileşik FK ile garanti etmek için.
alter table public.debts add constraint debts_id_user_key unique (id, user_id);

create table public.debt_payments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id     uuid not null,
  date        date not null,
  amount      numeric(12, 2) not null check (amount > 0),
  note        text check (note is null or length(note) <= 200),
  created_at  timestamptz not null default now(),
  foreign key (debt_id, user_id) references public.debts (id, user_id) on delete cascade
);

create index debt_payments_debt_idx on public.debt_payments (debt_id, date desc);
create index debt_payments_user_idx on public.debt_payments (user_id);

alter table public.debt_payments enable row level security;
revoke all on table public.debt_payments from anon;
grant select, insert, update, delete on table public.debt_payments to authenticated;
create policy debt_payments_own_rows on public.debt_payments for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- -----------------------------------------------------------------------------
-- Bakiye tetikleyicisi (security invoker: RLS geçerli; borç zaten aynı kullanıcının)
-- -----------------------------------------------------------------------------
create function public.debt_payments_apply_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_balance numeric(12, 2);
begin
  -- Eski ödemeyi geri al (düzenle / sil). Borç silinirken (cascade) satır bulunmaz; sorun değil.
  if tg_op in ('UPDATE', 'DELETE') then
    update public.debts set balance = balance + old.amount where id = old.debt_id and user_id = old.user_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select balance into v_balance from public.debts where id = new.debt_id and user_id = new.user_id for update;
    if not found then
      raise exception 'Borç bulunamadı' using errcode = 'P0002';
    end if;
    if new.amount > v_balance then
      raise exception 'Ödeme kalan bakiyeden büyük olamaz (kalan %)', to_char(v_balance, 'FM999999990.00')
        using errcode = '23514';
    end if;
    update public.debts set balance = balance - new.amount where id = new.debt_id and user_id = new.user_id;
    return new;
  end if;

  return old;
end;
$$;

create trigger debt_payments_apply_balance
  before insert or update of debt_id, amount or delete on public.debt_payments
  for each row execute function public.debt_payments_apply_balance();
