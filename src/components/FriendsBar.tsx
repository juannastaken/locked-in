import { useState } from 'react';
import { t } from '../lib/i18n';
import * as social from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';
import { sortFriendsByStatus, statusDot, statusLineFor, statusText } from './Friends';
import { ChatIcon } from './Icons';
import { Mascot } from './Mascot';

export interface JamMemberView {
  username: string;
  avatar: string | null;
  isMe: boolean;
}

interface FriendsBarProps {
  social: SocialHook;
  onOpenFriends: () => void;
  onOpenChat: (friendUserId: string) => void;
  unread: Record<string, number>;
  /** friend userIds typing to me right now */
  typingIds: Set<string>;
  /** members of MY running jam (me included), null when not in a jam */
  jamMembers: JamMemberView[] | null;
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
export function FriendsBar({
  social: soc,
  onOpenFriends,
  onOpenChat,
  unread,
  typingIds,
  jamMembers,
}: FriendsBarProps) {
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
  const anyUnread = Object.values(unread).some((n) => n > 0);

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
          {(anyLive || anyUnread || state.incoming.length > 0) && (
            <span
              className={`absolute -top-0.5 right-0 h-2 w-2 rounded-full ${
                anyUnread || state.incoming.length > 0
                  ? 'bg-warn'
                  : 'animate-pulse-dot bg-accent'
              }`}
            />
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-border">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
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

      {/* my running jam — everyone in it, pinned on top */}
      {jamMembers && jamMembers.length > 0 && (
        <div className="mx-2 mb-1 rounded-xl border-2 border-accent bg-accent-dim p-2.5">
          <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-wide text-accent">
            🎧 {t('jam.participants')}
          </div>
          <div className="space-y-1.5">
            {jamMembers.map((m) => (
              <div key={m.username} className="flex items-center gap-2">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-accent bg-bg text-[10px] font-extrabold uppercase text-accent">
                  {m.avatar ? (
                    <img src={m.avatar} alt="" className="h-full w-full object-cover" />
                  ) : (
                    m.username.slice(0, 2)
                  )}
                </div>
                <span className="truncate text-xs font-bold text-text">
                  {m.isMe ? t('fr.me') : `@${m.username}`}
                </span>
                <span className="ml-auto h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-accent" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="scrollbar-none min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-1">
        {state.friends.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2.5 px-3 text-center">
            <Mascot mood="think" size={48} />
            <span className="text-xs font-bold leading-relaxed text-text-faint">
              {t('fr.bar.empty')}
            </span>
          </div>
        ) : (
          sortFriendsByStatus(state.friends, soc.statusOf).map((f) => {
            const row = soc.presence.get(f.userId);
            const status = soc.statusOf(f.userId);
            const live = status === 'focusing';
            return (
              <div
                key={f.friendshipId}
                role="button"
                tabIndex={0}
                onClick={() => onOpenFriends()}
                onKeyDown={(e) => e.key === 'Enter' && onOpenFriends()}
                className="group cursor-pointer rounded-xl px-2 py-2 hover:bg-surface-hover"
              >
                <div className="flex items-center gap-2.5">
                  <div className="relative shrink-0">
                    <div
                      className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border-2 text-[11px] font-extrabold uppercase ${
                        live
                          ? 'border-accent text-accent'
                          : status === 'online'
                            ? 'border-sky-400 text-sky-400'
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
                      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg ${statusDot(status)}`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-bold text-text">{f.username}</div>
                    <div className={`truncate text-[10px] font-semibold ${statusText(status)}`}>
                      {typingIds.has(f.userId) ? (
                        <span className="italic text-accent">{t('msg.typing')}</span>
                      ) : (
                        statusLineFor(status, row, f.statusText, f.username)
                      )}
                    </div>
                  </div>
                  {(unread[f.userId] ?? 0) > 0 && (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-extrabold text-bg">
                      {unread[f.userId]}
                    </span>
                  )}
                </div>
                {/* square MESSAGE button — slides in smoothly on hover */}
                <div className={(unread[f.userId] ?? 0) > 0 ? 'reveal-open reveal' : 'reveal'}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenChat(f.userId);
                    }}
                    className="chunk-btn mt-1.5 flex w-full items-center justify-center gap-1.5 py-1.5 text-[11px] text-text"
                  >
                    <ChatIcon size={13} /> {t('msg.open').toUpperCase()}
                  </button>
                </div>
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
