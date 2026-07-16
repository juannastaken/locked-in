// E2E-encrypted 1:1 messages between accepted friends (see e2e.ts for the
// crypto; supabase/social.sql for the RLS that keeps strangers out).

import { currentUser, supabase } from './cloud';
import * as e2e from './e2e';

export interface MessageRow {
  id: number;
  sender: string;
  recipient: string;
  kind: 'text' | 'jam';
  nonce: string;
  body_ct: string;
  sender_pub: string;
  recipient_pub: string;
  reply_to: number | null;
  created_at: string;
}

export interface DecryptedMessage {
  id: number;
  mine: boolean;
  kind: 'text' | 'jam';
  /** null = this device's key can't open it (rotated/missing key) */
  text: string | null;
  reply_to: number | null;
  /** emoji → users who reacted ('me' aware via mine flag on caller side) */
  reactions: { emoji: string; count: number; mine: boolean }[];
  created_at: string;
}

export const MESSAGE_MAX_CHARS = 2000;

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
  kind: 'text' | 'jam',
  plaintext: string,
  replyTo: number | null = null,
): Promise<SendResult> {
  const user = await currentUser();
  if (!user) return 'error';
  const body = plaintext.slice(0, MESSAGE_MAX_CHARS);
  const theirPub = await fetchFriendPub(recipientId);
  if (!theirPub) return 'friend-no-key';
  const env = await e2e.encryptTo(body, theirPub);
  if (!env) return 'no-key';
  const { error } = await supabase.from('messages').insert({
    sender: user.id,
    recipient: recipientId,
    kind,
    nonce: env.nonce,
    body_ct: env.bodyCt,
    sender_pub: env.senderPub,
    recipient_pub: env.recipientPub,
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
        text: await e2e.decryptRow(r, mine),
        reply_to: r.reply_to,
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

// ---------- typing indicator (ephemeral broadcast, nothing stored) ----------

function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':');
}

export interface TypingChannel {
  sendTyping: () => void;
  close: () => void;
}

/** Joins the per-conversation typing channel; onTyping fires on peer keystrokes. */
export function joinTyping(
  myId: string,
  otherId: string,
  onTyping: () => void,
): TypingChannel {
  const channel = supabase.channel(`typing:${pairKey(myId, otherId)}`, {
    config: { broadcast: { self: false } },
  });
  channel
    .on('broadcast', { event: 'typing' }, (p) => {
      if ((p.payload as { user?: string })?.user !== myId) onTyping();
    })
    .subscribe();
  let last = 0;
  return {
    sendTyping: () => {
      const now = Date.now();
      if (now - last < 1500) return; // throttle keystrokes
      last = now;
      channel.send({ type: 'broadcast', event: 'typing', payload: { user: myId } }).catch(() => {});
    },
    close: () => {
      supabase.removeChannel(channel).catch(() => {});
    },
  };
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
