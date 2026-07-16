import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';

interface FriendsBarProps {
  social: SocialHook;
  onOpenFriends: () => void;
}

/** Fixed-width friends rail on the right edge — same width with or without friends. */
export function FriendsBar({ social: soc, onOpenFriends }: FriendsBarProps) {
  const state = soc.state;
  if (!state?.me) return null;

  return (
    <aside className="flex w-52 shrink-0 flex-col border-l border-border">
      <div className="flex items-center justify-between px-3.5 pb-1 pt-3">
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-text-dim">
          {t('fr.title')}
        </span>
        {state.incoming.length > 0 && (
          <button
            type="button"
            onClick={onOpenFriends}
            title={t('fr.inbox')}
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-extrabold text-bg"
          >
            {state.incoming.length}
          </button>
        )}
      </div>

      <div className="scrollbar-none min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-1">
        {state.friends.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
            <span className="text-2xl">👥</span>
            <span className="text-xs font-bold leading-relaxed text-text-faint">
              {t('fr.bar.empty')}
            </span>
          </div>
        ) : (
          state.friends.map((f) => {
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
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-hover"
              >
                <div className="relative shrink-0">
                  <div
                    className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 text-[11px] font-extrabold uppercase ${
                      live
                        ? 'border-accent text-accent'
                        : 'border-border-strong bg-surface text-text-dim'
                    }`}
                  >
                    {f.avatar ? (
                      <img src={f.avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      f.username.slice(0, 2)
                    )}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg ${
                      live ? 'animate-pulse-dot bg-accent' : 'bg-border-strong'
                    }`}
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-bold text-text">{f.username}</div>
                  <div
                    className={`truncate text-[10px] font-semibold ${
                      live ? 'text-accent' : 'text-text-faint'
                    }`}
                  >
                    {live
                      ? t('fr.focusing', formatDurationShort(focusSec))
                      : t('fr.offline')}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      <div className="p-2">
        <button
          type="button"
          onClick={onOpenFriends}
          className="chunk-btn w-full py-2 text-xs text-text"
        >
          + {t('fr.add.cta')}
        </button>
      </div>
    </aside>
  );
}
