// 1:1 messages between accepted friends. Since v0.46 new messages travel as
// PLAINTEXT protected by RLS only (the Discord model: sign in and everything
// loads — no per-device key, no backups, no "another key" dead ends). Rows
// from the E2EE era still decrypt through e2e.ts when this device has the old
// key; media blobs stay encrypted with the per-blob key inside their marker.

import { currentUser, supabase } from './cloud';
import * as e2e from './e2e';
import { cleanProfanity } from './filter';

export type MessageKind = 'text' | 'jam' | 'image' | 'voice' | 'status';

export interface MessageRow {
  id: number;
  sender: string;
  recipient: string;
  kind: MessageKind;
  /** plaintext body (v0.46+); null on E2EE-era rows */
  body: string | null;
  nonce: string | null;
  body_ct: string | null;
  sender_pub: string | null;
  recipient_pub: string | null;
  reply_to: number | null;
  edited_at: string | null;
  read_at: string | null;
  created_at: string;
}

/** Plaintext body, or the legacy decrypt when this device still has the key. */
async function readBody(r: MessageRow, mine: boolean): Promise<string | null> {
  if (r.body !== null && r.body !== undefined) return r.body;
  if (!r.body_ct || !r.nonce || !r.sender_pub || !r.recipient_pub) return null;
  return e2e.decryptRow(
    { nonce: r.nonce, body_ct: r.body_ct, sender_pub: r.sender_pub, recipient_pub: r.recipient_pub },
    mine,
  );
}

export interface DecryptedMessage {
  id: number;
  mine: boolean;
  kind: MessageKind;
  /** null = this device's key can't open it (rotated/missing key) */
  text: string | null;
  reply_to: number | null;
  edited_at: string | null;
  /** server-stamped when the recipient opened the conversation (✓✓) */
  read_at: string | null;
  /** emoji → users who reacted ('me' aware via mine flag on caller side) */
  reactions: { emoji: string; count: number; mine: boolean }[];
  created_at: string;
  /** original storage marker when text was resolved from Storage media */
  mediaMarker?: string;
}

/** Last message of each conversation, decrypted — the WhatsApp-style row line. */
export interface LastMessage {
  friendId: string;
  mine: boolean;
  kind: MessageKind;
  text: string | null;
  read_at: string | null;
  created_at: string;
}

export const MESSAGE_MAX_CHARS = 2000;
/** how long the author can still edit a message (server enforces it too) */
export const EDIT_WINDOW_MS = 2 * 60_000;

export function canEdit(m: DecryptedMessage): boolean {
  return m.mine && m.kind === 'text' && Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS;
}

/** Fetches the friend's CURRENT public key straight from the server. */
export async function fetchFriendPub(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('e2e_pub')
    .eq('user_id', userId)
    .maybeSingle();
  return (data as { e2e_pub: string | null } | null)?.e2e_pub ?? null;
}

export type SendResult = 'ok' | 'no-key' | 'friend-no-key' | 'error';

export async function sendMessage(
  recipientId: string,
  kind: MessageKind,
  plaintext: string,
  replyTo: number | null = null,
): Promise<SendResult> {
  const user = await currentUser();
  if (!user) return 'error';
  // images/voice travel as data-urls — profanity filter/char cap apply to text
  // only (slicing a data-url corrupts the payload; the filter can mangle base64)
  const isSticker = /^\[sticker:\w+\]$/.test(plaintext);
  const body =
    kind === 'image' || kind === 'voice' || isSticker
      ? plaintext
      : cleanProfanity(plaintext).slice(0, MESSAGE_MAX_CHARS);
  const { error } = await supabase.from('messages').insert({
    sender: user.id,
    recipient: recipientId,
    kind,
    body,
    reply_to: replyTo,
  });
  return error ? 'error' : 'ok';
}

export async function listConversation(
  otherId: string,
  limit = 60,
): Promise<DecryptedMessage[]> {
  const user = await currentUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender.eq.${user.id},recipient.eq.${otherId}),and(sender.eq.${otherId},recipient.eq.${user.id})`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as MessageRow[]).reverse();

  // one round-trip for every reaction on the visible window
  const reactionMap = new Map<number, { emoji: string; count: number; mine: boolean }[]>();
  if (rows.length > 0) {
    const { data: reacts } = await supabase
      .from('message_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', rows.map((r) => r.id));
    const grouped = new Map<string, { count: number; mine: boolean }>();
    for (const r of (reacts ?? []) as { message_id: number; user_id: string; emoji: string }[]) {
      const key = `${r.message_id}:${r.emoji}`;
      const cur = grouped.get(key) ?? { count: 0, mine: false };
      cur.count++;
      if (r.user_id === user.id) cur.mine = true;
      grouped.set(key, cur);
    }
    for (const [key, v] of grouped) {
      const [idStr, emoji] = key.split(/:(.+)/);
      const id = Number(idStr);
      const list = reactionMap.get(id) ?? [];
      list.push({ emoji, count: v.count, mine: v.mine });
      reactionMap.set(id, list);
    }
  }

  return Promise.all(
    rows.map(async (r) => {
      const mine = r.sender === user.id;
      return {
        id: r.id,
        mine,
        kind: r.kind,
        text: await readBody(r, mine),
        reply_to: r.reply_to,
        edited_at: r.edited_at,
        read_at: r.read_at ?? null,
        reactions: reactionMap.get(r.id) ?? [],
        created_at: r.created_at,
      };
    }),
  );
}

/** Adds/removes my reaction (toggle). */
export async function toggleReaction(messageId: number, emoji: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  const { error } = await supabase
    .from('message_reactions')
    .insert({ message_id: messageId, user_id: user.id, emoji });
  if (error) {
    // unique violation = already reacted → remove it
    await supabase
      .from('message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
  }
}

export function subscribeReactions(onChange: () => void): () => void {
  const channel = supabase
    .channel('reactions-watch')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'message_reactions' },
      onChange,
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ---------- typing indicator (ephemeral, PRIVATE per-user inbox) ----------
// Old model was one world-readable broadcast channel: any signed-in account
// could watch who types to whom app-wide AND forge events. Now each user owns
// a private topic "ubox:<uuid>" (RLS on realtime.messages): only the owner
// can listen, only accepted friends/groupmates can send.

export interface TypingChannel {
  sendTyping: () => void;
  close: () => void;
}

/** Send-only handle: pushes my keystrokes into the FRIEND's private inbox. */
export function joinTyping(
  myId: string,
  otherId: string,
  _onTyping?: () => void,
): TypingChannel {
  const channel = supabase.channel(`ubox:${otherId}`, {
    config: { broadcast: { self: false }, private: true },
  });
  channel.subscribe();
  let last = 0;
  return {
    sendTyping: () => {
      const now = Date.now();
      if (now - last < 1500) return; // throttle keystrokes
      last = now;
      channel
        .send({ type: 'broadcast', event: 'typing', payload: { from: myId } })
        .catch(() => {});
    },
    close: () => {
      supabase.removeChannel(channel).catch(() => {});
    },
  };
}

/**
 * MY private inbox: fires with the sender whenever someone types to me.
 * DM keystrokes carry only `from`; group keystrokes also carry `group`, so
 * one inbox serves both indicators.
 */
export function subscribeTypingAll(
  myId: string,
  onTyping: (fromId: string, groupId?: number) => void,
): () => void {
  const channel = supabase.channel(`ubox:${myId}`, {
    config: { broadcast: { self: false }, private: true },
  });
  channel
    .on('broadcast', { event: 'typing' }, (p) => {
      const pay = p.payload as { from?: string; group?: number } | undefined;
      if (pay?.from) onTyping(pay.from, typeof pay.group === 'number' ? pay.group : undefined);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

/**
 * Group typing: fan my keystrokes into EVERY groupmate's private inbox,
 * tagged with the group id (RLS: groupmates may send to each other's ubox).
 */
export function joinGroupTyping(
  myId: string,
  groupId: number,
  memberIds: string[],
): TypingChannel {
  const channels = memberIds
    .filter((id) => id !== myId)
    .map((id) =>
      supabase.channel(`ubox:${id}`, {
        config: { broadcast: { self: false }, private: true },
      }),
    );
  for (const ch of channels) ch.subscribe();
  let last = 0;
  return {
    sendTyping: () => {
      const now = Date.now();
      if (now - last < 1500) return; // throttle keystrokes
      last = now;
      for (const ch of channels) {
        ch.send({
          type: 'broadcast',
          event: 'typing',
          payload: { from: myId, group: groupId },
        }).catch(() => {});
      }
    },
    close: () => {
      for (const ch of channels) supabase.removeChannel(ch).catch(() => {});
    },
  };
}

/**
 * Re-encrypts and replaces the body (author-only; the server rejects edits
 * older than 2 minutes via RLS). Marks the row as edited.
 */
export async function editMessage(
  m: DecryptedMessage,
  _recipientId: string,
  newText: string,
): Promise<SendResult> {
  const body = cleanProfanity(newText).slice(0, MESSAGE_MAX_CHARS);
  // legacy E2EE rows get converted to plaintext by the edit (ciphertext
  // columns cleared) — the 2-minute window means this basically never fires
  const { error } = await supabase
    .from('messages')
    .update({
      body,
      nonce: null,
      body_ct: null,
      edited_at: new Date().toISOString(),
    })
    .eq('id', m.id);
  return error ? 'error' : 'ok';
}

/** Author-only, removes for both sides (RLS-enforced). */
export async function deleteMessage(id: number): Promise<string | null> {
  const { error } = await supabase.from('messages').delete().eq('id', id);
  return error ? error.message : null;
}

/** Realtime pushes; RLS limits events to conversations I'm part of. */
export function subscribeMessages(
  onEvent: (row: MessageRow | null) => void,
): () => void {
  const channel = supabase
    .channel('messages-watch')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (payload) => {
      onEvent((payload.new as MessageRow | undefined) ?? null);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}

// ---------- unread tracking (purely local) ----------

const LAST_READ_KEY = 'chat-last-read';

function lastReadMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_READ_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function markConversationRead(friendId: string): void {
  const map = lastReadMap();
  map[friendId] = new Date().toISOString();
  localStorage.setItem(LAST_READ_KEY, JSON.stringify(map));
  // server-side read receipt (✓✓ for the sender) — trigger guards the stamp
  currentUser()
    .then((user) => {
      if (!user) return;
      return supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .eq('recipient', user.id)
        .eq('sender', friendId)
        .is('read_at', null);
    })
    .catch(() => {});
}

/** Newest message per conversation, decrypted (for the friend-list preview). */
export async function fetchLastMessages(): Promise<Map<string, LastMessage>> {
  const out = new Map<string, LastMessage>();
  const user = await currentUser();
  if (!user) return out;
  const { data } = await supabase
    .from('messages')
    .select('*')
    .or(`sender.eq.${user.id},recipient.eq.${user.id}`)
    .order('created_at', { ascending: false })
    .limit(150);
  const rows = (data ?? []) as MessageRow[];
  const tops = new Map<string, MessageRow>();
  for (const r of rows) {
    const other = r.sender === user.id ? r.recipient : r.sender;
    if (!tops.has(other)) tops.set(other, r); // rows are newest-first
  }
  await Promise.all(
    [...tops.entries()].map(async ([friendId, r]) => {
      const mine = r.sender === user.id;
      out.set(friendId, {
        friendId,
        mine,
        kind: r.kind,
        text: r.kind === 'text' ? await readBody(r, mine) : null,
        read_at: r.read_at ?? null,
        created_at: r.created_at,
      });
    }),
  );
  return out;
}

/** Count of messages from each friend newer than my local last-read stamp. */
export async function fetchUnreadCounts(): Promise<Record<string, number>> {
  const user = await currentUser();
  if (!user) return {};
  const map = lastReadMap();
  const { data } = await supabase
    .from('messages')
    .select('sender, created_at')
    .eq('recipient', user.id)
    .order('created_at', { ascending: false })
    .limit(300);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { sender: string; created_at: string }[]) {
    const seen = map[row.sender];
    if (!seen || row.created_at > seen) counts[row.sender] = (counts[row.sender] ?? 0) + 1;
  }
  return counts;
}
