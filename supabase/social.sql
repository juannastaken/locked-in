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
alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check
  check (kind in ('text', 'jam', 'image'));

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
