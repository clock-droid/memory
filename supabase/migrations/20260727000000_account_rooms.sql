create table if not exists public.account_rooms (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  room jsonb not null default '{"revision":0,"decks":[],"cardsByDeck":{},"sectionsByDeck":{}}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.account_rooms enable row level security;

grant select, insert, update
  on table public.account_rooms
  to authenticated;

create policy "account room owners can read"
  on public.account_rooms for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "account room owners can create"
  on public.account_rooms for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "account room owners can update"
  on public.account_rooms for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.account_rooms replica identity full;
alter publication supabase_realtime add table public.account_rooms;
