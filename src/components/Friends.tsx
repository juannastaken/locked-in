import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { FriendEntry } from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';
import { Mascot } from './Mascot';

export interface MyFocusState {
  focusing: boolean;
  task: string | null;
  startedAtIso: string | null;
}

interface FriendsProps {
  signedIn: boolean;
  social: SocialHook;
  onError: (m: string) => void;
  myFocus: MyFocusState;
  /** send a jam invite ('invite' = join MY jam) or request ('request' = let me join THEIRS) */
  onSendJam: (f: FriendEntry, kind: 'invite' | 'request') => Promise<void>;
}

/** Username claim form — used by the Friends tab and the mandatory app modal. */
export function ClaimUsernameForm({ onClaimed }: { onClaimed: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = social.USERNAME_RE.test(name.trim().replace(/^@/, ''));

  async function claim() {
    setBusy(true);
    setErr(null);
    try {
      const r = await social.claimUsername(name.trim().replace(/^@/, ''));
      if (r === 'ok') onClaimed();
      else if (r === 'taken') setErr(t('fr.err.taken'));
      else if (r === 'invalid') setErr(t('fr.claim.rules'));
      else setErr(t('fr.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setErr(null);
        }}
        placeholder={t('fr.claim.placeholder')}
        autoFocus
        maxLength={21}
        onKeyDown={(e) => e.key === 'Enter' && valid && !busy && claim()}
        className="chunk-input mt-4 w-full px-4 py-3 text-center text-[15px] font-bold text-text placeholder:font-medium placeholder:text-text-faint"
      />
      <p className="mt-1.5 text-[11px] font-medium text-text-faint">{t('fr.claim.rules')}</p>
      {err && <div className="mt-2 text-xs font-bold text-danger">{err}</div>}
      <button
        type="button"
        disabled={busy || !valid}
        onClick={claim}
        className="chunk-btn chunk-btn-accent mt-4 w-full py-3 text-sm"
      >
        {busy ? '…' : t('fr.claim.cta')}
      </button>
    </>
  );
}

function Avatar({
  name,
  live,
  photo,
  size = 'h-10 w-10',
}: {
  name: string;
  live: boolean;
  photo?: string | null;
  size?: string;
}) {
  return (
    <div className="relative">
      <div
        className={`flex ${size} items-center justify-center overflow-hidden rounded-xl border-2 border-border-strong bg-bg text-sm font-extrabold uppercase text-text`}
      >
        {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : name.slice(0, 2)}
      </div>
      <span
        className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-surface ${
          live ? 'animate-pulse-dot bg-accent' : 'bg-border-strong'
        }`}
      />
    </div>
  );
}

/** Full friend profile: photo, status, week hours, jam + unfriend actions. */
function FriendProfile({
  friend,
  soc,
  myFocus,
  onSendJam,
  onError,
  onBack,
}: {
  friend: FriendEntry;
  soc: SocialHook;
  myFocus: MyFocusState;
  onSendJam: FriendsProps['onSendJam'];
  onError: (m: string) => void;
  onBack: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jamSent, setJamSent] = useState(false);

  const row = soc.presence.get(friend.userId);
  const live = social.isLive(row);
  const focusSec =
    live && row?.started_at
      ? Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000)
      : 0;
  const wk = social.weekKey();
  const weekSec = row && row.week_key === wk ? row.week_sec : 0;

  async function sendJam(kind: 'invite' | 'request') {
    setBusy(true);
    try {
      await onSendJam(friend, kind);
      setJamSent(true);
      window.setTimeout(() => setJamSent(false), 4000);
    } finally {
      setBusy(false);
    }
  }

  async function unfriend() {
    setBusy(true);
    try {
      const err = await social.removeFriendship(friend.friendshipId);
      if (err) onError(err);
      soc.refresh();
      onBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 px-4 pb-10 pt-6 sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-bold text-text-dim hover:text-text"
      >
        ← {t('fr.title')}
      </button>

      <div className="chunk flex items-center gap-4 p-5">
        <div className="relative shrink-0">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-4 border-border-strong bg-bg text-xl font-extrabold uppercase text-text">
            {friend.avatar ? (
              <img src={friend.avatar} alt="" className="h-full w-full object-cover" />
            ) : (
              friend.username.slice(0, 2)
            )}
          </div>
          <span
            className={`absolute bottom-0 right-0 h-5 w-5 rounded-full border-4 border-surface ${
              live ? 'animate-pulse-dot bg-accent' : 'bg-border-strong'
            }`}
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xl font-extrabold text-text">@{friend.username}</div>
          <div className={`mt-0.5 text-sm font-semibold ${live ? 'text-accent' : 'text-text-faint'}`}>
            {live
              ? `${t('fr.focusing', formatDurationShort(focusSec))}${row?.task ? ` · ${row.task}` : ''}`
              : t('fr.offline')}
          </div>
          <div className="mt-1 text-xs font-medium text-text-dim">
            {t('fr.profile.week', formatDurationShort(weekSec))}
          </div>
        </div>
      </div>

      {/* jam actions */}
      <div className="space-y-2">
        {live && !myFocus.focusing && (
          <button
            type="button"
            disabled={busy || jamSent}
            onClick={() => sendJam('request')}
            className="chunk-btn chunk-btn-accent w-full py-3 text-sm"
          >
            {jamSent ? t('jam.sent') : `🎧 ${t('jam.request')}`}
          </button>
        )}
        {myFocus.focusing && (
          <button
            type="button"
            disabled={busy || jamSent}
            onClick={() => sendJam('invite')}
            className="chunk-btn chunk-btn-accent w-full py-3 text-sm"
          >
            {jamSent ? t('jam.sent') : `🎧 ${t('jam.invite')}`}
          </button>
        )}
        {!live && !myFocus.focusing && (
          <div className="chunk px-4 py-3 text-center text-xs font-semibold text-text-faint">
            {t('jam.none')}
          </div>
        )}
      </div>

      {/* unfriend — a real confirmation, not a hidden ✕ */}
      {!confirmRemove ? (
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          className="chunk-btn w-full py-3 text-sm text-danger"
        >
          {t('fr.unfriend')}
        </button>
      ) : (
        <div className="chunk space-y-3 border-danger/60 p-4">
          <p className="text-center text-sm font-bold text-text">
            {t('fr.unfriend.confirm', friend.username)}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={unfriend}
              className="chunk-btn flex-1 bg-danger py-2.5 text-sm font-extrabold text-white"
            >
              {busy ? '…' : t('fr.unfriend.yes')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRemove(false)}
              className="chunk-btn flex-1 py-2.5 text-sm text-text"
            >
              {t('misc.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FriendsPage({ signedIn, social: soc, onError, myFocus, onSendJam }: FriendsProps) {
  const [addName, setAddName] = useState('');
  const [addMsg, setAddMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<FriendEntry | null>(null);

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
      <div className="flex h-full items-center justify-center">
        <span className="skeleton h-6 w-40">.</span>
      </div>
    );
  }

  // ---- claim a username (account created before the social update) ----
  if (!state.me) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="chunk animate-scale-in w-full max-w-sm p-6 text-center">
          <Mascot mood="happy" size={72} />
          <h2 className="mt-3 text-lg font-extrabold text-text">{t('fr.claim.title')}</h2>
          <p className="mt-1 text-xs font-medium text-text-dim">{t('fr.claim.body')}</p>
          <ClaimUsernameForm onClaimed={soc.refresh} />
        </div>
      </div>
    );
  }

  // ---- friend profile subview ----
  if (viewing) {
    const fresh = state.friends.find((f) => f.friendshipId === viewing.friendshipId);
    if (!fresh) {
      // unfriended / gone — fall back to the list
      setViewing(null);
    } else {
      return (
        <div className="h-full overflow-y-auto">
          <FriendProfile
            friend={fresh}
            soc={soc}
            myFocus={myFocus}
            onSendJam={onSendJam}
            onError={onError}
            onBack={() => setViewing(null)}
          />
        </div>
      );
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

  async function removePending(f: FriendEntry) {
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
                  <Avatar name={f.username} live={false} photo={f.avatar} />
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
                    onClick={() => removePending(f)}
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
                  onClick={() => removePending(f)}
                  className="text-xs font-bold text-text-faint hover:text-danger"
                >
                  {t('fr.cancel')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* friends list — click a row to open the friend's profile */}
        <div className="chunk space-y-1 p-3">
          <div className="px-1 pb-1 text-xs font-extrabold uppercase tracking-wide text-text-dim">
            {t('fr.friends')} ({state.friends.length})
          </div>
          {state.friends.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Mascot mood="think" size={52} />
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
              <button
                key={f.friendshipId}
                type="button"
                onClick={() => setViewing(f)}
                className="flex w-full items-center justify-between gap-2 rounded-xl px-2 py-2 text-left hover:bg-surface-hover"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={f.username} live={live} photo={f.avatar} />
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
                <span className="shrink-0 text-xs font-bold text-text-faint">
                  {t('fr.viewprofile')} →
                </span>
              </button>
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
