// Friends system on Supabase: profiles (unique username), friendships
// (request → accept), presence (live "focusing now" heartbeat).
//
// All authorization is server-side RLS (see supabase/social.sql). Everything
// here assumes the worst about the client and lets the server say no.

import { currentUser, supabase } from './cloud';

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export interface Profile {
  user_id: string;
  username: string;
}

export interface FriendEntry {
  friendshipId: number;
  userId: string;
  username: string;
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
    .select('user_id, username')
    .eq('user_id', user.id)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

export type ClaimResult = 'ok' | 'taken' | 'invalid' | 'error';

export async function claimUsername(name: string): Promise<ClaimResult> {
  const username = name.trim();
  if (!USERNAME_RE.test(username)) return 'invalid';
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
  const names = new Map<string, string>();
  if (otherIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('user_id, username')
      .in('user_id', otherIds);
    for (const p of (profs ?? []) as Profile[]) names.set(p.user_id, p.username);
  }

  const entry = (f: (typeof all)[number]): FriendEntry => {
    const other = f.requester === user.id ? f.addressee : f.requester;
    return { friendshipId: f.id, userId: other, username: names.get(other) ?? '???' };
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
