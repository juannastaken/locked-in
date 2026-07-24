import { useCallback, useEffect, useRef, useState } from 'react';
import * as social from '../lib/social';
import type { JamInvite } from '../lib/social';

export interface JamPrompt extends JamInvite {
  username: string;
  avatar: string | null;
}

export interface JamEvents {
  /** when true, incoming invites are auto-declined silently (anti-flood) */
  blockIncoming?: () => boolean;
  /** an invite/request addressed to ME arrived (show the fullscreen prompt) */
  onPrompt?: (p: JamPrompt) => void;
  /** a 'request' I sent was accepted — I should join the host's jam now */
  onJoinApproved?: (invite: JamInvite, hostUsername: string) => void;
  /** an 'invite' I sent was accepted — the friend joined MY jam */
  onGuestJoined?: (invite: JamInvite, guestUsername: string) => void;
  onDeclined?: (username: string) => void;
  /** an invite I sent expired unanswered (they were offline / never saw it) */
  onExpired?: (username: string) => void;
}

export interface JamHook {
  prompt: JamPrompt | null;
  clearPrompt: () => void;
  answer: (accept: boolean) => Promise<JamPrompt | null>;
  cancelSent: () => void;
  send: (
    toUserId: string,
    toUsername: string,
    kind: 'invite' | 'request',
    task: string,
    sessionStartedAt: string,
  ) => Promise<string | null>;
}

/**
 * Jam invite plumbing: watches realtime for invites addressed to me and for
 * answers to invites I sent. Names/avatars come from the friends state the
 * caller already holds.
 */
export function useJam(
  signedIn: boolean,
  lookup: (userId: string) => { username: string; avatar: string | null },
  events: JamEvents,
): JamHook {
  const [prompt, setPrompt] = useState<JamPrompt | null>(null);
  const promptRef = useRef(prompt);
  promptRef.current = prompt;
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const lookupRef = useRef(lookup);
  lookupRef.current = lookup;
  // invites I sent and still care about: id → username of the other side
  const sentRef = useRef(new Map<number, { username: string; kind: 'invite' | 'request' }>());
  const promptedIdsRef = useRef(new Set<number>());

  const checkIncoming = useCallback(async () => {
    const pending = await social.fetchPendingJamInvites();
    // jams blocked → decline everything pending, never prompt
    if (eventsRef.current.blockIncoming?.()) {
      for (const i of pending) {
        if (promptedIdsRef.current.has(i.id)) continue;
        promptedIdsRef.current.add(i.id);
        social.answerJamInvite(i.id, false).catch(() => {});
      }
      return;
    }
    const fresh = pending.find((i) => !promptedIdsRef.current.has(i.id));
    if (!fresh || promptRef.current) return;
    let who = lookupRef.current(fresh.from_user);
    if (who.username === '???') {
      // friends state not loaded yet (invite landed while the app was booting)
      // — resolve from the server; on failure retry on the next poke rather
      // than ever showing "@???" in the prompt/roster
      const prof = await social.fetchProfileById(fresh.from_user).catch(() => null);
      if (!prof) return;
      who = { username: prof.username, avatar: prof.avatar_b64 ?? null };
    }
    promptedIdsRef.current.add(fresh.id);
    const p: JamPrompt = { ...fresh, username: who.username, avatar: who.avatar };
    setPrompt(p);
    eventsRef.current.onPrompt?.(p);
  }, []);

  const checkSent = useCallback(async () => {
    for (const [id, meta] of [...sentRef.current]) {
      const row = await social.fetchJamInvite(id);
      if (!row) {
        sentRef.current.delete(id);
        continue;
      }
      if (row.status === 'accepted') {
        sentRef.current.delete(id);
        if (meta.kind === 'request') eventsRef.current.onJoinApproved?.(row, meta.username);
        else eventsRef.current.onGuestJoined?.(row, meta.username);
      } else if (row.status === 'declined') {
        sentRef.current.delete(id);
        eventsRef.current.onDeclined?.(meta.username);
      } else if (!social.jamInviteFresh(row)) {
        sentRef.current.delete(id);
        social.cancelJamInvite(id).catch(() => {});
        // sender feedback — before this, an invite to someone offline just
        // evaporated ("sent" toast, then eternal silence)
        eventsRef.current.onExpired?.(meta.username);
      }
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    const poke = () => {
      checkIncoming().catch(() => {});
      checkSent().catch(() => {});
    };
    poke();
    const unsub = social.subscribeJamInvites(poke);
    const iv = window.setInterval(poke, 20_000); // backstop if realtime hiccups
    return () => {
      unsub();
      window.clearInterval(iv);
    };
  }, [signedIn, checkIncoming, checkSent]);

  const answer = useCallback(async (accept: boolean) => {
    const p = promptRef.current;
    if (!p) return null;
    setPrompt(null);
    const err = await social.answerJamInvite(p.id, accept);
    if (err) return null;
    // an update matching 0 rows (host cancelled / row expired+deleted) returns
    // NO error — verify the flip actually happened, otherwise accepting would
    // adopt a ghost jam the other side never sees
    const row = await social.fetchJamInvite(p.id).catch(() => null);
    if (!row || row.status !== (accept ? 'accepted' : 'declined')) return null;
    return p;
  }, []);

  /** Cancels every invite I sent that's still pending — called when my jam
   *  fills up (1:1 = 2 people) or my session ends, so a late "accept" can't
   *  spawn a ghost jam. */
  const cancelSent = useCallback(() => {
    for (const [id] of [...sentRef.current]) {
      sentRef.current.delete(id);
      social.cancelJamInvite(id).catch(() => {});
    }
  }, []);

  const send = useCallback(
    async (
      toUserId: string,
      toUsername: string,
      kind: 'invite' | 'request',
      task: string,
      sessionStartedAt: string,
    ) => {
      const r = await social.sendJamInvite(toUserId, kind, task, sessionStartedAt);
      if ('error' in r) return r.error;
      sentRef.current.set(r.id, { username: toUsername, kind });
      return null;
    },
    [],
  );

  return { prompt, clearPrompt: () => setPrompt(null), answer, send, cancelSent };
}
