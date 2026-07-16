import { useEffect, useState } from 'react';
import { t } from '../lib/i18n';
import { formatDurationShort } from '../lib/time';
import * as social from '../lib/social';
import type { FriendEntry, PresenceRow } from '../lib/social';
import type { SocialHook } from '../hooks/useSocial';
import { ChatView } from './Chat';
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
  /** 'invite' = come into MY jam (cold-start allowed); 'request' = let me join yours */
  onSendJam: (f: FriendEntry, kind: 'invite' | 'request') => Promise<void>;
  unread: Record<string, number>;
  chatRefetchKey: number;
  onChatOpened: (friendUserId: string | null) => void;
  openChatWith: string | null;
  onOpenChatConsumed: () => void;
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

export function statusDot(status: social.FriendStatus): string {
  if (status === 'focusing') return 'animate-pulse-dot bg-accent';
  if (status === 'online') return 'bg-sky-400';
  return 'bg-border-strong';
}

export function statusText(status: social.FriendStatus): string {
  if (status === 'focusing') return 'text-accent';
  if (status === 'online') return 'text-sky-400';
  return 'text-text-faint';
}

export function statusLineFor(status: social.FriendStatus, row: PresenceRow | undefined): string {
  if (status === 'focusing') {
    const sec = row?.started_at
      ? Math.max(0, (Date.now() - new Date(row.started_at).getTime()) / 1000)
      : 0;
    return `${t('fr.focusing', formatDurationShort(sec))}${row?.task ? ` · ${row.task}` : ''}`;
  }
  return status === 'online' ? t('fr.online') : t('fr.offline');
}

function Avatar({
  name,
  status,
  photo,
  size = 'h-10 w-10',
}: {
  name: string;
  status: social.FriendStatus;
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
        className={`absolute -bottom-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-surface ${statusDot(status)}`}
      />
    </div>
  );
}

/** Rich friend profile — mirrors my own profile page, minus private data. */
function FriendProfile({
  friend,
  soc,
  myFocus,
  onSendJam,
  onError,
  onMessage,
  unreadCount,
}: {
  friend: FriendEntry;
  soc: SocialHook;
  myFocus: MyFocusState;
  onSendJam: FriendsProps['onSendJam'];
  onError: (m: string) => void;
  onMessage: () => void;
  unreadCount: number;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jamSent, setJamSent] = useState(false);

  const row = soc.presence.get(friend.userId);
  const status = social.friendStatus(row);
  const live = status === 'focusing';
  const wk = social.weekKey();
  const weekSec = row && row.week_key === wk ? row.week_sec : 0;

  let publicProjects: { n: string; s: number }[] = [];
  try {
    if (row?.public_projects) {
      const arr = JSON.parse(row.public_projects) as unknown;
      if (Array.isArray(arr)) {
        publicProjects = arr.filter(
          (p): p is { n: string; s: number } =>
            typeof p === 'object' && p !== null && 'n' in p && 's' in p,
        );
      }
    }
  } catch {
    publicProjects = [];
  }
  const maxProj = publicProjects[0]?.s || 1;

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
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-xl space-y-4 px-5 pb-10 pt-8">
        {/* identity header — same shape as my own profile */}
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full border-4 border-border-strong bg-surface text-2xl font-extrabold uppercase text-text">
              {friend.avatar ? (
                <img src={friend.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                friend.username.slice(0, 2)
              )}
            </div>
            <span
              className={`absolute bottom-1 right-1 h-6 w-6 rounded-full border-4 border-bg ${statusDot(status)}`}
            />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-text-faint">
              {t('menu.profile')}
            </div>
            <h1 className="truncate text-3xl font-extrabold tracking-tight text-text">
              @{friend.username}
            </h1>
            <div className={`mt-1 text-sm font-semibold ${statusText(status)}`}>
              {statusLineFor(status, row)}
            </div>
          </div>
        </div>

        {/* big week number */}
        <div className="chunk p-5">
          <div className="font-mono text-[40px] font-bold leading-none tabular-nums text-accent">
            {formatDurationShort(weekSec)}
          </div>
          <div className="mt-1.5 text-xs font-bold uppercase tracking-wide text-text-faint">
            {t('fr.profile.weeklabel')}
          </div>
        </div>

        {/* actions: big square MESSAGE + jam */}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onMessage}
            className="chunk-btn chunk-btn-accent relative py-4 text-sm"
          >
            💬 {t('msg.open').toUpperCase()}
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[10px] font-extrabold text-white">
                {unreadCount}
              </span>
            )}
          </button>
          {myFocus.focusing ? (
            <button
              type="button"
              disabled={busy || jamSent}
              onClick={() => sendJam('invite')}
              className="chunk-btn py-4 text-sm text-text"
            >
              {jamSent ? t('jam.sent') : `🎧 ${t('jam.invite')}`}
            </button>
          ) : live ? (
            <button
              type="button"
              disabled={busy || jamSent}
              onClick={() => sendJam('request')}
              className="chunk-btn py-4 text-sm text-text"
            >
              {jamSent ? t('jam.sent') : `🎧 ${t('jam.request')}`}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || jamSent}
              onClick={() => sendJam('invite')}
              title={t('jam.create.hint')}
              className="chunk-btn py-4 text-sm text-text"
            >
              {jamSent ? t('jam.sent') : `🎧 ${t('jam.create')}`}
            </button>
          )}
        </div>

        {/* public recent projects (only when the friend opted in) */}
        <div className="chunk space-y-2.5 p-4">
          <div className="text-xs font-extrabold uppercase tracking-wide text-text-dim">
            {t('profile.projects')}
          </div>
          {publicProjects.length === 0 ? (
            <div className="py-2 text-center text-xs font-semibold text-text-faint">
              🔒 {t('fr.projects.private')}
            </div>
          ) : (
            publicProjects.map((p) => (
              <div key={p.n} className="flex items-center gap-2.5">
                <span className="w-32 truncate text-sm font-bold text-text">{p.n}</span>
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-border-strong bg-bg">
                  <div className="h-full bg-accent" style={{ width: `${(p.s / maxProj) * 100}%` }} />
                </div>
                <span className="w-14 shrink-0 text-right font-mono text-xs font-bold tabular-nums text-text-dim">
                  {formatDurationShort(p.s)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* unfriend — real confirmation */}
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
    </div>
  );
}

export function FriendsPage({
  signedIn,
  social: soc,
  onError,
  myFocus,
  onSendJam,
  unread,
  chatRefetchKey,
  onChatOpened,
  openChatWith,
  onOpenChatConsumed,
}: FriendsProps) {
  const [addName, setAddName] = useState('');
  const [addMsg, setAddMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null); // friend userId
  const [chatting, setChatting] = useState<string | null>(null); // friend userId

  function openChat(f: FriendEntry) {
    if (!f.e2ePub) {
      onError(t('ver.old', f.username));
      return;
    }
    setViewing(null);
    setChatting(f.userId);
    onChatOpened(f.userId);
  }

  function closeChat() {
    setChatting(null);
    onChatOpened(null);
  }

  // live tick for "focusing for Xh" lines
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => () => onChatOpened(null), [onChatOpened]);

  // sidebar 💬 asks for a specific conversation
  useEffect(() => {
    if (!openChatWith) return;
    const f = soc.state?.friends.find((fr) => fr.userId === openChatWith);
    onOpenChatConsumed();
    if (f) openChat(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChatWith, soc.state]);

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
  const me = state.me;

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
      } else if (r === 'notfound') setAddMsg({ text: t('fr.err.notfound'), ok: false });
      else if (r === 'self') setAddMsg({ text: t('fr.err.self'), ok: false });
      else if (r === 'duplicate') setAddMsg({ text: t('fr.err.duplicate'), ok: false });
      else setAddMsg({ text: t('fr.err.generic'), ok: false });
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

  const chattingFriend = chatting ? state.friends.find((f) => f.userId === chatting) : null;
  const viewingFriend = viewing ? state.friends.find((f) => f.userId === viewing) : null;

  const wk = social.weekKey();
  const ranking = [
    { userId: me.user_id, username: me.username, isMe: true },
    ...state.friends.map((f) => ({ userId: f.userId, username: f.username, isMe: false })),
  ]
    .map((p) => {
      const row = soc.presence.get(p.userId);
      return { ...p, weekSec: row && row.week_key === wk ? row.week_sec : 0 };
    })
    .sort((a, b) => b.weekSec - a.weekSec);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT: friends column */}
      <aside className="scrollbar-none flex w-[330px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-border p-3">
        <div className="px-1">
          <h1 className="text-base font-extrabold tracking-tight text-text">{t('fr.title')}</h1>
          <p className="text-[11px] text-text-faint">
            {t('fr.you')} <span className="font-bold text-accent">@{me.username}</span>
          </p>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addFriend();
          }}
          className="flex gap-1.5"
        >
          <input
            value={addName}
            onChange={(e) => {
              setAddName(e.target.value);
              setAddMsg(null);
            }}
            placeholder={t('fr.add.placeholder')}
            maxLength={21}
            className="chunk-input min-w-0 flex-1 px-3 py-2 text-[13px] font-semibold text-text placeholder:font-medium placeholder:text-text-faint"
          />
          <button
            type="submit"
            disabled={busy || !addName.trim()}
            className="chunk-btn chunk-btn-accent px-3 py-2 text-xs"
          >
            +
          </button>
        </form>
        {addMsg && (
          <div className={`px-1 text-[11px] font-bold ${addMsg.ok ? 'text-accent' : 'text-danger'}`}>
            {addMsg.text}
          </div>
        )}

        {state.incoming.length > 0 && (
          <div className="chunk space-y-2 p-3">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.inbox')} <span className="text-accent">({state.incoming.length})</span>
            </div>
            {state.incoming.map((f) => (
              <div key={f.friendshipId} className="flex items-center justify-between gap-1.5">
                <span className="truncate text-[13px] font-bold text-text">@{f.username}</span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => accept(f)}
                    className="chunk-btn chunk-btn-accent px-2.5 py-1 text-[11px]"
                  >
                    {t('fr.accept')}
                  </button>
                  <button
                    type="button"
                    onClick={() => removePending(f)}
                    className="chunk-btn px-2 py-1 text-[11px] text-text-dim"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {state.outgoing.length > 0 && (
          <div className="chunk space-y-1.5 p-3">
            <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
              {t('fr.outgoing')}
            </div>
            {state.outgoing.map((f) => (
              <div key={f.friendshipId} className="flex items-center justify-between gap-1.5">
                <span className="truncate text-xs font-semibold text-text-dim">@{f.username}</span>
                <button
                  type="button"
                  onClick={() => removePending(f)}
                  className="text-[11px] font-bold text-text-faint hover:text-danger"
                >
                  {t('fr.cancel')}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* friends list — click opens the chat; small button opens the profile */}
        <div className="space-y-0.5">
          {state.friends.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Mascot mood="think" size={52} />
              <span className="text-sm font-semibold text-text-faint">{t('fr.empty')}</span>
            </div>
          )}
          {state.friends.map((f) => {
            const row = soc.presence.get(f.userId);
            const status = social.friendStatus(row);
            const active = chatting === f.userId || viewing === f.userId;
            return (
              <div
                key={f.friendshipId}
                role="button"
                tabIndex={0}
                onClick={() => openChat(f)}
                onKeyDown={(e) => e.key === 'Enter' && openChat(f)}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2 py-2 ${
                  active ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={f.username} status={status} photo={f.avatar} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-text">@{f.username}</div>
                    <div className={`truncate text-[11px] font-medium ${statusText(status)}`}>
                      {statusLineFor(status, row)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {(unread[f.userId] ?? 0) > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-extrabold text-bg">
                      {unread[f.userId]}
                    </span>
                  )}
                  <button
                    type="button"
                    title={t('fr.viewprofile')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatting(null);
                      onChatOpened(null);
                      setViewing(f.userId);
                    }}
                    className="rounded-lg px-1.5 py-1 text-xs font-bold text-text-faint hover:bg-bg hover:text-text"
                  >
                    👤
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {state.friends.length > 0 && (
          <div className="chunk mt-auto space-y-2 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-text-dim">
                {t('fr.ranking')}
              </span>
              <span className="text-[10px] font-medium text-text-faint">{t('fr.week')}</span>
            </div>
            {ranking.slice(0, 5).map((p, i) => (
              <div key={p.userId} className="flex items-center gap-2 text-xs">
                <span className="w-5 text-center">
                  {medals[i] ?? <span className="font-bold text-text-faint">{i + 1}</span>}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate font-bold ${p.isMe ? 'text-accent' : 'text-text'}`}
                >
                  {p.isMe ? t('fr.me') : `@${p.username}`}
                </span>
                <span className="shrink-0 font-mono font-bold tabular-nums text-text-dim">
                  {formatDurationShort(p.weekSec)}
                </span>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* RIGHT: chat / profile / placeholder */}
      <main className="min-h-0 min-w-0 flex-1">
        {chattingFriend ? (
          <ChatView
            friend={chattingFriend}
            myUserId={me.user_id}
            statusLine={statusLineFor(
              social.friendStatus(soc.presence.get(chattingFriend.userId)),
              soc.presence.get(chattingFriend.userId),
            )}
            statusColor={statusText(
              social.friendStatus(soc.presence.get(chattingFriend.userId)),
            )}
            onError={onError}
            onBack={closeChat}
            refetchKey={chatRefetchKey}
            jamAction={
              myFocus.focusing
                ? { label: t('jam.invite'), run: () => onSendJam(chattingFriend, 'invite') }
                : social.isLive(soc.presence.get(chattingFriend.userId))
                  ? { label: t('jam.request'), run: () => onSendJam(chattingFriend, 'request') }
                  : { label: t('jam.create'), run: () => onSendJam(chattingFriend, 'invite') }
            }
          />
        ) : viewingFriend ? (
          <FriendProfile
            friend={viewingFriend}
            soc={soc}
            myFocus={myFocus}
            onSendJam={onSendJam}
            onError={onError}
            onMessage={() => openChat(viewingFriend)}
            unreadCount={unread[viewingFriend.userId] ?? 0}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Mascot mood="relax" size={72} />
            <p className="max-w-xs text-sm font-semibold text-text-faint">{t('fr.select')}</p>
          </div>
        )}
      </main>
    </div>
  );
}
