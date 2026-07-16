// Group chat + group JAM. Groups are RLS-protected (members only) but NOT
// end-to-end encrypted — the jam is server-authoritative: the group row holds
// task/started_at and each member row an in_jam flag, so every client renders
// the exact same participant list (this is what the ad-hoc 1:1 jam couldn't do
// for 3+ people). Max 5 members, enforced by a DB trigger.

import { currentUser, supabase } from './cloud';
import { cleanProfanity } from './filter';

export const GROUP_MAX = 5;

export interface GroupRow {
  id: number;
  name: string;
  owner: string;
  jam_task: string | null;
  jam_started_at: string | null;
  created_at: string;
}

export interface GroupMember {
  group_id: number;
  user_id: string;
  is_admin: boolean;
  in_jam: boolean;
  username: string;
  avatar: string | null;
}

export interface GroupSummary {
  group: GroupRow;
  members: GroupMember[];
  meAdmin: boolean;
}

export interface GroupMessage {
  id: number;
  sender: string;
  kind: 'text' | 'system';
  body: string;
  created_at: string;
  mine: boolean;
  senderName: string;
}

async function attachProfiles(rows: { user_id: string; is_admin: boolean; in_jam: boolean }[]) {
  const ids = rows.map((r) => r.user_id);
  const names = new Map<string, { username: string; avatar: string | null }>();
  if (ids.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, username, avatar_b64')
      .in('user_id', ids);
    for (const p of (data ?? []) as { user_id: string; username: string; avatar_b64: string | null }[])
      names.set(p.user_id, { username: p.username, avatar: p.avatar_b64 });
  }
  return rows.map((r) => ({
    ...r,
    group_id: 0,
    username: names.get(r.user_id)?.username ?? '???',
    avatar: names.get(r.user_id)?.avatar ?? null,
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
    supabase.from('group_members').select('group_id, user_id, is_admin, in_jam').in('group_id', ids),
  ]);

  const memberRows = (members ?? []) as {
    group_id: number;
    user_id: string;
    is_admin: boolean;
    in_jam: boolean;
  }[];
  const withProfiles = await attachProfiles(
    memberRows.map((m) => ({ user_id: m.user_id, is_admin: m.is_admin, in_jam: m.in_jam })),
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
export async function startGroupJam(groupId: number, task: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const startedAt = new Date().toISOString();
  const { error } = await supabase
    .from('groups')
    .update({ jam_task: cleanProfanity(task).slice(0, 120), jam_started_at: startedAt })
    .eq('id', groupId);
  if (error) return error.message;
  await setJamMembership(groupId, true);
  return null;
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
    await supabase
      .from('groups')
      .update({ jam_task: null, jam_started_at: null })
      .eq('id', groupId);
  }
}

// ---------- group messages ----------

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
  const rows = ((data ?? []) as { id: number; sender: string; kind: 'text' | 'system'; body: string; created_at: string }[]).reverse();
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
  return rows.map((r) => ({
    id: r.id,
    sender: r.sender,
    kind: r.kind,
    body: r.body,
    created_at: r.created_at,
    mine: r.sender === user.id,
    senderName: names.get(r.sender) ?? '???',
  }));
}

export async function sendGroupMessage(groupId: number, body: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return 'not signed in';
  const clean = cleanProfanity(body).trim().slice(0, 2000);
  if (!clean) return null;
  const { error } = await supabase
    .from('group_messages')
    .insert({ group_id: groupId, sender: user.id, body: clean });
  return error ? error.message : null;
}

export async function deleteGroupMessage(id: number): Promise<void> {
  await supabase.from('group_messages').delete().eq('id', id);
}

/** One channel for every group table — caller reloads on any push. */
export function subscribeGroups(onChange: () => void): () => void {
  const channel = supabase
    .channel('groups-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}
