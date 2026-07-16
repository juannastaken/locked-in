import { useCallback, useEffect, useState } from 'react';
import * as groups from '../lib/groups';
import type { GroupSummary } from '../lib/groups';

export interface GroupsHook {
  list: GroupSummary[];
  loading: boolean;
  refresh: () => void;
  /** bumped on any realtime group change — open views refetch messages */
  tick: number;
}

/** My groups + realtime; inert while signed out. */
export function useGroups(signedIn: boolean, onError: (m: string) => void): GroupsHook {
  const [list, setList] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    setLoading(true);
    groups
      .listMyGroups()
      .then(setList)
      .catch((err) => {
        if (!/schema cache|does not exist/i.test(String(err))) onError(String(err));
      })
      .finally(() => setLoading(false));
  }, [signedIn, onError]);

  useEffect(() => {
    if (!signedIn) {
      setList([]);
      return;
    }
    refresh();
    let debounce: number | null = null;
    const unsub = groups.subscribeGroups(() => {
      setTick((k) => k + 1);
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, 300);
    });
    const iv = window.setInterval(refresh, 90_000);
    return () => {
      unsub();
      window.clearInterval(iv);
      if (debounce) window.clearTimeout(debounce);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  return { list, loading, refresh, tick };
}
