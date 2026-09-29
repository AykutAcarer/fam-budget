-- =============================================================================
-- Sohbet geçmişi (cihazlar arası)
--
-- id istemcide üretilir: çevrimdışı kuyruktan gönderim "upsert" olduğu için
-- tekrar denemeler kopya oluşturmaz. created_at da istemciden gelir (mesajın
-- yazıldığı an) — kuyruktan geç gönderilen mesajlar doğru sırada görünür.
-- meta: asistan mesajının ekleri (kaydedilen kalemler, geri alındı mı, cevabı
--       kim yazdı, çevrimdışı bekliyor mu, ton). Geri al / gönderildi gibi
--       değişiklikler aynı satırı günceller.
-- related_expense_id: cevapla kaydedilen ilk harcama (bilgi amaçlı; harcama geri
--       alınabildiği ve kuyruktan sonra gelebildiği için FK değildir).
-- =============================================================================

create table public.chat_messages (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role                text not null check (role in ('user', 'assistant')),
  content             text not null check (length(content) <= 4000),
  meta                jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 16384),
  related_expense_id  uuid,
  created_at          timestamptz not null default now()
);

create index chat_messages_user_created_idx on public.chat_messages (user_id, created_at desc, id desc);

alter table public.chat_messages enable row level security;
revoke all on table public.chat_messages from anon;
grant select, insert, update, delete on table public.chat_messages to authenticated;
create policy chat_messages_own_rows on public.chat_messages for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
