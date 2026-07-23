// Group chat + group JAM. Group messages are E2E-encrypted (versioned group
// key wrapped per member — see lib/groupcrypto.ts) with a plaintext fallback
// only when a member's app predates E2EE. The jam is server-authoritative:
// the group row holds task/started_at and each member row an in_jam flag, so
// every client renders the exact same participant list. Max 5 members (DB
// trigger).

import { currentUser, supabase } from './cloud';
import { cleanProfanity } from './filter';
import { weekKey } from './social';
import * as media from './media';

export const GROUP_MAX = 5;

export interface GroupRow {
  id: number;
  name: string;
  owner: string;
  jam_task: string | null;
  jam_started_at: string | null;
  /** synced pomodoro rhythm for the running jam, e.g. "25/5" (null = free) */
  jam_pomo: string | null;
  /** collective weekly goal in hours (null = off) */
  week_goal_hours: number | null;
  /** group photo (small jpeg data-url) */
  avatar_b64: string | null;
  /** join-by-link code, generated on first share */
  invite_code: string | null;
  created_at: string;
}

export interface GroupMember {
  group_id: number;
  user_id: string;
  is_admin: boolean;
  in_jam: boolean;
  /** seconds this member focused INSIDE this group's jam this week */
  week_jam_sec: number;
  week_key: string | null;
  username: string;
  avatar: string | null;
  /** member's published message key — null means their app predates E2EE */
  e2ePub: string | null;
}

export interface GroupSummary {
  group: GroupRow;
  members: GroupMember[];
  meAdmin: boolean;
}

export type GroupMessageKind = 'text' | 'system' | 'image' | 'voice';

export interface GroupMessage {
  id: number;
  sender: string;
  kind: GroupMessageKind;
  /** decrypted text / resolved media data-url; null = this device can't open it */
  body: string | null;
  created_at: string;
  edited_at: string | null;
  mine: boolean;
  senderName: string;
  reply_to: number | null;
  /** original storage marker for media rows (delete path) */
  mediaMarker?: string;
  reactions: { emoji: string; count: number; mine: boolean }[];
}

/** author-only, text-only, same 2-minute window the server enforces */
export function canEditGroupMsg(m: GroupMessage): boolean {
  return (
    m.mine && m.kind === 'text' && Date.now() - new Date(m.created_at).getTime() < 2 * 60_000
  );
}

async function attachProfiles(
  rows: {
    user_id: string;
    is_admin: boolean;
    in_jam: boolean;
    week_jam_sec: number;
    week_key: string | null;
  }[],
) {
  const ids = rows.map((r) => r.user_id);
  const names = new Map<
    string,
    { username: string; avatar: string | null; e2ePub: string | null }
  >();
  if (ids.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, avatar_b64, e2e_pub')
      .in('user_id', ids);
    for (const p of (data ?? []) as {
      user_id: string;
      username: string;
      avatar_b64: string | null;
      e2e_pub: string | null;
    }[])
      names.set(p.user_id, { username: p.username, avatar: p.avatar_b64, e2ePub: p.e2e_pub });
  }
  return rows.map((r) => ({
    ...r,
    group_id: 0,
    username: names.get(r.user_id)?.username ?? '???',
    avatar: names.get(r.user_id)?.avatar ?? null,
    e2ePub: names.get(r.user_id)?.e2ePub ?? null,
  }));
}

export async function listMyGroups(): Promise<GroupSummary[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data: mine } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id);
  const ids = (mine ?? []).map((m) => (m as { group_id: number }).group_id);
  if (ids.length === 0) return [];

  const [{ data: groups }, { data: members }] = await Promise.all([
    supabase.from('groups').select('*').in('id', ids),
    supabase
      .from('group_members')
      .select('group_id, user_id, is_admin, in_jam, week_jam_sec, week_key')
      .in('group_id', ids),
  ]);

  const memberRows = (members ?? []) as {
    group_id: number;
    user_id: string;
    is_admin: boolean;
    in_jam: boolean;
    week_jam_sec: number;
    week_key: string | null;
  }[];
  const withProfiles = await attachProfiles(
    memberRows.map((m) => ({
      user_id: m.user_id,
      is_admin: m.is_admin,
      in_jam: m.in_jam,
      week_jam_sec: m.week_jam_sec ?? 0,
      week_key: m.week_key ?? null,
    })),
  );
  // re-key by group (attachProfiles zeroed group_id)
  const byGroup = new Map<number, GroupMember[]>();
  memberRows.forEach((m, i) => {
    const enriched = { ...withProfiles[i], group_id: m.group_id };
    const list = byGroup.get(m.group_id) ?? [];
    list.push(enriched);
    byGroup.set(m.group_id, list);
  });

  return ((groups ?? []) as GroupRow[])
    .map((g) => {
      const mem = byGroup.get(g.id) ?? [];
      return {
        group: g,
        members: mem,
        meAdmin: mem.find((m) => m.user_id === user.id)?.is_admin ?? false,
      };
    })
    .sort((a, b) => (a.group.created_at < b.group.created_at ? 1 : -1));
}

/** Creates a group with me as owner+admin and the given friends as members. */
export async function createGroup(name: string, memberIds: string[]): Promise<number | null> {
  const user = await currentUser();
  if (!user) return null;
  const clean = cleanProfanity(name).trim().slice(0, 40) || 'Grupo';
  const { data, error } = await supabase
    .from('groups')
    .insert({ name: clean, owner: user.id })
    .select('id')
    .single();
  if (error || !data) return null;
  const gid = (data as { id: number }).id;
  // owner's own admin row first (RLS bootstraps admin from ownership)
  await supabase
    .from('group_members')
    .insert({ group_id: gid, user_id: user.id, is_admin: true, added_by: user.id });
  const others = memberIds.slice(0, GROUP_MAX - 1);
  if (others.length > 0) {
    await supabase
      .from('group_members')
      .insert(others.map((id) => ({ group_id: gid, user_id: id, added_by: user.id })));
  }
  return gid;
}

export async function renameGroup(groupId: number, name: string): Promise<string | null> {
  const clean = cleanProfanity(name).trim().slice(0, 40);
  if (!clean) return 'empty';
  const { error } = await supabase.from('groups').update({ name: clean }).eq('id', groupId);
  return error ? error.message : null;
}

export async function addMember(groupId: number, userId: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, user_id: userId, added_by: user.id });
  return error ? error.message : null;
}

export async function removeMember(groupId: number, userId: string): Promise<string | null> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  return error ? error.message : null;
}

export async function promoteMember(groupId: number, userId: string): Promise<string | null> {
  const { error } = await supabase
    .from('group_members')
    .update({ is_admin: true })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  return error ? error.message : null;
}

export async function demoteMember(groupId: number, userId: string): Promise<string | null> {
  const { error } = await supabase
    .from('group_members')
    .update({ is_admin: false })
    .eq('group_id', groupId)
    .eq('user_id', userId);
  return error ? error.message : null;
}

export async function leaveGroup(groupId: number): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', user.id);
}

export async function deleteGroup(groupId: number): Promise<void> {
  await supabase.from('groups').delete().eq('id', groupId);
}

// ---------- group jam (server-authoritative) ----------

/** Starts the group jam and joins me to it. */
export async function startGroupJam(
  groupId: number,
  task: string,
  pomo: string | null = null,
): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const startedAt = new Date().toISOString();
  const { error } = await supabase
    .from('groups')
    .update({
      jam_task: cleanProfanity(task).slice(0, 120),
      jam_started_at: startedAt,
      jam_pomo: pomo,
    })
    .eq('id', groupId);
  if (error) return error.message;
  await setJamMembership(groupId, true);
  return null;
}

/** Adds a minute of focused-in-THIS-group's-jam time to my own member row.
 *  Server trigger clamps growth to real elapsed time (anti-cheat). */
export async function bumpGroupJamTime(groupId: number, deltaSec: number): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const { data } = await supabase
    .from('group_members')
    .select('week_jam_sec, week_key')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  const wk = weekKey();
  const row = data as { week_jam_sec: number; week_key: string | null } | null;
  const cur = row && row.week_key === wk ? (row.week_jam_sec ?? 0) : 0;
  await supabase
    .from('group_members')
    .update({ week_jam_sec: cur + deltaSec, week_key: wk })
    .eq('group_id', groupId)
    .eq('user_id', user.id);
}

/** Admin sets (or clears) the group's collective weekly goal in hours. */
export async function setWeekGoal(groupId: number, hours: number | null): Promise<string | null> {
  const { error } = await supabase
    .from('groups')
    .update({ week_goal_hours: hours })
    .eq('id', groupId);
  return error ? error.message : null;
}

export async function setJamMembership(groupId: number, inJam: boolean): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await supabase
    .from('group_members')
    .update({ in_jam: inJam })
    .eq('group_id', groupId)
    .eq('user_id', user.id);
}

/** Last person out clears the jam so a stale task doesn't linger. */
export async function maybeEndGroupJam(groupId: number): Promise<void> {
  const { data } = await supabase
    .from('group_members')
    .select('in_jam')
    .eq('group_id', groupId)
    .eq('in_jam', true);
  if ((data ?? []).length === 0) {
    const { data: g } = await supabase
      .from('groups')
      .select('jam_started_at')
      .eq('id', groupId)
      .maybeSingle();
    const startedAt = (g as { jam_started_at: string | null } | null)?.jam_started_at;
    await supabase
      .from('groups')
      .update({ jam_task: null, jam_started_at: null, jam_pomo: null })
      .eq('id', groupId);
    // leave a memory of the session in the chat (language-neutral body)
    if (startedAt) {
      const min = Math.round(
        Math.max(0, Date.now() - new Date(startedAt).getTime()) / 60_000,
      );
      if (min >= 5) {
        const user = await currentUser();
        if (user) {
          await supabase
            .from('group_messages')
            .insert({ group_id: groupId, sender: user.id, kind: 'system', body: `🎧 JAM · ${min} min` });
        }
      }
    }
  }
}

/**
 * Boot-time self-heal: if I'm flagged in_jam anywhere but I'm NOT actually in a
 * session (app was force-closed mid-jam last time → orphan flag → "ghost jam"),
 * clear my flag and end any now-empty jam.
 */
export async function clearOrphanJamFlags(): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const { data } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', user.id)
    .eq('in_jam', true);
  const groupIds = ((data ?? []) as { group_id: number }[]).map((r) => r.group_id);
  for (const gid of groupIds) {
    await setJamMembership(gid, false);
    await maybeEndGroupJam(gid);
  }
}

// ---------- group messages ----------

interface RawGroupMsg {
  id: number;
  sender: string;
  kind: GroupMessageKind;
  body: string;
  created_at: string;
  edited_at: string | null;
  reply_to: number | null;
}

export async function listGroupMessages(groupId: number, limit = 80): Promise<GroupMessage[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('group_messages')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as RawGroupMsg[]).reverse();

  const senderIds = [...new Set(rows.map((r) => r.sender))];
  const names = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('user_id, username')
      .in('user_id', senderIds);
    for (const p of (profs ?? []) as { user_id: string; username: string }[])
      names.set(p.user_id, p.username);
  }

  // reactions for this page of messages
  const msgIds = rows.map((r) => r.id);
  const reactionsBy = new Map<number, { emoji: string; count: number; mine: boolean }[]>();
  if (msgIds.length > 0) {
    const { data: reacts } = await supabase
      .from('group_msg_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', msgIds);
    const grouped = new Map<number, Map<string, { count: number; mine: boolean }>>();
    for (const r of (reacts ?? []) as { message_id: number; user_id: string; emoji: string }[]) {
      let m = grouped.get(r.message_id);
      if (!m) {
        m = new Map();
        grouped.set(r.message_id, m);
      }
      const cur = m.get(r.emoji) ?? { count: 0, mine: false };
      cur.count += 1;
      if (r.user_id === user.id) cur.mine = true;
      m.set(r.emoji, cur);
    }
    for (const [mid, m] of grouped) {
      reactionsBy.set(
        mid,
        [...m.entries()].map(([emoji, v]) => ({ emoji, count: v.count, mine: v.mine })),
      );
    }
  }

  return Promise.all(
    rows.map(async (r) => {
      let body: string | null = r.body;
      let mediaMarker: string | undefined;
      if ((r.kind === 'image' || r.kind === 'voice') && media.isMediaMarker(body)) {
        mediaMarker = body;
        body = await media.resolveMedia(body);
      }
      return {
        id: r.id,
        sender: r.sender,
        kind: r.kind,
        body,
        created_at: r.created_at,
        edited_at: r.edited_at ?? null,
        mine: r.sender === user.id,
        senderName: names.get(r.sender) ?? '???',
        reply_to: r.reply_to,
        mediaMarker,
        reactions: reactionsBy.get(r.id) ?? [],
      };
    }),
  );
}

/**
 * Sends a group message. Group chat is RLS-protected (members only), not E2E —
 * text/stickers travel as-is, media as a Storage marker (the blob itself is
 * still encrypted with a random key carried in the marker).
 */
export async function sendGroupMessage(
  groupId: number,
  kind: GroupMessageKind,
  body: string,
  replyTo: number | null = null,
): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const isMedia = kind === 'image' || kind === 'voice';
  // stickers travel as a literal [sticker:mood] marker — no profanity pass
  const isSticker = /^\[sticker:\w+\]$/.test(body);
  const clean = isMedia || isSticker ? body : cleanProfanity(body).trim().slice(0, 2000);
  if (!clean) return null;
  const { error } = await supabase.from('group_messages').insert({
    group_id: groupId,
    sender: user.id,
    kind,
    body: clean,
    reply_to: replyTo,
  });
  return error ? error.message : null;
}

export async function deleteGroupMessage(id: number): Promise<void> {
  await supabase.from('group_messages').delete().eq('id', id);
}

/** Replaces the body (author-only; RLS rejects edits older than 2 minutes). */
export async function editGroupMessage(id: number, newText: string): Promise<string | null> {
  const clean = cleanProfanity(newText).trim().slice(0, 2000);
  if (!clean) return null;
  const { error } = await supabase
    .from('group_messages')
    .update({ body: clean, edited_at: new Date().toISOString() })
    .eq('id', id);
  return error ? error.message : null;
}

/** Adds/removes my emoji on a group message. */
export async function toggleGroupReaction(messageId: number, emoji: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const { error } = await supabase
    .from('group_msg_reactions')
    .insert({ message_id: messageId, user_id: user.id, emoji });
  if (error) {
    await supabase
      .from('group_msg_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
  }
}

/** One channel for every group table — caller reloads on any push. */
export function subscribeGroups(onChange: () => void): () => void {
  const channel = supabase
    .channel('groups-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_msg_reactions' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

/** Group photo (small jpeg data-url) — admins only via the update grant+policy. */
export async function setGroupAvatar(groupId: number, b64: string | null): Promise<string | null> {
  if (b64 && b64.length > 200_000) return 'image too large';
  const { error } = await supabase.from('groups').update({ avatar_b64: b64 }).eq('id', groupId);
  return error ? error.message : null;
}

/** Returns the group invite code, creating one on first use. */
export async function ensureInviteCode(groupId: number): Promise<string | null> {
  const { data } = await supabase
    .from('groups')
    .select('invite_code')
    .eq('id', groupId)
    .maybeSingle();
  const cur = (data as { invite_code: string | null } | null)?.invite_code;
  if (cur) return cur;
  const code = Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31])
    .join('');
  const { error } = await supabase
    .from('groups')
    .update({ invite_code: code })
    .eq('id', groupId);
  if (!error) return code;
  // generation is admin-only server-side — a non-admin (or a race) lands here;
  // re-read in case an admin already generated one
  const { data: again } = await supabase
    .from('groups')
    .select('invite_code')
    .eq('id', groupId)
    .maybeSingle();
  return (again as { invite_code: string | null } | null)?.invite_code ?? null;
}

/** Joins a group by invite code (server enforces the 5-member cap). */
export async function redeemInvite(code: string): Promise<number | string> {
  const clean = code.trim().replace(/^lockedin:group\//i, '');
  if (!clean) return 'invalid';
  const { data, error } = await supabase.rpc('redeem_group_invite', { code: clean });
  if (error) return error.message;
  return data as number;
}

/** Realtime group messages (mentions, live chat refresh). */
export function subscribeGroupMessages(
  onRow: (row: { group_id: number; sender: string; kind: string; body: string }) => void,
): () => void {
  const chan = supabase
    .channel('gmsg-watch')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'group_messages' },
      (payload) => {
        if (payload.new) {
          onRow(payload.new as { group_id: number; sender: string; kind: string; body: string });
        }
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(chan).catch(() => {});
  };
}

/** Latest message per group, WhatsApp-row style (RLS scopes to my groups). */
export interface GroupLastMessage {
  kind: GroupMessageKind;
  text: string | null;
  created_at: string;
  mine: boolean;
  senderName: string;
}

export async function fetchGroupLastMessages(): Promise<Map<number, GroupLastMessage>> {
  const out = new Map<number, GroupLastMessage>();
  const user = await currentUser();
  if (!user) return out;
  const { data } = await supabase
    .from('group_messages')
    .select('group_id, sender, kind, body, created_at')
    .order('created_at', { ascending: false })
    .limit(120);
  const rows = (data ?? []) as {
    group_id: number;
    sender: string;
    kind: GroupMessageKind;
    body: string | null;
    created_at: string;
  }[];
  const tops = new Map<number, (typeof rows)[number]>();
  for (const r of rows) if (!tops.has(r.group_id)) tops.set(r.group_id, r);
  const senderIds = [...new Set([...tops.values()].map((r) => r.sender))];
  const names = new Map<string, string>();
  if (senderIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('user_id, username')
      .in('user_id', senderIds);
    for (const p of (profs ?? []) as { user_id: string; username: string }[])
      names.set(p.user_id, p.username);
  }
  for (const [gid, r] of tops)
    out.set(gid, {
      kind: r.kind,
      text: r.kind === 'text' ? r.body : null,
      created_at: r.created_at,
      mine: r.sender === user.id,
      senderName: names.get(r.sender) ?? '',
    });
  return out;
}
