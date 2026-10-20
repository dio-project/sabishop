create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) between 1 and 8000),
  draft jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_shop_user_created_idx
  on public.chat_messages (shop_id, user_id, created_at);

alter table public.chat_messages enable row level security;

revoke all on public.chat_messages from anon, public;
grant select, insert, update, delete on public.chat_messages to authenticated;

drop policy if exists "Users can read their own shop chat" on public.chat_messages;
create policy "Users can read their own shop chat"
  on public.chat_messages for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shop_members sm
      where sm.shop_id = chat_messages.shop_id
        and sm.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can insert their own shop chat" on public.chat_messages;
create policy "Users can insert their own shop chat"
  on public.chat_messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shop_members sm
      where sm.shop_id = chat_messages.shop_id
        and sm.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can update their own shop chat" on public.chat_messages;
create policy "Users can update their own shop chat"
  on public.chat_messages for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shop_members sm
      where sm.shop_id = chat_messages.shop_id
        and sm.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shop_members sm
      where sm.shop_id = chat_messages.shop_id
        and sm.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can delete their own shop chat" on public.chat_messages;
create policy "Users can delete their own shop chat"
  on public.chat_messages for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.shop_members sm
      where sm.shop_id = chat_messages.shop_id
        and sm.user_id = (select auth.uid())
    )
  );
