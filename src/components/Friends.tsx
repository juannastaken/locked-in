import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { FriendEntry } from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';
import { Mascot } from './Mascot';

interface FriendsProps {
  signedIn: boolean;
  social: SocialHook;
  onError: (m: string) => void;
  /** start a session "together" with a friend that's focusing right now */
  onJoinFocus: (task: string) => void;
}

function Avatar({ name, live }: { name: string; live: boolean }) {
  return (
    <div className="relative">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border-2 border-border-strong bg-bg text-sm font-extrabold uppercase text-text">
        {name.slice(0, 2)}
      </div>
      <span
        className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-surface ${
          live ? 'animate-pulse-dot bg-accent' : 'bg-border-strong'
        }`}
      />
    </div>
  );
}

export function FriendsPage({ signedIn, social: soc, onError, onJoinFocus }: FriendsProps) {
  const [addName, setAddName] = useState('');
  const [addMsg, setAddMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [claimName, setClaimName] = useState('');
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState<number | null>(null);

  // live "focusing for Xh" durations tick without any network traffic
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ---- guest gate ----
  if (!signedIn) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Mascot mood="think" size={80} />
        <div>
          <h2 className="text-lg font-extrabold text-text">{t('fr.guest.title')}</h2>
          <p className="mx-auto mt-1 max-w-xs text-sm font-medium text-text-dim">
            {t('fr.guest.body')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem('guest-mode');
            window.location.reload();
          }}
          className="chunk-btn chunk-btn-accent px-6 py-3 text-sm"
        >
          {t('fr.guest.cta')}
        </button>
      </div>
    );
  }

  const state = soc.state;
  if (!state) {
    return (
      <div className="flex h-full items-center justify-center text-sm font-semibold text-text-faint">
        …
      </div>
    );
  }

  // ---- claim a username (account created before the social update) ----
  if (!state.me) {
    const valid = social.USERNAME_RE.test(claimName.trim());
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
          <Mascot mood="happy" size={72} />
          <h2 className="mt-3 text-lg font-extrabold text-text">{t('fr.claim.title')}</h2>
          <p className="mt-1 text-xs font-medium text-text-dim">{t('fr.claim.body')}</p>
          <input
            value={claimName}
            onChange={(e) => {
              setClaimName(e.target.value);
              setClaimErr(null);
            }}
            placeholder={t('fr.claim.placeholder')}
            autoFocus
            maxLength={20}
            onKeyDown={(e) => e.key === 'Enter' && valid && claim()}
            className="chunk-input mt-4 w-full px-4 py-3 text-center text-[15px] font-bold text-text placeholder:font-medium placeholder:text-text-faint"
          />
          <p className="mt-1.5 text-[11px] font-medium text-text-faint">{t('fr.claim.rules')}</p>
          {claimErr && <div className="mt-2 text-xs font-bold text-danger">{claimErr}</div>}
          <button
            type="button"
            disabled={busy || !valid}
            onClick={claim}
            className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
          >
            {busy ? '…' : t('fr.claim.cta')}
          </button>
        </div>
      </div>
    );
  }

  async function claim() {
    setBusy(true);
    setClaimErr(null);
    try {
      const r = await social.claimUsername(claimName);
      if (r === 'ok') {
        soc.refresh();
      } else if (r === 'taken') {
        setClaimErr(t('fr.err.taken'));
      } else if (r === 'invalid') {
        setClaimErr(t('fr.claim.rules'));
      } else {
        setClaimErr(t('fr.err.generic'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function addFriend() {
    const name = addName.trim();
    if (!name) return;
    setBusy(true);
    setAddMsg(null);
    try {
      const r = await social.sendFriendRequest(name);
      if (r === 'sent') {
        setAddMsg({ text: t('fr.add.sent', name.replace(/^@/, '')), ok: true });
        setAddName('');
        soc.refresh();
      } else if (r === 'notfound') {
        setAddMsg({ text: t('fr.err.notfound'), ok: false });
      } else if (r === 'self') {
        setAddMsg({ text: t('fr.err.self'), ok: false });
      } else if (r === 'duplicate') {
        setAddMsg({ text: t('fr.err.duplicate'), ok: false });
      } else {
        setAddMsg({ text: t('fr.err.generic'), ok: false });
      }
    } finally {
      setBusy(false);
    }
  }

  async function accept(f: FriendEntry) {
    const err = await social.acceptRequest(f.friendshipId);
    if (err) onError(err);
    soc.refresh();
  }

  async function removeEntry(f: FriendEntry, needsConfirm: boolean) {
    if (needsConfirm && confirmUnfriend !== f.friendshipId) {
      setConfirmUnfriend(f.friendshipId);
      window.setTimeout(
        () => setConfirmUnfriend((c) => (c === f.friendshipId ? null : c)),
        3000,
      );
      return;
    }
    setConfirmUnfriend(null);
    const err = await social.removeFriendship(f.friendshipId);
    if (err) onError(err);
    soc.refresh();
  }

  // ---- ranking: me + friends, this week only ----
  const wk = social.weekKey();
  const ranking = [
    { userId: state.me.user_id, username: state.me.username, isMe: true },
    ...state.friends.map((f) => ({ userId: f.userId, username: f.username, isMe: false })),
  ]
    .map((p) => {
      const row = soc.presence.get(p.userId);
      return { ...p, weekSec: row && row.week_key === wk ? row.week_sec : 0 };
    })
    .sort((a, b) => b.weekSec - a.weekSec);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 px-4 pb-10 pt-6 sm:px-6 xl:max-w-3xl">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-text">{t('fr.title')}</h1>
            <p className="mt-0.5 text-xs text-text-faint">
              {t('fr.you')} <span className="font-bold text-accent">@{state.me.username}</span>
            </p>
          </div>
        </div>

        {/* add friend */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addFriend();
          }}
          className="chunk flex gap-2 p-3"
        >
          <input
            value={addName}
            onChange={(e) => {
              setAddName(e.target.value);
              setAddMsg(null);
            }}
            placeholder={t('fr.add.placeholder')}
            maxLength={21}
            className="chunk-input min-w-0 flex-1 px-3 py-2.5 text-sm font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
          />
          <button
            type="submit"
            disabled={busy || !addName.trim()}
            className="chunk-btn chunk-btn-accent px-4 py-2.5 text-[13px]"
          >
            {t('fr.add.cta')}
          </button>
        </form>
        {addMsg && (
          <div
            className={`-mt-2 px-1 text-xs font-bold ${addMsg.ok ? 'text-accent' : 'text-danger'}`}
          >
            {addMsg.text}
          </div>
        )}

        {/* incoming requests — the inbox */}
        {state.incoming.length > 0 && (
          <div className="chunk space-y-2 p-4">
            <div className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.inbox')} <span className="text-accent">({state.incoming.length})</span>
            </div>
            {state.incoming.map((f) => (
              <div key={f.friendshipId} className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={f.username} live={false} />
                  <span className="truncate text-sm font-bold text-text">@{f.username}</span>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => accept(f)}
                    className="chunk-btn chunk-btn-accent px-3.5 py-1.5 text-xs"
                  >
                    {t('fr.accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEntry(f, false)}
                    className="chunk-btn px-3 py-1.5 text-xs text-text-dim"
                  >
                    {t('fr.reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* outgoing requests */}
        {state.outgoing.length > 0 && (
          <div className="chunk space-y-2 p-4">
            <div className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.outgoing')}
            </div>
            {state.outgoing.map((f) => (
              <div key={f.friendshipId} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-text-dim">@{f.username}</span>
                <button
                  type="button"
                  onClick={() => removeEntry(f, false)}
                  className="text-xs font-bold text-text-faint hover:text-danger"
                >
                  {t('fr.cancel')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* friends list with live presence */}
        <div className="chunk space-y-3 p-4">
          <div className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
            {t('fr.friends')} ({state.friends.length})
          </div>
          {state.friends.length === 0 && (
            <div className="flex flex-col items-center gap-1 py-6 text-center">
              <span className="text-2xl">👥</span>
              <span className="text-sm font-semibold text-text-faint">{t('fr.empty')}</span>
            </div>
          )}
          {state.friends.map((f) => {
            const row = soc.presence.get(f.userId);
            const live = social.isLive(row);
            const focusSec =
              live && row?.started_at
                ? Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000)
                : 0;
            return (
              <div key={f.friendshipId} className="group flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={f.username} live={live} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-text">@{f.username}</div>
                    <div className="truncate text-[11px] font-medium text-text-dim">
                      {live ? (
                        <span className="text-accent">
                          {t('fr.focusing', formatDurationShort(focusSec))}
                          {row?.task ? ` · ${row.task}` : ''}
                        </span>
                      ) : (
                        t('fr.offline')
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {live && (
                    <button
                      type="button"
                      onClick={() => onJoinFocus(row?.task || `@${f.username}`)}
                      className="chunk-btn chunk-btn-accent px-3 py-1.5 text-xs"
                      title={t('fr.join.title')}
                    >
                      {t('fr.join')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeEntry(f, true)}
                    className={`rounded-md px-2 py-1 text-[11px] transition-opacity ${
                      confirmUnfriend === f.friendshipId
                        ? 'bg-danger/15 font-bold text-danger opacity-100'
                        : 'text-text-faint opacity-0 hover:text-danger group-hover:opacity-100'
                    }`}
                  >
                    {confirmUnfriend === f.friendshipId ? t('misc.sure') : '✕'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* weekly ranking */}
        {state.friends.length > 0 && (
          <div className="chunk space-y-2.5 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
                {t('fr.ranking')}
              </span>
              <span className="text-[11px] font-medium text-text-faint">{t('fr.week')}</span>
            </div>
            {ranking.map((p, i) => {
              const max = ranking[0].weekSec || 1;
              return (
                <div key={p.userId} className="flex items-center gap-2.5">
                  <span className="w-6 text-center text-sm">
                    {medals[i] ?? <span className="text-xs font-bold text-text-faint">{i + 1}</span>}
                  </span>
                  <span
                    className={`w-28 truncate text-sm font-bold ${p.isMe ? 'text-accent' : 'text-text'}`}
                  >
                    {p.isMe ? t('fr.me') : `@${p.username}`}
                  </span>
                  <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-border-strong bg-bg">
                    <div
                      className="h-full bg-accent"
                      style={{
                        width: `${(p.weekSec / max) * 100}%`,
                        transition: 'width 600ms cubic-bezier(0.16,1,0.3,1)',
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-text-dim">
                    {formatDurationShort(p.weekSec)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
