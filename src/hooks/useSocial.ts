import { useCallback, useEffect, useRef, useState } from 'react';
import * as social from '../lib/social';
import type { FriendsState, PresenceRow } from '../lib/social';

export interface SocialHook {
  state: FriendsState | null;
  presence: Map<string, PresenceRow>;
  /** reload friendships + presence from the server */
  refresh: () => void;
  loading: boolean;
}

const EMPTY: Map<string, PresenceRow> = new Map();

/**
 * Friends + live presence, shared by the Friends tab and the sidebar.
 * Polls every 45s (friendships every 90s) and listens to realtime pushes;
 * completely inert while signed out.
 */
export function useSocial(signedIn: boolean, onError: (m: string) => void): SocialHook {
  const [state, setState] = useState<FriendsState | null>(null);
  const [presence, setPresence] = useState<Map<string, PresenceRow>>(EMPTY);
  const [loading, setLoading] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const refreshPresence = useCallback(async () => {
    const s = stateRef.current;
    if (!s?.me) return;
    const ids = [s.me.user_id, ...s.friends.map((f) => f.userId)];
    try {
      setPresence(await social.fetchPresence(ids));
    } catch {
      // transient network error — next poll wins
    }
  }, []);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    setLoading(true);
    social
      .loadFriendsState()
      .then((s) => {
        setState(s);
        stateRef.current = s;
        return refreshPresence();
      })
      .catch((err) => onError(String(err)))
      .finally(() => setLoading(false));
  }, [signedIn, onError, refreshPresence]);

  useEffect(() => {
    if (!signedIn) {
      setState(null);
      setPresence(EMPTY);
      return;
    }
    refresh();
    const presenceIv = window.setInterval(refreshPresence, 45_000);
    const friendsIv = window.setInterval(refresh, 90_000);
    const unsub = social.subscribePresence(refreshPresence);
    return () => {
      window.clearInterval(presenceIv);
      window.clearInterval(friendsIv);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  return { state, presence, refresh, loading };
}
