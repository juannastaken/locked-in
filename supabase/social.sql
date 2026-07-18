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
-- small profile photo (~128px jpeg data-url), visible to other signed-in users
alter table public.profiles add column if not exists avatar_b64 text;
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
-- which app version this user runs (feature-compat checks between friends)
alter table public.presence add column if not exists app_version text;

alter table public.presence enable row level security;

-- groupmates share presence too (a group jam must know who's actually alive,
-- even when two members never friended each other)
create or replace function public.shares_group_with(other uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from group_members a
    join group_members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;
revoke all on function public.shares_group_with(uuid) from public;
grant execute on function public.shares_group_with(uuid) to authenticated;

drop policy if exists presence_select on public.presence;
create policy presence_select on public.presence
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.shares_group_with(user_id)
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

-- realtime: friend requests / accepts arrive instantly (RLS applies: only the
-- two people involved receive INSERT/UPDATE events for a row)
do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception
  when duplicate_object then null;
end $$;

-- ========== jam invites (shared focus sessions) ==========
-- kind 'invite'  = the person FOCUSING invites a friend to join their jam
-- kind 'request' = a friend asks to join someone's running jam
-- Either way: from_user creates the row, to_user answers, and whoever is NOT
-- focusing yet is the one who starts a session on acceptance.
create table if not exists public.jam_invites (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('invite', 'request')),
  task text not null,
  -- when the host's session started (shared timer base)
  session_started_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

alter table public.jam_invites enable row level security;

drop policy if exists jam_select on public.jam_invites;
create policy jam_select on public.jam_invites
  for select to authenticated using (auth.uid() in (from_user, to_user));

drop policy if exists jam_insert on public.jam_invites;
create policy jam_insert on public.jam_invites
  for insert to authenticated
  with check (auth.uid() = from_user and status = 'pending');

-- only the receiver answers, and only pending rows
drop policy if exists jam_answer on public.jam_invites;
create policy jam_answer on public.jam_invites
  for update to authenticated
  using (auth.uid() = to_user and status = 'pending')
  with check (auth.uid() = to_user and status in ('accepted', 'declined'));

-- column-level lock: an answer may only ever touch `status`
revoke update on public.jam_invites from authenticated;
grant update (status) on public.jam_invites to authenticated;

-- sender can cancel (delete) a pending invite; either side can clean up
drop policy if exists jam_delete on public.jam_invites;
create policy jam_delete on public.jam_invites
  for delete to authenticated using (auth.uid() in (from_user, to_user));

do $$
begin
  alter publication supabase_realtime add table public.jam_invites;
exception
  when duplicate_object then null;
end $$;

-- ========== E2E encrypted messages ==========
-- The server only ever stores CIPHERTEXT. Bodies are encrypted client-side
-- with crypto_box (X25519 + XSalsa20-Poly1305); the private key never leaves
-- the sender's machine (DPAPI at rest). Public keys are snapshotted per row so
-- key rotation never breaks old history for whoever still holds their key.

-- each account's current public key (safe to be public by definition)
alter table public.profiles add column if not exists e2e_pub text;

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'jam')),
  nonce text not null,
  body_ct text not null check (char_length(body_ct) <= 8000),
  sender_pub text not null,
  recipient_pub text not null,
  created_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists messages_pair_time
  on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);

alter table public.messages enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (auth.uid() in (sender, recipient));

-- only ACCEPTED friends can message each other — strangers can't spam
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = sender and f.addressee = recipient)
          or (f.addressee = sender and f.requester = recipient))
    )
  );

-- the author can delete their message (for both sides)
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated using (auth.uid() = sender);

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception
  when duplicate_object then null;
end $$;

-- ========== groups (up to 5 people, WhatsApp-style admins) ==========
-- Group chat is RLS-protected (members only) but NOT end-to-end encrypted —
-- group E2E with member-removal key rotation is a bug farm; DMs stay E2E.
-- The group's JAM lives server-side: task/start on the group row, membership
-- on group_members.in_jam — the single source of truth every client renders.

create table if not exists public.groups (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 40),
  owner uuid not null references auth.users(id) on delete cascade,
  jam_task text,
  jam_started_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id bigint not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  in_jam boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups(id) on delete cascade,
  sender uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(body) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists group_messages_time on public.group_messages (group_id, created_at desc);

-- membership check used by every policy (security definer dodges RLS recursion)
create or replace function public.is_group_member(gid bigint)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;
create or replace function public.is_group_admin(gid bigint)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from group_members where group_id = gid and user_id = auth.uid() and is_admin
  );
$$;
create or replace function public.is_group_owner(gid bigint)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from groups where id = gid and owner = auth.uid());
$$;
-- is the given user the owner of the given group (any-user variant)
create or replace function public.is_group_owner_row(gid bigint, uid uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from groups where id = gid and owner = uid);
$$;
revoke all on function public.is_group_owner_row(bigint, uuid) from public;
grant execute on function public.is_group_owner_row(bigint, uuid) to authenticated;
revoke all on function public.is_group_member(bigint) from public;
revoke all on function public.is_group_admin(bigint) from public;
revoke all on function public.is_group_owner(bigint) from public;
grant execute on function public.is_group_member(bigint) to authenticated;
grant execute on function public.is_group_admin(bigint) to authenticated;
grant execute on function public.is_group_owner(bigint) to authenticated;

-- hard cap: 5 people per group
create or replace function public.enforce_group_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from group_members where group_id = new.group_id) >= 5 then
    raise exception 'group is full (max 5 members)';
  end if;
  return new;
end;
$$;
drop trigger if exists group_cap on public.group_members;
create trigger group_cap before insert on public.group_members
  for each row execute function public.enforce_group_cap();

-- only admins may flip is_admin — a member updates their OWN row to toggle
-- in_jam, and the column grant would otherwise let them self-promote
create or replace function public.guard_admin_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_admin is distinct from old.is_admin and not public.is_group_admin(new.group_id) then
    raise exception 'only admins can change admin status';
  end if;
  return new;
end;
$$;
drop trigger if exists group_admin_guard on public.group_members;
create trigger group_admin_guard before update on public.group_members
  for each row execute function public.guard_admin_flag();

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

-- groups: members see; anyone signed-in creates (becoming owner); admins
-- rename / manage the jam fields; owner deletes
-- the owner must see their group even BEFORE their member row exists:
-- INSERT ... RETURNING runs the SELECT policy, so creation would 404 itself
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups
  for select to authenticated
  using (public.is_group_member(id) or owner = auth.uid());

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups
  for insert to authenticated with check (auth.uid() = owner);

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups
  for update to authenticated
  using (public.is_group_member(id))
  with check (public.is_group_member(id));
-- column lock: members may only touch the jam fields; renames go through
-- admins (enforced app-side on top of this narrower grant)
revoke update on public.groups from authenticated;
grant update (name, jam_task, jam_started_at) on public.groups to authenticated;

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups
  for delete to authenticated using (auth.uid() = owner);

-- members: visible to fellow members; ADMINS add people; a member updates
-- their own jam flag; admins update others (promote); leave = delete self,
-- kick = admin deletes
drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists gm_insert on public.group_members;
create policy gm_insert on public.group_members
  for insert to authenticated
  with check (
    public.is_group_admin(group_id)
    -- group creator bootstraps their own admin row (SECURITY DEFINER check —
    -- a plain subquery here would hit the groups RLS before membership exists)
    or (auth.uid() = user_id and public.is_group_owner(group_id))
  );

drop policy if exists gm_update on public.group_members;
create policy gm_update on public.group_members
  for update to authenticated
  using (auth.uid() = user_id or public.is_group_admin(group_id))
  with check (public.is_group_member(group_id));
revoke update on public.group_members from authenticated;
grant update (in_jam, is_admin) on public.group_members to authenticated;

-- self-leave always; admins may kick anyone EXCEPT the owner
drop policy if exists gm_delete on public.group_members;
create policy gm_delete on public.group_members
  for delete to authenticated
  using (
    auth.uid() = user_id
    or (public.is_group_admin(group_id) and not public.is_group_owner_row(group_id, user_id))
  );

-- messages: members read + write; author deletes
drop policy if exists gmsg_select on public.group_messages;
create policy gmsg_select on public.group_messages
  for select to authenticated using (public.is_group_member(group_id));

drop policy if exists gmsg_insert on public.group_messages;
create policy gmsg_insert on public.group_messages
  for insert to authenticated
  with check (auth.uid() = sender and public.is_group_member(group_id));

drop policy if exists gmsg_delete on public.group_messages;
create policy gmsg_delete on public.group_messages
  for delete to authenticated using (auth.uid() = sender);

do $$
begin
  alter publication supabase_realtime add table public.groups;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.group_members;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.group_messages;
exception when duplicate_object then null;
end $$;

-- optional cloud backup of the PRIVATE key, itself encrypted client-side with
-- a passphrase (Argon2id → XSalsa20-Poly1305). The server never sees the
-- passphrase or the plaintext key — losing the passphrase = losing the backup.
-- reply threading: which message this one answers (metadata, body stays E2E)
alter table public.messages add column if not exists reply_to bigint;

-- emoji reactions (metadata on top of encrypted messages)
create table if not exists public.message_reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

drop policy if exists reactions_select on public.message_reactions;
create policy reactions_select on public.message_reactions
  for select to authenticated using (
    exists (
      select 1 from public.messages m
      where m.id = message_id and auth.uid() in (m.sender, m.recipient)
    )
  );

drop policy if exists reactions_insert on public.message_reactions;
create policy reactions_insert on public.message_reactions
  for insert to authenticated with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.messages m
      where m.id = message_id and auth.uid() in (m.sender, m.recipient)
    )
  );

drop policy if exists reactions_delete on public.message_reactions;
create policy reactions_delete on public.message_reactions
  for delete to authenticated using (auth.uid() = user_id);

do $$
begin
  alter publication supabase_realtime add table public.message_reactions;
exception
  when duplicate_object then null;
end $$;

-- top recent projects a user CHOSE to make public (Settings toggle) — shown
-- on their profile to friends; null when the setting is off
alter table public.presence add column if not exists public_projects text;

-- lifetime focused seconds (drives the profile badges friends can see)
alter table public.presence add column if not exists total_sec bigint not null default 0;

-- who I'm jamming with right now (JSON usernames) — lets friends see
-- "in a JAM with @x @y" even when they don't know those people
alter table public.presence add column if not exists jam_members text;

-- message edits: author-only, within 2 minutes (server-enforced), marked
alter table public.messages add column if not exists edited_at timestamptz;

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using (auth.uid() = sender and created_at > now() - interval '2 minutes')
  with check (auth.uid() = sender);

revoke update on public.messages from authenticated;
-- pubkeys included: an edit re-encrypts with CURRENT keys, so the snapshots
-- must follow (sender/recipient identity stays locked out)
grant update (nonce, body_ct, edited_at, sender_pub, recipient_pub)
  on public.messages to authenticated;

-- image messages need a bigger ciphertext budget (512px jpeg, encrypted)
alter table public.messages drop constraint if exists messages_body_ct_check;
alter table public.messages add constraint messages_body_ct_check
  check (char_length(body_ct) <= 120000);
-- (kept in sync with the v0.35 block below — re-running the whole file must
-- never re-tighten the constraint past rows that already exist)
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'jam', 'image', 'voice', 'status'));

-- free-form profile bio (filtered client-side before upload, capped here too)
alter table public.profiles add column if not exists bio text
  check (bio is null or char_length(bio) <= 140);

create table if not exists public.key_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  salt text not null,
  nonce text not null,
  key_ct text not null,
  updated_at timestamptz not null default now()
);

alter table public.key_backups enable row level security;

drop policy if exists key_backups_own on public.key_backups;
create policy key_backups_own on public.key_backups
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ========== v0.26: status, pokes, feed, group goal/pomo, anti-abuse ==========

-- custom status line ("grindando TCC"), filtered client-side, capped here
alter table public.profiles add column if not exists status_text text
  check (status_text is null or char_length(status_text) <= 80);

-- group jam pomodoro rhythm ("25/5") + collective weekly goal (hours)
alter table public.groups add column if not exists jam_pomo text
  check (jam_pomo is null or jam_pomo ~ '^\d{1,3}/\d{1,2}$');
alter table public.groups add column if not exists week_goal_hours int
  check (week_goal_hours is null or week_goal_hours between 1 and 500);
revoke update on public.groups from authenticated;
grant update (name, jam_task, jam_started_at, jam_pomo, week_goal_hours)
  on public.groups to authenticated;

-- ---------- pokes: 👉 nudge a friend / 🔥 cheer someone focusing ----------
create table if not exists public.pokes (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'poke' check (kind in ('poke', 'cheer')),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
create index if not exists pokes_inbox on public.pokes (to_user, created_at desc);

alter table public.pokes enable row level security;

-- friends only: the sender IS a party of the friendship row, so the
-- friendships RLS lets this subquery see it
drop policy if exists pokes_insert on public.pokes;
create policy pokes_insert on public.pokes
  for insert to authenticated
  with check (
    auth.uid() = from_user
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = from_user and f.addressee = to_user)
          or (f.requester = to_user and f.addressee = from_user))
    )
  );

drop policy if exists pokes_select on public.pokes;
create policy pokes_select on public.pokes
  for select to authenticated using (auth.uid() in (from_user, to_user));
-- no update/delete policies on purpose: history is what enforces the rate limit

-- server-side anti-flood: poke 1/hour, cheer 1/10min per pair
create or replace function public.poke_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from pokes
    where from_user = new.from_user and to_user = new.to_user and kind = new.kind
      and created_at > now() - (case when new.kind = 'poke'
                                     then interval '1 hour'
                                     else interval '10 minutes' end)
  ) then
    raise exception 'rate limited';
  end if;
  return new;
end;
$$;
drop trigger if exists pokes_rate on public.pokes;
create trigger pokes_rate before insert on public.pokes
  for each row execute function public.poke_rate_limit();

do $$
begin
  alter publication supabase_realtime add table public.pokes;
exception when duplicate_object then null;
end $$;

-- ---------- activity feed: self-reported wins, visible to friends ----------
-- GOLDEN RULE: events only carry data friends can already see or that the
-- owner explicitly chose to share. No goal contents (goals are private).
create table if not exists public.feed_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('streak', 'record_session', 'record_day', 'jam')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists feed_time on public.feed_events (user_id, created_at desc);

alter table public.feed_events enable row level security;

drop policy if exists feed_insert on public.feed_events;
create policy feed_insert on public.feed_events
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists feed_select on public.feed_events;
create policy feed_select on public.feed_events
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = user_id)
          or (f.addressee = auth.uid() and f.requester = user_id))
    )
  );

drop policy if exists feed_delete_own on public.feed_events;
create policy feed_delete_own on public.feed_events
  for delete to authenticated using (auth.uid() = user_id);

-- spam cap (20/day) + self-gc of events older than 30 days
create or replace function public.feed_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from feed_events
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'feed daily cap reached';
  end if;
  delete from feed_events
    where user_id = new.user_id and created_at < now() - interval '30 days';
  return new;
end;
$$;
drop trigger if exists feed_cap on public.feed_events;
create trigger feed_cap before insert on public.feed_events
  for each row execute function public.feed_guard();

-- live feed updates (RLS still filters who sees what)
do $$
begin
  alter publication supabase_realtime add table public.feed_events;
exception when duplicate_object then null;
end $$;

-- ========== group weekly goal counts ONLY time spent in the GROUP's jam ==========
-- each member accumulates their own clock while focusing inside this group's
-- jam; the goal bar sums these instead of everyone's generic weekly hours
alter table public.group_members add column if not exists week_jam_sec bigint not null default 0;
alter table public.group_members add column if not exists week_key text;
alter table public.group_members add column if not exists jam_beat_at timestamptz;
revoke update on public.group_members from authenticated;
grant update (in_jam, is_admin, week_jam_sec, week_key) on public.group_members to authenticated;

-- same anti-cheat shape as presence: your jam clock can only grow as fast as
-- real time, only on YOUR row, and jam_beat_at is server-stamped
create or replace function public.group_time_guard()
returns trigger language plpgsql as $$
declare gap double precision;
begin
  if new.week_jam_sec is distinct from old.week_jam_sec
     or new.week_key is distinct from old.week_key then
    if new.user_id <> auth.uid() then
      new.week_jam_sec := old.week_jam_sec;
      new.week_key := old.week_key;
      return new;
    end if;
    if new.week_key is distinct from old.week_key then
      if new.week_jam_sec > 21600 then
        new.week_jam_sec := 0;
      end if;
    else
      gap := greatest(
        extract(epoch from (now() - coalesce(old.jam_beat_at, now() - interval '75 seconds'))),
        0
      );
      if new.week_jam_sec > old.week_jam_sec + gap + 5 then
        new.week_jam_sec := (old.week_jam_sec + gap + 5)::bigint;
      end if;
    end if;
    new.jam_beat_at := now();
  end if;
  return new;
end $$;
drop trigger if exists group_time_guard_t on public.group_members;
create trigger group_time_guard_t before update on public.group_members
  for each row execute function public.group_time_guard();

-- ========== v0.33+: read receipts, statuses, group photo/invite, rich presence ==========

-- read receipts: the RECIPIENT stamps read_at once; nobody can unread or forge
alter table public.messages add column if not exists read_at timestamptz;
revoke update on public.messages from authenticated;
grant update (nonce, body_ct, edited_at, sender_pub, recipient_pub, read_at)
  on public.messages to authenticated;
drop policy if exists messages_mark_read on public.messages;
create policy messages_mark_read on public.messages
  for update to authenticated
  using (auth.uid() = recipient)
  with check (auth.uid() = recipient);
create or replace function public.read_receipt_guard()
returns trigger language plpgsql as $$
begin
  if new.read_at is distinct from old.read_at then
    -- only the recipient sets it, only once, always to "now"
    if auth.uid() <> old.recipient or old.read_at is not null then
      new.read_at := old.read_at;
    else
      new.read_at := now();
    end if;
  end if;
  -- the recipient may ONLY touch read_at — everything else snaps back
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    new.nonce := old.nonce;
    new.body_ct := old.body_ct;
    new.edited_at := old.edited_at;
    new.sender_pub := old.sender_pub;
    new.recipient_pub := old.recipient_pub;
  end if;
  return new;
end $$;
drop trigger if exists read_receipt_guard_t on public.messages;
create trigger read_receipt_guard_t before update on public.messages
  for each row execute function public.read_receipt_guard();

-- new message kinds: status replies + voice notes
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'jam', 'image', 'voice', 'status'));

-- ---------- statuses (24h stories: text / drawing / sticker / week card) ----------
create table if not exists public.statuses (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('text', 'image')),
  -- text statuses: the text itself; image statuses: a data-url (<=200KB)
  body text not null check (char_length(body) <= 280000),
  -- background color for text statuses (hex)
  bg text,
  created_at timestamptz not null default now()
);
create index if not exists statuses_time on public.statuses (user_id, created_at desc);

alter table public.statuses enable row level security;

drop policy if exists statuses_insert on public.statuses;
create policy statuses_insert on public.statuses
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists statuses_select on public.statuses;
create policy statuses_select on public.statuses
  for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = auth.uid() and f.addressee = user_id)
          or (f.addressee = auth.uid() and f.requester = user_id))
    )
  );

drop policy if exists statuses_delete on public.statuses;
create policy statuses_delete on public.statuses
  for delete to authenticated using (auth.uid() = user_id);

-- cap 20/day + self-gc of expired stories (>25h keeps clocks lenient)
create or replace function public.status_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from statuses
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'status daily cap reached';
  end if;
  delete from statuses
    where user_id = new.user_id and created_at < now() - interval '25 hours';
  return new;
end;
$$;
drop trigger if exists status_cap on public.statuses;
create trigger status_cap before insert on public.statuses
  for each row execute function public.status_guard();

do $$
begin
  alter publication supabase_realtime add table public.statuses;
exception when duplicate_object then null;
end $$;

-- ---------- group photo + join-by-invite-code ----------
alter table public.groups add column if not exists avatar_b64 text;
alter table public.groups add column if not exists invite_code text unique;
revoke update on public.groups from authenticated;
grant update (name, jam_task, jam_started_at, jam_pomo, week_goal_hours, avatar_b64, invite_code)
  on public.groups to authenticated;

-- redeem: anyone signed-in with a valid code joins (cap still enforced)
create or replace function public.redeem_group_invite(code text)
returns bigint language plpgsql security definer set search_path = public as $$
declare gid bigint;
begin
  select id into gid from groups where invite_code = code and invite_code is not null;
  if gid is null then
    raise exception 'invalid invite';
  end if;
  if (select count(*) from group_members where group_id = gid) >= 5 then
    raise exception 'group is full (max 5 members)';
  end if;
  insert into group_members (group_id, user_id, added_by)
    values (gid, auth.uid(), auth.uid())
    on conflict (group_id, user_id) do nothing;
  return gid;
end;
$$;
revoke all on function public.redeem_group_invite(text) from public;
grant execute on function public.redeem_group_invite(text) to authenticated;

-- ---------- rich presence: current work app (opt-in) + personal records ----------
alter table public.presence add column if not exists fg_app text;
alter table public.presence add column if not exists records text;

-- ---------- anti-abuse hardening ----------

-- one pending jam invite per pair (kills invite flooding at the source);
-- clean existing duplicates first so the index can build
delete from public.jam_invites a using public.jam_invites b
  where a.status = 'pending' and b.status = 'pending'
    and a.from_user = b.from_user and a.to_user = b.to_user and a.id < b.id;
create unique index if not exists jam_invites_one_pending
  on public.jam_invites (from_user, to_user) where (status = 'pending');

-- reactions: at most 8 emojis per user per message
create or replace function public.reaction_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from message_reactions
      where message_id = new.message_id and user_id = new.user_id) >= 8 then
    raise exception 'too many reactions on this message';
  end if;
  return new;
end;
$$;
drop trigger if exists reactions_cap on public.message_reactions;
create trigger reactions_cap before insert on public.message_reactions
  for each row execute function public.reaction_cap();

-- presence guard: the leaderboard values (week_sec / total_sec) may only grow
-- as fast as real time passes. updated_at is server-stamped so it can't be
-- forged. Clamps instead of rejecting so an honest client never errors.
create or replace function public.presence_guard()
returns trigger language plpgsql as $$
declare gap double precision;
begin
  gap := greatest(extract(epoch from (now() - old.updated_at)), 0);
  new.updated_at := now();
  if new.week_key = old.week_key then
    if new.week_sec > old.week_sec + gap + 5 then
      new.week_sec := (old.week_sec + gap + 5)::bigint;
    end if;
  else
    -- fresh week starts near zero (allow an overnight session's carryover)
    if new.week_sec > 21600 then
      new.week_sec := 0;
    end if;
  end if;
  if new.total_sec > old.total_sec + gap + 5 then
    new.total_sec := (old.total_sec + gap + 5)::bigint;
  end if;
  return new;
end;
$$;
drop trigger if exists presence_guard_t on public.presence;
create trigger presence_guard_t before update on public.presence
  for each row execute function public.presence_guard();

-- first insert: week_sec can't exceed the time elapsed in that week
-- (total_sec is seeded freely — restoring a cloud backup on a new device
-- legitimately carries lifetime hours)
create or replace function public.presence_seed_guard()
returns trigger language plpgsql as $$
declare wk_start timestamptz;
begin
  new.updated_at := now();
  if new.week_key ~ '^\d{4}-\d{2}-\d{2}$' then
    wk_start := (new.week_key || 'T00:00:00Z')::timestamptz - interval '1 day';
    if wk_start > now() or new.week_sec > extract(epoch from (now() - wk_start)) then
      new.week_sec := 0;
    end if;
  else
    new.week_sec := 0;
  end if;
  return new;
end;
$$;
drop trigger if exists presence_seed_t on public.presence;
create trigger presence_seed_t before insert on public.presence
  for each row execute function public.presence_seed_guard();


-- ============================================================
-- v0.41: SaaS readiness
-- ============================================================

-- ---------- chat media in Storage (out of Postgres) ----------
-- Bucket is PUBLIC-read by design: every object is E2E-encrypted client-side
-- (secretbox with a random key that travels inside the E2E message body) and
-- lives under an unguessable uuid path. Upload/delete restricted to the
-- owner's folder. 2MB per object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chatmedia', 'chatmedia', true, 2097152)
on conflict (id) do update set public = true, file_size_limit = 2097152;

drop policy if exists "chatmedia upload own" on storage.objects;
create policy "chatmedia upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chatmedia' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "chatmedia delete own" on storage.objects;
create policy "chatmedia delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chatmedia' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- account deletion (LGPD/GDPR) ----------
-- Every public table references auth.users ON DELETE CASCADE, so deleting the
-- auth row wipes the whole footprint (profile, presence, messages, groups
-- owned, reactions, backups, snapshots, pokes...).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- opt-in crash telemetry ----------
create table if not exists public.crash_reports (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  app_version text,
  os text,
  message text not null,
  stack text,
  created_at timestamptz not null default now()
);
alter table public.crash_reports enable row level security;

drop policy if exists "crash insert own" on public.crash_reports;
create policy "crash insert own" on public.crash_reports
  for insert to authenticated
  with check (user_id = auth.uid());

-- nobody reads reports through the API (dashboard/service only)
drop policy if exists "crash no select" on public.crash_reports;

-- cap: 10 reports per user per day, truncate huge payloads
create or replace function public.crash_report_guard()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.crash_reports
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'daily crash report limit';
  end if;
  new.message := left(new.message, 500);
  new.stack := left(new.stack, 4000);
  new.app_version := left(new.app_version, 40);
  new.os := left(new.os, 80);
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists crash_report_guard_t on public.crash_reports;
create trigger crash_report_guard_t before insert on public.crash_reports
  for each row execute function public.crash_report_guard();

-- self-GC: reports older than 30 days die on the next insert
create or replace function public.crash_report_gc()
returns trigger language plpgsql as $$
begin
  delete from public.crash_reports where created_at < now() - interval '30 days';
  return new;
end;
$$;
drop trigger if exists crash_report_gc_t on public.crash_reports;
create trigger crash_report_gc_t after insert on public.crash_reports
  for each statement execute function public.crash_report_gc();

-- ============================================================
-- v0.41.1: security hardening (post-review)
-- ============================================================

-- ---------- fix: crash report cap/GC actually work ----------
-- The originals were SECURITY INVOKER: RLS hid every row from the trigger's
-- count(), so the cap never fired and the GC never deleted. DEFINER fixes it.
create or replace function public.crash_report_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from crash_reports
      where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'daily crash report limit';
  end if;
  new.message := left(new.message, 500);
  new.stack := left(new.stack, 4000);
  new.app_version := left(new.app_version, 40);
  new.os := left(new.os, 80);
  new.created_at := now();
  return new;
end;
$$;
create or replace function public.crash_report_gc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.crash_reports where created_at < now() - interval '30 days';
  return new;
end;
$$;

-- ---------- fix: week_key flip exploit (presence + group jam clock) ----------
-- Old rule allowed seeding up to 6h of focus on ANY week_key change, both
-- directions, repeatably. New rule: carryover only when moving FORWARD into a
-- week that contains "now", capped by real elapsed time in that week.
create or replace function public.presence_guard()
returns trigger language plpgsql as $$
declare
  gap double precision;
  wk_start timestamptz;
begin
  gap := greatest(extract(epoch from (now() - old.updated_at)), 0);
  new.updated_at := now();
  if new.week_key is not distinct from old.week_key then
    if new.week_sec > old.week_sec + gap + 5 then
      new.week_sec := (old.week_sec + gap + 5)::bigint;
    end if;
  else
    if new.week_key is null
       or not (new.week_key ~ '^\d{4}-\d{2}-\d{2}$')
       or (old.week_key is not null and new.week_key <= old.week_key) then
      new.week_sec := 0;
    else
      wk_start := (new.week_key || 'T00:00:00Z')::timestamptz - interval '1 day';
      if wk_start > now()
         or now() > wk_start + interval '9 days'
         or new.week_sec::double precision > least(extract(epoch from (now() - wk_start)), 21600) then
        new.week_sec := 0;
      end if;
    end if;
  end if;
  if new.total_sec > old.total_sec + gap + 5 then
    new.total_sec := (old.total_sec + gap + 5)::bigint;
  end if;
  return new;
end;
$$;

create or replace function public.group_time_guard()
returns trigger language plpgsql as $$
declare
  gap double precision;
  wk_start timestamptz;
begin
  if new.week_jam_sec is distinct from old.week_jam_sec
     or new.week_key is distinct from old.week_key then
    if new.user_id <> auth.uid() then
      new.week_jam_sec := old.week_jam_sec;
      new.week_key := old.week_key;
      return new;
    end if;
    if new.week_key is not distinct from old.week_key then
      gap := greatest(
        extract(epoch from (now() - coalesce(old.jam_beat_at, now() - interval '75 seconds'))),
        0
      );
      if new.week_jam_sec > old.week_jam_sec + gap + 5 then
        new.week_jam_sec := (old.week_jam_sec + gap + 5)::bigint;
      end if;
    else
      if new.week_key is null
         or not (new.week_key ~ '^\d{4}-\d{2}-\d{2}$')
         or (old.week_key is not null and new.week_key <= old.week_key) then
        new.week_jam_sec := 0;
      else
        wk_start := (new.week_key || 'T00:00:00Z')::timestamptz - interval '1 day';
        if wk_start > now()
           or now() > wk_start + interval '9 days'
           or new.week_jam_sec::double precision > least(extract(epoch from (now() - wk_start)), 21600) then
          new.week_jam_sec := 0;
        end if;
      end if;
    end if;
    new.jam_beat_at := now();
  end if;
  return new;
end $$;

-- ---------- fix: sensitive group columns are ADMIN-only, server-side ----------
-- The column grant let ANY member rename the group, swap the photo, change
-- the weekly goal/pomodoro and rotate the invite code. Jam fields stay open
-- to every member (any member may start/stop the group jam).
create or replace function public.guard_group_admin_cols()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.name is distinct from old.name
      or new.avatar_b64 is distinct from old.avatar_b64
      or new.week_goal_hours is distinct from old.week_goal_hours
      or new.jam_pomo is distinct from old.jam_pomo
      or new.invite_code is distinct from old.invite_code)
     and not public.is_group_admin(new.id) then
    raise exception 'only admins can change group settings';
  end if;
  return new;
end;
$$;
drop trigger if exists group_admin_cols_t on public.groups;
create trigger group_admin_cols_t before update on public.groups
  for each row execute function public.guard_group_admin_cols();

-- ---------- fix: server-side size caps (Postgres bloat abuse) ----------
-- NOT VALID: existing rows are grandfathered, new writes are enforced.
alter table public.profiles drop constraint if exists profiles_avatar_len;
alter table public.profiles add constraint profiles_avatar_len
  check (avatar_b64 is null or char_length(avatar_b64) <= 200000) not valid;

alter table public.groups drop constraint if exists groups_avatar_len;
alter table public.groups add constraint groups_avatar_len
  check (avatar_b64 is null or char_length(avatar_b64) <= 250000) not valid;

alter table public.presence drop constraint if exists presence_field_len;
alter table public.presence add constraint presence_field_len
  check (
    (task is null or char_length(task) <= 200)
    and (public_projects is null or char_length(public_projects) <= 4000)
    and (jam_members is null or char_length(jam_members) <= 1000)
    and (fg_app is null or char_length(fg_app) <= 120)
    and (records is null or char_length(records) <= 500)
    and (week_key is null or char_length(week_key) <= 10)
  ) not valid;

alter table public.jam_invites drop constraint if exists jam_invites_task_len;
alter table public.jam_invites add constraint jam_invites_task_len
  check (char_length(task) <= 200) not valid;

alter table public.feed_events drop constraint if exists feed_payload_len;
alter table public.feed_events add constraint feed_payload_len
  check (char_length(payload::text) <= 2000) not valid;

alter table public.statuses drop constraint if exists statuses_bg_len;
alter table public.statuses add constraint statuses_bg_len
  check (bg is null or char_length(bg) <= 16) not valid;

alter table public.messages drop constraint if exists messages_meta_len;
alter table public.messages add constraint messages_meta_len
  check (
    char_length(nonce) <= 64
    and char_length(sender_pub) <= 64
    and char_length(recipient_pub) <= 64
  ) not valid;

alter table public.groups drop constraint if exists groups_invite_code_len;
alter table public.groups add constraint groups_invite_code_len
  check (invite_code is null or invite_code ~ '^[a-z0-9]{8,32}$') not valid;

-- ---------- fix: account deletion also purges Storage media (LGPD) ----------
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from storage.objects
    where bucket_id = 'chatmedia'
      and (storage.foldername(name))[1] = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- mitigate: per-user daily upload quota on chatmedia ----------
-- 300 objects/day/user. Wrapped: if this project's role can't attach triggers
-- to storage.objects, skip with a notice instead of failing the whole file.
create or replace function public.chatmedia_upload_quota()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bucket_id = 'chatmedia' and (
    select count(*) from storage.objects
    where bucket_id = 'chatmedia'
      and owner = new.owner
      and created_at > now() - interval '1 day'
  ) >= 300 then
    raise exception 'daily upload limit reached';
  end if;
  return new;
end;
$$;
do $$
begin
  drop trigger if exists chatmedia_quota_t on storage.objects;
  create trigger chatmedia_quota_t before insert on storage.objects
    for each row execute function public.chatmedia_upload_quota();
exception when insufficient_privilege then
  raise notice 'no privilege to attach trigger on storage.objects - upload quota skipped';
end $$;

-- ============================================================
-- v0.42: private realtime channels + group chat E2EE
-- ============================================================

-- ---------- private per-user inbox for ephemeral events ----------
-- Topic "ubox:<uuid>": only the owner may LISTEN; only accepted friends,
-- groupmates or the owner may SEND. Kills the two global-broadcast holes
-- (typing metadata leak + forged jam-shame): strangers can neither read nor
-- write, and clients filter senders against their own rosters.
drop policy if exists "ubox read own" on realtime.messages;
create policy "ubox read own" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and realtime.topic() like 'ubox:%'
    and realtime.topic() = 'ubox:' || auth.uid()::text
  );

drop policy if exists "ubox send friends" on realtime.messages;
create policy "ubox send friends" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and realtime.topic() like 'ubox:%'
    and (
      realtime.topic() = 'ubox:' || auth.uid()::text
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester = auth.uid()
                and 'ubox:' || f.addressee::text = realtime.topic())
            or (f.addressee = auth.uid()
                and 'ubox:' || f.requester::text = realtime.topic()))
      )
      or public.shares_group_with(
           nullif(substring(realtime.topic() from 6), '')::uuid
         )
    )
  );

-- ---------- group chat E2EE ----------
-- Model: one random symmetric group key (secretbox) per key VERSION. Each
-- version is wrapped individually for every member with crypto_box
-- (wrapper's private key + member's public key). Kick/leave => the next
-- sender rotates to a new version wrapped only for the remaining members,
-- so removed members cannot read anything sent after their removal.
-- The server stores only wrapped keys and ciphertext.
create table if not exists public.group_keys (
  group_id bigint not null references public.groups(id) on delete cascade,
  version int not null check (version between 1 and 100000),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- crypto_box(group_key) for user_id, plus the wrap metadata to open it
  wrapped_key text not null check (char_length(wrapped_key) <= 400),
  nonce text not null check (char_length(nonce) <= 64),
  wrapped_by uuid not null references auth.users(id) on delete cascade,
  wrapped_by_pub text not null check (char_length(wrapped_by_pub) <= 64),
  created_at timestamptz not null default now(),
  primary key (group_id, version, user_id)
);

alter table public.group_keys enable row level security;

-- you may only ever read the wraps addressed TO you
drop policy if exists gk_select on public.group_keys;
create policy gk_select on public.group_keys
  for select to authenticated using (auth.uid() = user_id);

-- any member may wrap (create/rotate) — but only as themselves, only for
-- members of that group (trigger), and never rewriting an existing wrap
drop policy if exists gk_insert on public.group_keys;
create policy gk_insert on public.group_keys
  for insert to authenticated
  with check (auth.uid() = wrapped_by and public.is_group_member(group_id));

create or replace function public.group_key_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from group_members
    where group_id = new.group_id and user_id = new.user_id
  ) then
    raise exception 'wrap target is not a group member';
  end if;
  return new;
end;
$$;
drop trigger if exists group_key_guard_t on public.group_keys;
create trigger group_key_guard_t before insert on public.group_keys
  for each row execute function public.group_key_guard();

-- ciphertext columns on group messages (legacy plaintext rows keep nonce null)
alter table public.group_messages add column if not exists nonce text
  check (nonce is null or char_length(nonce) <= 64);
alter table public.group_messages add column if not exists key_ver int;
alter table public.group_messages add column if not exists reply_to bigint;

-- E2E bodies are base64 ciphertext (media markers stay tiny; text grows ~1.4x)
alter table public.group_messages drop constraint if exists group_messages_body_check;
alter table public.group_messages add constraint group_messages_body_check
  check (char_length(body) <= 8000) not valid;

-- new kinds: image + voice (bodies are E2E markers pointing at chatmedia)
alter table public.group_messages drop constraint if exists group_messages_kind_check;
alter table public.group_messages add constraint group_messages_kind_check
  check (kind in ('text', 'system', 'image', 'voice'));

-- ---------- group message reactions (members only) ----------
create table if not exists public.group_msg_reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.group_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.group_msg_reactions enable row level security;

create or replace function public.gmsg_group_of(mid bigint)
returns bigint language sql security definer set search_path = public as $$
  select group_id from group_messages where id = mid;
$$;
revoke all on function public.gmsg_group_of(bigint) from public;
grant execute on function public.gmsg_group_of(bigint) to authenticated;

drop policy if exists gmr_select on public.group_msg_reactions;
create policy gmr_select on public.group_msg_reactions
  for select to authenticated
  using (public.is_group_member(public.gmsg_group_of(message_id)));

drop policy if exists gmr_insert on public.group_msg_reactions;
create policy gmr_insert on public.group_msg_reactions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.is_group_member(public.gmsg_group_of(message_id))
  );

drop policy if exists gmr_delete on public.group_msg_reactions;
create policy gmr_delete on public.group_msg_reactions
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.gmr_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from group_msg_reactions
      where message_id = new.message_id and user_id = new.user_id) >= 8 then
    raise exception 'too many reactions on this message';
  end if;
  return new;
end;
$$;
drop trigger if exists gmr_cap_t on public.group_msg_reactions;
create trigger gmr_cap_t before insert on public.group_msg_reactions
  for each row execute function public.gmr_cap();

do $$
begin
  alter publication supabase_realtime add table public.group_msg_reactions;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- v0.42.1: profile directory anti-enumeration
-- ============================================================
-- profiles was SELECT using(true): any signed-in account could bypass the app
-- and scrape the ENTIRE user directory (usernames + avatars + bios) with a
-- single gt/lt trick — a ready-made phishing/harassment list at scale. Now the
-- table is readable only for people you already have a relationship with, and
-- discovery-by-exact-username goes through SECURITY DEFINER lookups that can
-- never dump the whole table.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    auth.uid() = user_id
    or public.shares_group_with(user_id)
    or exists (
      select 1 from public.friendships f
      where (f.requester = auth.uid() and f.addressee = profiles.user_id)
         or (f.addressee = auth.uid() and f.requester = profiles.user_id)
    )
  );

-- exact-match discovery for "add friend by @name"
create or replace function public.lookup_profile(name text)
returns table(user_id uuid, username text, avatar_b64 text, e2e_pub text)
language sql security definer set search_path = public as $$
  select p.user_id, p.username, p.avatar_b64, p.e2e_pub
  from public.profiles p
  where lower(p.username) = lower(name)
  limit 1;
$$;
revoke all on function public.lookup_profile(text) from public;
grant execute on function public.lookup_profile(text) to authenticated;

-- batch exact-match for jam-roster avatars (people who may not be my friends);
-- hard-capped so it can't be turned into a bulk dump
create or replace function public.lookup_profiles(names text[])
returns table(username text, avatar_b64 text)
language sql security definer set search_path = public as $$
  select p.username, p.avatar_b64
  from public.profiles p
  where lower(p.username) = any (select lower(n) from unnest(names) as n)
  limit 30;
$$;
revoke all on function public.lookup_profiles(text[]) from public;
grant execute on function public.lookup_profiles(text[]) to authenticated;

-- ============================================================
-- v0.43: block + report (moderation)
-- ============================================================

-- ---------- blocks: hard-cut all contact both ways ----------
create table if not exists public.blocks (
  blocker uuid not null references auth.users(id) on delete cascade,
  blocked uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;

drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks
  for select to authenticated using (blocker = auth.uid());

drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks
  for insert to authenticated with check (blocker = auth.uid());

drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks
  for delete to authenticated using (blocker = auth.uid());

-- is there a block in EITHER direction between me and `other`?
create or replace function public.block_between(other uuid)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from blocks
    where (blocker = auth.uid() and blocked = other)
       or (blocker = other and blocked = auth.uid())
  );
$$;
revoke all on function public.block_between(uuid) from public;
grant execute on function public.block_between(uuid) to authenticated;

-- re-gate every 1:1 contact path so a block is airtight server-side:
-- no new friendship, message, jam invite or poke can cross a block.
drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    auth.uid() = requester and status = 'pending'
    and not public.block_between(addressee)
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check (
    auth.uid() = sender
    and not public.block_between(recipient)
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = sender and f.addressee = recipient)
          or (f.addressee = sender and f.requester = recipient))
    )
  );

drop policy if exists jam_insert on public.jam_invites;
create policy jam_insert on public.jam_invites
  for insert to authenticated
  with check (
    auth.uid() = from_user and status = 'pending'
    and not public.block_between(to_user)
  );

drop policy if exists pokes_insert on public.pokes;
create policy pokes_insert on public.pokes
  for insert to authenticated
  with check (
    auth.uid() = from_user
    and not public.block_between(to_user)
    and exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and ((f.requester = from_user and f.addressee = to_user)
          or (f.requester = to_user and f.addressee = from_user))
    )
  );

-- ---------- reports: users file, only staff (service role) reads ----------
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references auth.users(id) on delete cascade,
  target uuid not null references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) <= 60),
  detail text check (detail is null or char_length(detail) <= 500),
  created_at timestamptz not null default now(),
  check (reporter <> target)
);
alter table public.reports enable row level security;

drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated with check (reporter = auth.uid());
-- no select/update/delete policy: reports are write-only for users

-- cap 20 reports/day/user + self-GC of anything older than 90 days
create or replace function public.report_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from reports
      where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'daily report limit';
  end if;
  new.reason := left(new.reason, 60);
  new.detail := left(new.detail, 500);
  delete from reports where created_at < now() - interval '90 days';
  return new;
end;
$$;
drop trigger if exists report_guard_t on public.reports;
create trigger report_guard_t before insert on public.reports
  for each row execute function public.report_guard();
-- ========== v0.45: group message edits (DM parity) ==========

-- author-only, within 2 minutes (server-enforced), marked as edited
alter table public.group_messages add column if not exists edited_at timestamptz;

drop policy if exists gmsg_update on public.group_messages;
create policy gmsg_update on public.group_messages
  for update to authenticated
  using (auth.uid() = sender and created_at > now() - interval '2 minutes')
  with check (auth.uid() = sender);

-- only the body and the edited stamp are writable — sender/group/kind/time
-- stay locked, so an edit can't move a message or forge authorship
revoke update on public.group_messages from authenticated;
grant update (body, edited_at) on public.group_messages to authenticated;

-- ========== v0.46: DMs drop E2EE for NEW messages (RLS-only, Discord model) ==========
-- Old ciphertext rows stay untouched (clients still decrypt them locally when
-- the legacy key exists). New rows carry plaintext in `body`; RLS already
-- limits every row to its sender+recipient.

alter table public.messages add column if not exists body text;
alter table public.messages alter column nonce drop not null;
alter table public.messages alter column body_ct drop not null;
alter table public.messages alter column sender_pub drop not null;
alter table public.messages alter column recipient_pub drop not null;

-- one of the two forms must be present, and plaintext keeps the same size cap
alter table public.messages drop constraint if exists messages_body_form_check;
alter table public.messages add constraint messages_body_form_check
  check (body is not null or body_ct is not null) not valid;
alter table public.messages drop constraint if exists messages_body_len_check;
alter table public.messages add constraint messages_body_len_check
  check (body is null or char_length(body) <= 120000);

-- edits now write plaintext (and may clear legacy ciphertext columns)
revoke update on public.messages from authenticated;
grant update (body, nonce, body_ct, edited_at, sender_pub, recipient_pub, read_at)
  on public.messages to authenticated;

-- the read-receipt guard must also snap the NEW body column back when the
-- recipient stamps read_at — otherwise a recipient could rewrite messages
create or replace function public.read_receipt_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.read_at is distinct from old.read_at then
    if old.read_at is not null then
      new.read_at := old.read_at; -- read is write-once
    elsif auth.uid() <> old.recipient then
      new.read_at := old.read_at; -- only the recipient stamps it
    end if;
  end if;
  -- the recipient may ONLY touch read_at — everything else snaps back
  if auth.uid() = old.recipient and auth.uid() <> old.sender then
    new.body := old.body;
    new.nonce := old.nonce;
    new.body_ct := old.body_ct;
    new.edited_at := old.edited_at;
    new.sender_pub := old.sender_pub;
    new.recipient_pub := old.recipient_pub;
  end if;
  return new;
end $$;
