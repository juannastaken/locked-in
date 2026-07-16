-- Locked In — social schema: profiles, friendships, presence.
-- Run this ONCE in the Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
-- Idempotent: safe to re-run.
--
-- SECURITY MODEL
-- - profiles: readable by any signed-in user (needed to add friends by
--   username); each user can only create/update their own row. Usernames are
--   the only thing exposed — never emails.
-- - friendships: visible only to the two people involved. Only the requester
--   can create (always as 'pending'); only the ADDRESSEE can accept; either
--   side can delete (cancel / reject / unfriend). A column-level grant stops
--   an accept from rewriting requester/addressee.
-- - presence: each user writes only their own row; a row is readable ONLY by
--   its owner and their ACCEPTED friends. Enforced server-side by RLS — the
--   client filter is cosmetic.

-- ========== profiles ==========
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower
  on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- username availability check usable BEFORE sign-up (anon). SECURITY DEFINER
-- bypasses RLS but only ever returns a boolean.
create or replace function public.username_available(name text)
returns boolean
language sql security definer set search_path = public
as $$
  select not exists (select 1 from profiles where lower(username) = lower(name));
$$;
revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- ========== friendships ==========
create table if not exists public.friendships (
  id bigint generated always as identity primary key,
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- one relationship per pair, whichever direction it was requested in
create unique index if not exists friendships_pair
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (auth.uid() in (requester, addressee));

drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (auth.uid() = requester and status = 'pending');

-- only the RECEIVER of a pending request can accept it
drop policy if exists friendships_accept on public.friendships;
create policy friendships_accept on public.friendships
  for update to authenticated
  using (auth.uid() = addressee and status = 'pending')
  with check (auth.uid() = addressee and status = 'accepted');

-- column-level lock: an UPDATE may only ever touch `status` (the accept path),
-- never rewrite requester/addressee to forge a friendship with a third party
revoke update on public.friendships from authenticated;
grant update (status) on public.friendships to authenticated;

-- either side can delete: cancel (requester), reject (addressee), unfriend
drop policy if exists friendships_delete on public.friendships;
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester, addressee));

-- ========== presence ==========
create table if not exists public.presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  focusing boolean not null default false,
  task text,
  started_at timestamptz,
  week_sec integer not null default 0,
  week_key text,
  updated_at timestamptz not null default now()
);

alter table public.presence enable row level security;

drop policy if exists presence_select on public.presence;
create policy presence_select on public.presence
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = presence.user_id)
          or (f.addressee = auth.uid() and f.requester = presence.user_id))
    )
  );

drop policy if exists presence_insert_own on public.presence;
create policy presence_insert_own on public.presence
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists presence_update_own on public.presence;
create policy presence_update_own on public.presence
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- realtime: friends get presence changes pushed (RLS still applies per-row)
do $$
begin
  alter publication supabase_realtime add table public.presence;
exception
  when duplicate_object then null;
end $$;
