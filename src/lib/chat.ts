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
  created_at: string;
}

export interface DecryptedMessage {
  id: number;
  mine: boolean;
  kind: 'text' | 'jam';
  /** null = this device's key can't open it (rotated/missing key) */
  text: string | null;
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
  return Promise.all(
    rows.map(async (r) => {
      const mine = r.sender === user.id;
      return {
        id: r.id,
        mine,
        kind: r.kind,
        text: await e2e.decryptRow(r, mine),
        created_at: r.created_at,
      };
    }),
  );
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
