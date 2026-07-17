// Friends system on Supabase: profiles (unique username), friendships
// (request → accept), presence (live "focusing now" heartbeat).
//
// All authorization is server-side RLS (see supabase/social.sql). Everything
// here assumes the worst about the client and lets the server say no.

import { currentUser, supabase } from './cloud';
import { hasProfanity } from './filter';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export interface Profile {
  user_id: string;
  username: string;
  avatar_b64?: string | null;
  e2e_pub?: string | null;
  bio?: string | null;
  status_text?: string | null;
}

export interface FriendEntry {
  friendshipId: number;
  userId: string;
  username: string;
  avatar: string | null;
  /** current message public key — null means their app predates messaging */
  e2ePub: string | null;
  bio: string | null;
  statusText: string | null;
}

export interface FriendsState {
  me: Profile | null;
  friends: FriendEntry[];
  /** requests other people sent me — accept/reject */
  incoming: FriendEntry[];
  /** requests I sent — cancel */
  outgoing: FriendEntry[];
}

export interface PresenceRow {
  user_id: string;
  focusing: boolean;
  task: string | null;
  started_at: string | null;
  week_sec: number;
  week_key: string | null;
  updated_at: string;
  app_version: string | null;
  /** JSON [{n: project, s: seconds}] — only when the user made projects public */
  public_projects: string | null;
  /** lifetime focused seconds — drives the badges on the profile */
  total_sec: number;
  /** JSON usernames of everyone in this user's current jam, null when solo */
  jam_members: string | null;
}

/** A presence row older than this is treated as offline (app closed/crashed). */
export const PRESENCE_STALE_MS = 150_000;

// ---------- week helpers (local Monday) ----------

export function weekStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
  return d;
}

export function weekKey(): string {
  const d = weekStart();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------- profile ----------

export async function getMyProfile(): Promise<Profile | null> {
  const user = await currentUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('user_id, username, avatar_b64, e2e_pub, bio, status_text')
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

/** Saves the custom status line (already profanity-cleaned by the caller). */
export async function updateStatusText(text: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supabase
    .from('profiles')
    .update({ status_text: text.trim().slice(0, 80) || null })
    .eq('user_id', user.id);
  return error ? error.message : null;
}

/** Saves the profile bio (already profanity-cleaned by the caller). */
export async function updateBio(bio: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supabase
    .from('profiles')
    .update({ bio: bio.trim().slice(0, 140) || null })
    .eq('user_id', user.id);
  return error ? error.message : null;
}

/** Sets (or clears) the profile photo — a small jpeg data-url. */
export async function updateAvatar(b64: string | null): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  if (b64 && b64.length > 200_000) return 'image too large';
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_b64: b64 })
    .eq('user_id', user.id);
  return error ? error.message : null;
}

export type ClaimResult = 'ok' | 'taken' | 'invalid' | 'error';

export async function claimUsername(name: string): Promise<ClaimResult> {
  const username = name.trim();
  if (!USERNAME_RE.test(username)) return 'invalid';
  if (hasProfanity(username)) return 'invalid';
  const user = await currentUser();
  if (!user) return 'error';
  const { error } = await supabase
    .from('profiles')
    .upsert({ user_id: user.id, username }, { onConflict: 'user_id' });
  if (!error) return 'ok';
  if (error.code === '23505') return 'taken'; // unique lower(username)
  return 'error';
}

export async function usernameAvailable(name: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('username_available', { name: name.trim() });
  if (error) return true; // fail open — the claim itself still enforces uniqueness
  return data === true;
}

// ---------- friendships ----------

export async function loadFriendsState(): Promise<FriendsState> {
  const user = await currentUser();
  if (!user) return { me: null, friends: [], incoming: [], outgoing: [] };

  const [me, { data: rows, error }] = await Promise.all([
    getMyProfile(),
    supabase.from('friendships').select('id, requester, addressee, status'),
  ]);
  if (error) throw new Error(error.message);

  const all = (rows ?? []) as {
    id: number;
    requester: string;
    addressee: string;
    status: string;
  }[];

  const otherIds = [...new Set(all.map((f) => (f.requester === user.id ? f.addressee : f.requester)))];
  interface ProfileWithKey extends Profile {
    e2e_pub?: string | null;
  }
  const profiles = new Map<string, ProfileWithKey>();
  if (otherIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('user_id, username, avatar_b64, e2e_pub, bio, status_text')
      .in('user_id', otherIds);
    for (const p of (profs ?? []) as ProfileWithKey[]) profiles.set(p.user_id, p);
  }

  const entry = (f: (typeof all)[number]): FriendEntry => {
    const other = f.requester === user.id ? f.addressee : f.requester;
    const p = profiles.get(other);
    return {
      friendshipId: f.id,
      userId: other,
      username: p?.username ?? '???',
      avatar: p?.avatar_b64 ?? null,
      e2ePub: p?.e2e_pub ?? null,
      bio: p?.bio ?? null,
      statusText: p?.status_text ?? null,
    };
  };

  return {
    me,
    friends: all.filter((f) => f.status === 'accepted').map(entry),
    incoming: all.filter((f) => f.status === 'pending' && f.addressee === user.id).map(entry),
    outgoing: all.filter((f) => f.status === 'pending' && f.requester === user.id).map(entry),
  };
}

export type AddResult = 'sent' | 'notfound' | 'self' | 'duplicate' | 'error';

export async function sendFriendRequest(username: string): Promise<AddResult> {
  const user = await currentUser();
  if (!user) return 'error';
  const name = username.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(name)) return 'notfound';

  // exact match, case-insensitive (ilike with no wildcards)
  const { data: prof } = await supabase
    .from('profiles')
    .select('user_id, username')
    .ilike('username', name)
    .maybeSingle();
  if (!prof) return 'notfound';
  const target = prof as Profile;
  if (target.user_id === user.id) return 'self';

  const { error } = await supabase
    .from('friendships')
    .insert({ requester: user.id, addressee: target.user_id, status: 'pending' });
  if (!error) return 'sent';
  if (error.code === '23505') return 'duplicate'; // pair already related
  return 'error';
}

export async function acceptRequest(friendshipId: number): Promise<string | null> {
  const { error } = await supabase
    .from('friendships')
    .update({ status: 'accepted' })
    .eq('id', friendshipId);
  return error ? error.message : null;
}

/** Reject an incoming request, cancel an outgoing one, or unfriend. */
export async function removeFriendship(friendshipId: number): Promise<string | null> {
  const { error } = await supabase.from('friendships').delete().eq('id', friendshipId);
  return error ? error.message : null;
}

// ---------- presence ----------

export interface PublishPresenceInput {
  focusing: boolean;
  task: string | null;
  /** ISO instant the running session started, null when idle */
  startedAt: string | null;
  weekSec: number;
  appVersion: string;
  /** already-serialized top projects, or null when the user keeps them private */
  publicProjects: string | null;
  totalSec: number;
  /** usernames in my current jam (null when solo) */
  jamMembers: string[] | null;
}

export async function publishPresence(p: PublishPresenceInput): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await supabase.from('presence').upsert({
    user_id: user.id,
    focusing: p.focusing,
    task: p.task,
    started_at: p.startedAt,
    week_sec: Math.max(0, Math.floor(p.weekSec)),
    week_key: weekKey(),
    updated_at: new Date().toISOString(),
    app_version: p.appVersion,
    public_projects: p.publicProjects,
    total_sec: Math.max(0, Math.floor(p.totalSec)),
    jam_members:
      p.jamMembers && p.jamMembers.length > 1 ? JSON.stringify(p.jamMembers) : null,
  });
}

export async function fetchPresence(userIds: string[]): Promise<Map<string, PresenceRow>> {
  const map = new Map<string, PresenceRow>();
  if (userIds.length === 0) return map;
  const { data } = await supabase.from('presence').select('*').in('user_id', userIds);
  for (const row of (data ?? []) as PresenceRow[]) map.set(row.user_id, row);
  return map;
}

export function isLive(row: PresenceRow | undefined): boolean {
  if (!row || !row.focusing) return false;
  return Date.now() - new Date(row.updated_at).getTime() < PRESENCE_STALE_MS;
}

/** App open (fresh heartbeat), focusing or not. Stale row = app closed = away. */
export function isOnline(row: PresenceRow | undefined): boolean {
  if (!row) return false;
  return Date.now() - new Date(row.updated_at).getTime() < PRESENCE_STALE_MS;
}

export type FriendStatus = 'focusing' | 'online' | 'away';

/**
 * Status from the DB presence row alone (legacy fallback). Prefer the
 * realtime-aware variant when an online-id set is available.
 */
export function friendStatus(row: PresenceRow | undefined): FriendStatus {
  if (isLive(row)) return 'focusing';
  if (isOnline(row)) return 'online';
  return 'away';
}

/** Focusing from the DB row; online/away from the realtime channel. */
export function friendStatusRT(
  row: PresenceRow | undefined,
  userId: string,
  onlineIds: Set<string>,
): FriendStatus {
  if (isLive(row)) return 'focusing';
  if (onlineIds.has(userId) || isOnline(row)) return 'online';
  return 'away';
}

/** True when the friend's app is older than the version a feature needs. */
export function versionBelow(row: PresenceRow | undefined, min: string): boolean {
  const v = row?.app_version;
  if (!v) return true; // pre-versioning builds are old by definition
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** Push notifications for presence changes; returns an unsubscribe fn. */
export function subscribePresence(onChange: () => void): () => void {
  const channel = supabase
    .channel('presence-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'presence' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

/**
 * Push notifications for friendship changes (new request, accept). RLS limits
 * INSERT/UPDATE events to the two people involved; deletes may not push under
 * RLS, so the caller keeps a slow poll as backstop.
 */
export function subscribeFriendships(onChange: () => void): () => void {
  const channel = supabase
    .channel('friendships-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ---------- jam (shared focus) ----------

export interface JamInvite {
  id: number;
  from_user: string;
  to_user: string;
  /** 'invite' = host calls a friend in; 'request' = friend asks to join the host */
  kind: 'invite' | 'request';
  task: string;
  session_started_at: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
}

/** An invite older than this is dead — never prompt for it. */
export const JAM_INVITE_TTL_MS = 3 * 60_000;

export function jamInviteFresh(inv: JamInvite): boolean {
  return Date.now() - new Date(inv.created_at).getTime() < JAM_INVITE_TTL_MS;
}

export async function sendJamInvite(
  toUserId: string,
  kind: 'invite' | 'request',
  task: string,
  sessionStartedAt: string,
): Promise<{ id: number } | { error: string }> {
  const user = await currentUser();
  if (!user) return { error: 'not signed in' };
  const { data, error } = await supabase
    .from('jam_invites')
    .insert({
      from_user: user.id,
      to_user: toUserId,
      kind,
      task,
      session_started_at: sessionStartedAt,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) return { error: error?.message ?? 'insert failed' };
  return { id: (data as { id: number }).id };
}

export async function answerJamInvite(
  id: number,
  accept: boolean,
): Promise<string | null> {
  const { error } = await supabase
    .from('jam_invites')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', id);
  return error ? error.message : null;
}

export async function cancelJamInvite(id: number): Promise<void> {
  await supabase.from('jam_invites').delete().eq('id', id);
}

/** Fresh pending invites addressed to me (prompt material). */
export async function fetchPendingJamInvites(): Promise<JamInvite[]> {
  const user = await currentUser();
  if (!user) return [];
  const sinceIso = new Date(Date.now() - JAM_INVITE_TTL_MS).toISOString();
  const { data } = await supabase
    .from('jam_invites')
    .select('*')
    .eq('to_user', user.id)
    .eq('status', 'pending')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });
  return ((data ?? []) as JamInvite[]).filter(jamInviteFresh);
}

/** One row by id (freshest status). */
export async function fetchJamInvite(id: number): Promise<JamInvite | null> {
  const { data } = await supabase.from('jam_invites').select('*').eq('id', id).maybeSingle();
  return (data as JamInvite | null) ?? null;
}

/**
 * Native realtime "who's connected" — the correct source for online/away.
 * Every signed-in client tracks its userId on a shared channel; presence is
 * derived from the live websocket, so it's instant and immune to clock skew
 * (the DB heartbeat's timestamp comparison was neither). Focusing still comes
 * from the DB row; this only answers online-vs-away.
 */
export async function subscribeOnline(
  onChange: (onlineIds: Set<string>) => void,
): Promise<() => void> {
  const user = await currentUser();
  const channel = supabase.channel('online-presence', {
    config: { presence: { key: user?.id ?? 'anon' } },
  });
  channel
    .on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<{ uid: string }>();
      const ids = new Set<string>();
      for (const key of Object.keys(state)) {
        for (const entry of state[key]) if (entry.uid) ids.add(entry.uid);
      }
      onChange(ids);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && user) {
        channel.track({ uid: user.id }).catch(() => {});
      }
    });
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

export function subscribeJamInvites(onChange: () => void): () => void {
  const channel = supabase
    .channel('jam-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'jam_invites' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ---------- pokes: nudge a friend / cheer someone focusing ----------

export type PokeKind = 'poke' | 'cheer';

export interface PokeRow {
  id: number;
  from_user: string;
  to_user: string;
  kind: PokeKind;
  created_at: string;
}

/** Server enforces friends-only + rate limit (poke 1/h, cheer 1/10min). */
export async function sendPoke(toUserId: string, kind: PokeKind): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supabase
    .from('pokes')
    .insert({ from_user: user.id, to_user: toUserId, kind });
  if (!error) return null;
  return /rate limited/i.test(error.message) ? 'rate' : error.message;
}

/** Pokes addressed to me newer than the given instant (missed-while-closed). */
export async function fetchPokesSince(sinceIso: string): Promise<PokeRow[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data } = await supabase
    .from('pokes')
    .select('*')
    .eq('to_user', user.id)
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(20);
  return (data ?? []) as PokeRow[];
}

export function subscribePokes(onRow: (row: PokeRow) => void): () => void {
  const channel = supabase
    .channel('pokes-watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pokes' }, (payload) => {
      if (payload.new) onRow(payload.new as PokeRow);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ---------- activity feed (friends-visible, self-reported wins) ----------

export type FeedKind = 'streak' | 'record_session' | 'record_day' | 'jam';

export interface FeedEvent {
  id: number;
  user_id: string;
  kind: FeedKind;
  payload: { n?: number; sec?: number };
  created_at: string;
}

export async function postFeedEvent(
  kind: FeedKind,
  payload: { n?: number; sec?: number },
): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await supabase.from('feed_events').insert({ user_id: user.id, kind, payload });
}

/** Friends'' (and my) events from the last 7 days, newest first. */
export async function fetchFeed(): Promise<FeedEvent[]> {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await supabase
    .from('feed_events')
    .select('*')
    .gt('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as FeedEvent[];
}

/** Avatars/casing for arbitrary usernames (e.g. jam members I haven't added). */
export async function fetchProfilesByUsernames(
  names: string[],
): Promise<Map<string, { username: string; avatar: string | null }>> {
  const map = new Map<string, { username: string; avatar: string | null }>();
  if (names.length === 0) return map;
  const { data } = await supabase
    .from('profiles')
    .select('username, avatar_b64')
    .in('username', names);
  for (const p of (data ?? []) as { username: string; avatar_b64: string | null }[]) {
    map.set(p.username.toLowerCase(), { username: p.username, avatar: p.avatar_b64 });
  }
  return map;
}

// ---------- jam shame: ephemeral broadcast, no rows stored ----------

export interface ShamePayload {
  /** username of the slacker */
  from: string;
  /** app they wandered off to */
  app: string;
  /** lowercase usernames of everyone in the jam (recipients filter themselves) */
  members: string[];
}

export function joinJamShame(onMsg: (p: ShamePayload) => void): {
  send: (p: ShamePayload) => void;
  close: () => void;
} {
  const chan = supabase.channel('jam-shame');
  chan
    .on('broadcast', { event: 'shame' }, (e) => {
      if (e.payload) onMsg(e.payload as ShamePayload);
    })
    .subscribe();
  return {
    send: (p) => {
      chan.send({ type: 'broadcast', event: 'shame', payload: p }).catch(() => {});
    },
    close: () => {
      supabase.removeChannel(chan).catch(() => {});
    },
  };
}

export function subscribeFeed(onChange: () => void): () => void {
  const chan = supabase
    .channel('feed-watch')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'feed_events' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(chan).catch(() => {});
  };
}
