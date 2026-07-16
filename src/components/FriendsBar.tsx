import { useState } from 'react';
import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';
import { Mascot } from './Mascot';

interface FriendsBarProps {
  social: SocialHook;
  onOpenFriends: () => void;
  onOpenChat: (friendUserId: string) => void;
  unread: Record<string, number>;
}

function Chevron({ left }: { left: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: left ? 'rotate(180deg)' : undefined }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

/** Fixed-width friends rail on the right edge — same width with or without friends. */
export function FriendsBar({ social: soc, onOpenFriends, onOpenChat, unread }: FriendsBarProps) {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('friends-bar-collapsed') === '1',
  );
  const state = soc.state;
  if (!state?.me) return null;

  function toggle() {
    const next = !collapsed;
    localStorage.setItem('friends-bar-collapsed', next ? '1' : '0');
    setCollapsed(next);
  }

  const anyLive = state.friends.some((f) => social.isLive(soc.presence.get(f.userId)));

  // collapsed: a slim strip with just the expand handle (+ signals on it)
  if (collapsed) {
    return (
      <aside className="flex w-7 shrink-0 flex-col items-center border-l border-border pt-2">
        <button
          type="button"
          onClick={toggle}
          title={t('fr.bar.expand')}
          className="relative flex h-9 w-5 items-center justify-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
        >
          <Chevron left />
          {(anyLive || state.incoming.length > 0) && (
            <span
              className={`absolute -top-0.5 right-0 h-2 w-2 rounded-full ${
                state.incoming.length > 0 ? 'bg-warn' : 'animate-pulse-dot bg-accent'
              }`}
            />
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col border-l border-border">
      <div className="flex items-center justify-between px-2.5 pb-1 pt-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggle}
            title={t('fr.bar.collapse')}
            className="flex h-5 w-5 items-center justify-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
          >
            <Chevron left={false} />
          </button>
          <span className="text-[11px] font-extrabold uppercase tracking-wide text-text-dim">
            {t('fr.title')}
          </span>
        </div>
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
          <div className="flex h-full flex-col items-center justify-center gap-2.5 px-3 text-center">
            <Mascot mood="think" size={48} />
            <span className="text-xs font-bold leading-relaxed text-text-faint">
              {t('fr.bar.empty')}
            </span>
          </div>
        ) : (
          state.friends.map((f) => {
            const row = soc.presence.get(f.userId);
            const status = social.friendStatus(row);
            const live = status === 'focusing';
            const focusSec =
              live && row?.started_at
                ? Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000)
                : 0;
            return (
              <div
                key={f.friendshipId}
                role="button"
                tabIndex={0}
                onClick={onOpenFriends}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFriends()}
                className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-surface-hover"
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
                      live
                        ? 'animate-pulse-dot bg-accent'
                        : status === 'online'
                          ? 'bg-accent'
                          : 'bg-border-strong'
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-bold text-text">{f.username}</div>
                  <div
                    className={`truncate text-[10px] font-semibold ${
                      live
                        ? 'text-accent'
                        : status === 'online'
                          ? 'text-accent/70'
                          : 'text-text-faint'
                    }`}
                  >
                    {live
                      ? t('fr.focusing', formatDurationShort(focusSec))
                      : status === 'online'
                        ? t('fr.online')
                        : t('fr.offline')}
                  </div>
                </div>
                {(unread[f.userId] ?? 0) > 0 ? (
                  <button
                    type="button"
                    title={t('msg.open')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenChat(f.userId);
                    }}
                    className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-extrabold text-bg"
                  >
                    {unread[f.userId]}
                  </button>
                ) : (
                  <button
                    type="button"
                    title={t('msg.open')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenChat(f.userId);
                    }}
                    className="shrink-0 rounded-lg px-1 text-sm opacity-0 transition-opacity hover:bg-bg group-hover:opacity-100"
                  >
                    💬
                  </button>
                )}
              </div>
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
