import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';

interface FriendsBarProps {
  social: SocialHook;
  onOpenFriends: () => void;
}

/** Slim always-visible friends rail on the right edge (Discord style). */
export function FriendsBar({ social: soc, onOpenFriends }: FriendsBarProps) {
  const state = soc.state;
  if (!state?.me) return null;

  return (
    <aside className="scrollbar-none flex w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-l border-border py-3">
      {state.friends.map((f) => {
        const row = soc.presence.get(f.userId);
        const live = social.isLive(row);
        const focusSec =
          live && row?.started_at
            ? Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000)
            : 0;
        return (
          <button
            key={f.friendshipId}
            type="button"
            onClick={onOpenFriends}
            title={
              live
                ? `@${f.username} · ${t('fr.focusing', formatDurationShort(focusSec))}${row?.task ? ` · ${row.task}` : ''}`
                : `@${f.username} · ${t('fr.offline')}`
            }
            className="relative shrink-0"
          >
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl border-2 text-xs font-extrabold uppercase transition-colors ${
                live
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-strong bg-surface text-text-dim hover:text-text'
              }`}
            >
              {f.username.slice(0, 2)}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg ${
                live ? 'animate-pulse-dot bg-accent' : 'bg-border-strong'
              }`}
            />
          </button>
        );
      })}

      {state.incoming.length > 0 && (
        <button
          type="button"
          onClick={onOpenFriends}
          title={t('fr.inbox')}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-warn bg-warn/10 text-xs font-extrabold text-warn"
        >
          {state.incoming.length}
        </button>
      )}

      <button
        type="button"
        onClick={onOpenFriends}
        title={t('fr.title')}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 border-dashed border-border-strong text-sm text-text-faint hover:border-accent hover:text-accent"
      >
        +
      </button>
    </aside>
  );
}
